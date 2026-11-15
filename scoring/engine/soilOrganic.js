// Soil organic carbon (two pools), residue on the surface and the soil nitrogen pools. Pure functions on a plain object.
//
// Carbon pools (lb C/acre, top 15 cm):
//   cFast  residue and root carbon, decays quickly; part of what decays becomes humus, the rest goes to the air as CO2
//   cSlow  humus (the soil organic matter itself), decays slowly
// Decay speeds with warmth (Q10 = 2 around 20 C), with moisture of the top layer, and with tillage (more air and contact = faster).
// Nitrogen pools (lb N/acre): nMin mineral N the crop can take, nRes organic N inside the residue pool, nPlant N held by the growing crop;
// humus holds cSlow / 10 pounds of N. Total N only changes through fertilizer and fixation (in) and leaching and grain removal (out) (selftest).
// Residue with a high C:N (straw) soaks up mineral N while it decays (immobilization); legume residue releases it.
// Not modelled: denitrification, volatilization, ammonium vs nitrate, N below the root zone.
import {
  SOIL_MASS_LB_PER_ACRE, SOM_CARBON_FRACTION, FAST_DECAY_PER_DAY, SLOW_DECAY_PER_DAY, HUMIFICATION, CN_SOM, Q10,
  TILLAGE_FAST_DECAY_MULT, TILLAGE_SLOW_DECAY_MULT, TILLAGE_BURIAL, INIT_N_MIN_LB_AC, INIT_FAST_C_LB_AC, INIT_RESIDUE_LB_AC,
  LEACH_MIX_MM,
} from './constants.js';

export function makeOrganic(field) {
  const somPct = Number.isFinite(field.soil?.organicMatterPct) ? field.soil.organicMatterPct : 2.5;
  const cSlow = (somPct / 100) * SOIL_MASS_LB_PER_ACRE * SOM_CARBON_FRACTION;
  return {
    cFast: INIT_FAST_C_LB_AC, cSlow, cSlow0: cSlow,
    nMin: INIT_N_MIN_LB_AC, nRes: INIT_FAST_C_LB_AC / 30, nPlant: 0,
    residueLb: INIT_RESIDUE_LB_AC, residueCoeff: 0.00035,
  };
}

export const somPercent = (o) => ((o.cSlow + o.cFast) / SOM_CARBON_FRACTION / SOIL_MASS_LB_PER_ACRE) * 100;
export const residueCover = (o) => 1 - Math.exp(-o.residueCoeff * o.residueLb);
export const totalN = (o) => o.nMin + o.nPlant + o.nRes + o.cSlow / CN_SOM;

/** Leach mineral N with the day's deep drainage (mm). Returns pounds leached. */
export function leach(o, drainMm) {
  if (drainMm <= 0 || o.nMin <= 0) return 0;
  const lost = o.nMin * (1 - Math.exp(-drainMm / LEACH_MIX_MM));
  o.nMin -= lost;
  return lost;
}

/** One day of decomposition. tmean deg C, topWetness 0-1 (top layer water / capacity), tillage name. */
export function organicStep(o, tmean, topWetness, tillage) {
  const fT = Math.pow(Q10, (tmean - 20) / 10);
  const fW = 0.2 + 0.8 * Math.min(1, Math.max(0, topWetness / 0.8));
  const kf = Math.min(0.5, FAST_DECAY_PER_DAY * fT * fW * (TILLAGE_FAST_DECAY_MULT[tillage] ?? 1));
  const ks = Math.min(0.01, SLOW_DECAY_PER_DAY * fT * fW * (TILLAGE_SLOW_DECAY_MULT[tillage] ?? 1));
  // residue pool
  const dCf = o.cFast * kf;
  const dNres = o.cFast > 0 ? o.nRes * (dCf / o.cFast) : 0;
  o.cFast -= dCf; o.nRes -= dNres;
  // humus formed from it, limited by the mineral N available to build it (C:N 10)
  let dCh = HUMIFICATION * dCf;
  const need = dCh / CN_SOM;
  if (need > o.nMin + dNres) dCh = Math.max(0, (o.nMin + dNres) * CN_SOM);
  o.cSlow += dCh;
  o.nMin += dNres - dCh / CN_SOM;
  // humus decay mineralizes N
  const dCs = o.cSlow * ks;
  o.cSlow -= dCs;
  o.nMin += dCs / CN_SOM;
  // surface residue shrinks a little slower than the pool (buried parts and roots decay faster)
  o.residueLb *= 1 - 0.7 * kf;
  return { respired: dCf - dCh, mineralized: dCs / CN_SOM + dNres - dCh / CN_SOM };
}

/** Residue and roots added when a crop ends. aboveLb/rootLb = dry matter, nLb = organic N that goes with it. */
export function addResidue(o, { aboveLb, rootLb, nLb, carbonFraction, coverCoeff }) {
  const old = o.residueLb;
  o.residueCoeff = old + aboveLb > 0 ? (o.residueCoeff * old + coverCoeff * aboveLb) / (old + aboveLb) : o.residueCoeff;
  o.residueLb += aboveLb;
  o.cFast += (aboveLb + rootLb) * carbonFraction;
  o.nRes += nLb;
}

/** One tillage pass buries a share of the surface residue (it stays in the carbon pool). */
export function tillagePass(o, tillage) {
  o.residueLb *= 1 - (TILLAGE_BURIAL[tillage] ?? 0);
}
