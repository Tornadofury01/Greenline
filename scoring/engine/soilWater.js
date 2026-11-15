// Soil, water balance and daily erosion. Pure functions on a plain `soil` object (no React, no fs).
//
// Water (tipping bucket): three layers to 1 m. Each layer holds `taw` mm of plant-available water between wilting point and field capacity
// (taw = AWC x thickness; AWC from SSURGO via the field file) and a little more above field capacity (saturation).
//   per day: rain (+ irrigation) -> SCS curve-number runoff (clay: hydrologic group D) -> infiltration into the top layer, the excess above field capacity tips down
//            -> soil evaporation (top layer) -> crop transpiration (root-zone layers, FAO-56 Ks stress)
//            -> drainage down the layers, out of the bottom = deep drainage.
// The books must close: rain + irrigation = runoff + evaporation + transpiration + drainage + change in storage (selftest).
// Not modelled: swelling-clay cracks (Houston Black cracks open when dry and swallow the first rains), interception, run-on, water tables.
import {
  LAYER_THICKNESS_M, SATURATION_OVER_FC, DRAIN_FRACTION_BY_HSG, CURVE_NUMBER_BY_HSG, CN_RESIDUE_CREDIT, CN_MAX,
  RUNOFF_INITIAL_ABSTRACTION, EVAP_MAX_COEFF, EVAP_MULCH_MAX_CUT, KR_FULL_SHARE, EVAP_TEW_MM,
  EI_COEFF_US, EI_EXPONENT, SLOPE_LENGTH_FT, SURFACE_COVER_B, CANOPY_FALL_HEIGHT_DECAY, RUNOFF_GATE_MM, EROSION_CALIBRATION, M_TO_FT,
} from './constants.js';

const num = (v, d) => (Number.isFinite(v) ? v : d);

/** RUSLE slope length and steepness factor LS (Renard et al. 1997; McCool et al. 1987 steepness), slope in percent, length in feet. */
export function lsFactor(slopePct, lengthFt = SLOPE_LENGTH_FT) {
  const th = Math.atan(slopePct / 100), s = Math.sin(th);
  const beta = (s / 0.0896) / (3 * Math.pow(s, 0.8) + 0.56);
  const m = beta / (1 + beta);
  const steep = slopePct < 9 ? 10.8 * s + 0.03 : 16.8 * s - 0.5;
  return Math.pow(lengthFt / 72.6, m) * steep;
}

/** Build the soil object from the field file. `rootZoneFraction` is slot D (0 = wilting point, 1 = field capacity). */
export function makeSoil(field, rootZoneFraction) {
  const s = field.soil ?? {};
  const awc = num(s.awcCmPerCm, Number.isFinite(s.waterStorage100Cm) ? s.waterStorage100Cm / 100 : 0.15); // cm/cm = mm/mm
  const thick = LAYER_THICKNESS_M, topDepth = [], taw = [], cap = [];
  let z = 0;
  for (const t of thick) { topDepth.push(z); taw.push(awc * t * 1000); cap.push(awc * t * 1000 * (1 + SATURATION_OVER_FC)); z += t; }
  const hsgRaw = String(s.hydrologicGroup ?? 'C');
  const hsgLast = hsgRaw.slice(-1).toUpperCase(); // dual groups like "B/D": the undrained (last) letter
  const hsg = CURVE_NUMBER_BY_HSG[hsgLast] ? hsgLast : 'C';
  const slopePct = num(field.terrain?.slopePct, 2);
  return {
    awc, thick, topDepth, taw, cap, hsg,
    cn2: CURVE_NUMBER_BY_HSG[hsg], drainFrac: DRAIN_FRACTION_BY_HSG[hsg],
    w: taw.map((x) => x * rootZoneFraction),
    kFactor: num(s.kFactor, 0.3), tFactor: num(s.tFactor, 3), slopePct, ls: lsFactor(slopePct),
    clayPct: num(s.clayPct, 30), organicMatterPct: num(s.organicMatterPct, 2.5),
    tawTotal: taw.reduce((a, b) => a + b, 0),
  };
}

/** Adjust the curve number to how wet the top two layers are (AMC I / II / III, NEH-4), then take off the residue credit. */
function curveNumber(soil, resCover) {
  const wet = (soil.w[0] + soil.w[1]) / (soil.taw[0] + soil.taw[1]);
  const cn2 = soil.cn2;
  const cn1 = (4.2 * cn2) / (10 - 0.058 * cn2), cn3 = (23 * cn2) / (10 + 0.13 * cn2);
  const t = Math.min(1, Math.max(0, wet));
  let cn = t < 0.5 ? cn1 + (cn2 - cn1) * (t / 0.5) : cn2 + (cn3 - cn2) * ((t - 0.5) / 0.5);
  cn -= CN_RESIDUE_CREDIT * resCover;
  return Math.min(CN_MAX, Math.max(30, cn));
}

const adjustCC = (cc) => Math.min(1, Math.max(0, 1.72 * cc - cc * cc + 0.3 * cc * cc * cc)); // AquaCrop effective canopy cover

/**
 * One day of water balance. Mutates soil.w. Returns the fluxes (mm).
 * c = { rain, irr, et0, cc (canopy cover 0-1), kcbMax, kcbScale, resCover, zr (m), p (depletion fraction), growing (bool) }
 */
export function waterStep(soil, c) {
  const w = soil.w;
  const storage0 = w[0] + w[1] + w[2];
  const P = c.rain;
  // runoff (rain only; irrigation is assumed to be applied without runoff)
  let runoff = 0;
  if (P > 0) {
    const cn = curveNumber(soil, c.resCover);
    const S = 25400 / cn - 254, Ia = RUNOFF_INITIAL_ABSTRACTION * S;
    if (P > Ia) runoff = ((P - Ia) * (P - Ia)) / (P + (1 - RUNOFF_INITIAL_ABSTRACTION) * S);
  }
  const infil = P - runoff + c.irr;
  w[0] += infil;
  // tipping bucket: water above field capacity moves down the profile the same day while the layer below has room
  for (let i = 0; i < 2; i++) {
    const move = Math.min(Math.max(0, w[i] - soil.taw[i]), soil.cap[i + 1] - w[i + 1]);
    w[i] -= move; w[i + 1] += move;
  }
  // water that is still above saturation anywhere (bottom layer full too) cannot enter: it leaves as saturation-excess runoff
  for (let i = 0; i < 3; i++) { const over = w[i] - soil.cap[i]; if (over > 0) { w[i] -= over; runoff += over; } }

  // soil evaporation from the top layer (two-stage, simplified), cut by canopy shade and residue mulch
  const ccAdj = adjustCC(c.cc);
  const ePot = EVAP_MAX_COEFF * (1 - ccAdj) * c.et0 * (1 - EVAP_MULCH_MAX_CUT * c.resCover);
  // only the top ~10 cm can evaporate: "evaporable" water = what the top layer holds above (capacity - TEW)
  const evaporable = Math.max(0, w[0] - Math.max(0, soil.taw[0] - EVAP_TEW_MM));
  const kr = Math.min(1, evaporable / (KR_FULL_SHARE * Math.min(EVAP_TEW_MM, soil.taw[0])));
  const evap = Math.min(evaporable, ePot * kr);
  w[0] -= evap;

  // crop transpiration from the rooted part of each layer (FAO-56 Ks from root-zone depletion)
  let tp = 0, ks = 1, transp = 0, tawR = 0, wR = 0;
  if (c.growing) {
    tp = c.et0 * c.kcbMax * c.kcbScale * ccAdj;
    const f = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      f[i] = Math.min(1, Math.max(0, (c.zr - soil.topDepth[i]) / soil.thick[i]));
      tawR += f[i] * soil.taw[i];
      wR += f[i] * Math.min(w[i], soil.taw[i]);
    }
    if (tawR > 0) {
      const dr = tawR - wR, raw = c.p * tawR;
      ks = dr <= raw ? 1 : Math.max(0, (tawR - dr) / (tawR - raw));
      let avail = 0;
      for (let i = 0; i < 3; i++) avail += f[i] * w[i];
      transp = Math.min(tp * ks, avail);
      if (transp > 0) for (let i = 0; i < 3; i++) w[i] -= transp * ((f[i] * w[i]) / avail);
    }
  }
  const rootDeplFrac = tawR > 0 ? Math.max(0, 1 - wR / tawR) : 0;

  // deep drainage: a share of the bottom layer's water above field capacity leaves each day (slow in clay)
  const excess3 = Math.max(0, w[2] - soil.taw[2]);
  const drain = excess3 * soil.drainFrac;
  w[2] -= drain;
  for (let i = 0; i < 3; i++) if (w[i] < 0) w[i] = 0; // guards against rounding only (selftest checks it never needs more than 1e-9)
  const storage1 = w[0] + w[1] + w[2];
  return { runoff, infil, evap, transp, tp, ks, drain, rootDeplFrac, tawR, wR, residual: P + c.irr - runoff - evap - transp - drain - (storage1 - storage0) };
}

/** Root-zone available water (mm) and capacity for a root depth, used for irrigation and "water at planting". */
export function rootZoneWater(soil, zr) {
  let taw = 0, wr = 0;
  for (let i = 0; i < 3; i++) {
    const f = Math.min(1, Math.max(0, (zr - soil.topDepth[i]) / soil.thick[i]));
    taw += f * soil.taw[i]; wr += f * Math.min(soil.w[i], soil.taw[i]);
  }
  return { taw, wr };
}

// ---------------------------------------------------------------------------------------------------------------
// Erosion: daily RUSLE  A = R x K x LS x C x P  (tons/acre), the subfactors follow Renard et al. 1997 (Handbook 703).
// R_day = a x P^1.81 (Richardson et al. 1983; a calibrated so a normal year gives R about 280, see constants).
// Gated by runoff: rain that does not run off moves no soil (full strength at >= 1 mm of runoff, scaled below that).
// ---------------------------------------------------------------------------------------------------------------
/** @returns {{ tons:number, rDay:number, slr:number }} */
export function erosionStep(soil, { rain, runoff, cc, heightM, resCover, supportPractice = 1 }) {
  if (rain <= 0 || runoff <= 0) return { tons: 0, rDay: rain > 0 ? EI_COEFF_US * Math.pow(rain, EI_EXPONENT) : 0, slr: 1 };
  const rDay = EI_COEFF_US * Math.pow(rain, EI_EXPONENT);
  const canopySub = 1 - cc * Math.exp(-CANOPY_FALL_HEIGHT_DECAY * heightM * M_TO_FT);
  const surfaceSub = Math.exp(-SURFACE_COVER_B * resCover * 100);
  const slr = canopySub * surfaceSub;
  const gate = Math.min(1, runoff / RUNOFF_GATE_MM);
  const raw = rDay * soil.kFactor * soil.ls * slr * supportPractice * gate;
  return { tons: raw * EROSION_CALIBRATION, rawTons: raw, rDay, slr };
}
