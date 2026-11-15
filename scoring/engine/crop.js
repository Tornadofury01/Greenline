// Crop growth: heat-sum stages, canopy cover, AquaCrop-style biomass from transpired water, heat / frost / water stress,
// nitrogen uptake and fixation, harvest. Pure functions on a plain `crop` object.
//
// How a day works (called after the water balance has said how much water the crop could take):
//   1. add growing degree days; f = heat sum / heat sum to maturity (0 sowing, 1 maturity); stages are fractions of f
//   2. biomass: dB = WP* x wpScale x Transpiration / ET0   (AquaCrop; WP* normalised for ET0 and CO2, g biomass per m2)
//      times a cold factor (0 at the crop's minimum growth temperature, 1 from the low end of its optimum) and scaled by nitrogen supply (uptake / demand)
//   3. canopy cover follows f (library groundCover ini / mid / end), times a "health" factor that drops with water stress
//   4. heat during the flowering stage and a freeze (kill temperature, or a freeze at flowering) cut the yield
//   5. at harvest: yield = biomass x harvest index x stress factors;
//      the FAO-33 yield response factor Ky (from model slot B) bends the harvest index so that
//      relative yield loss = Ky x relative water shortage
// All field-specific numbers (Ky, heat threshold and loss, water productivity scale) arrive in `params`, taken from modelSlots by the simulator.
import {
  GDD_UPPER_CUTOFF_C, BIOMASS_G_M2_TO_LB_AC, CANOPY_STRESS_LOSS, CANOPY_HEALTH_RECOVERY, CANOPY_HEALTH_MIN, SENESCENCE_STRESS_LOSS,
  HEAT_YIELD_FLOOR, FROST_FLOWER_LOSS, EARLY_HARVEST_HI_START, KY_CORRECTION_MAX, MIN_RET_FOR_KY, MIN_ROOT_DEPTH_M,
} from './constants.js';

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Canopy cover (0-1) a healthy crop of this kind has at heat-sum fraction f. */
export function canopyPotential(def, f) {
  const sf = def.season.stageFractions, g = def.groundCover;
  if (f < sf.emerge) return 0;
  if (f < sf.canopyFull) return g.ini + (g.mid - g.ini) * smooth((f - sf.emerge) / (sf.canopyFull - sf.emerge));
  if (f < sf.senescence) return g.mid;
  if (f < 1) return g.mid + (g.end - g.mid) * ((f - sf.senescence) / (1 - sf.senescence));
  return Math.max(0, g.end * (1 - (f - 1) / 0.25)); // standing, drying down after maturity
}

/** params: { ky, heatLossPerDay, heatThresholdC, wpScale, gddScale } */
export function createCrop(def, episode, params, plantDay) {
  const gddMat = def.season.gddToMaturity * (params.gddScale ?? 1);
  return {
    id: def.id, def, role: episode.role, plantDay, endDay: episode.endDay, params,
    gddMat, gdd: 0, f: 0, emerged: false, mature: false, dead: false, deadReason: null,
    health: 1, cc: 0, zr: MIN_ROOT_DEPTH_M, zrMax: Math.min(def.water.rootDepthM, 1.0),
    biomass: 0,            // g/m2 above ground (this cutting cycle for perennials)
    trSum: 0, tpSum: 0,    // transpired / potential transpiration (mm) while growing
    heatFactor: 1, frostFactor: 1, flowerFrostHit: false, heatDays: 0, stressDays: 0,
    nPlant: 0, nFixed: 0, cuts: 0, cutsThisYear: 0, cutYieldUnits: 0, cutRevenue: 0, cutDM: 0,
    flowered: false, canopyFullSeen: false, events: [],
    tpPrev: 0,
  };
}

const cuttingAllowed = (crop, doy) => crop.cutsThisYear < (crop.def.season.maxCuts ?? 0) && doy >= 100 && doy <= 320;

/**
 * Advance the crop one day. Inputs: day weather {tmin,tmax,doy}, water result w {transp,tp,ks}, soil mineral N (organic.nMin) and et0.
 * Mutates crop and organic.nMin. Returns { events:[...], nTaken, nFixed, cutReady }.
 */
export function cropStep(crop, wx, w, organic, et0) {
  const def = crop.def, s = def.season, sf = s.stageFractions;
  const ev = [];
  if (crop.dead) { crop.cc = 0; return { events: ev, nTaken: 0, nFixed: 0, cutReady: false }; }
  const tmean = (Math.min(wx.tmax, GDD_UPPER_CUTOFF_C) + Math.max(wx.tmin, s.baseTempC)) / 2;
  const gddToday = Math.max(0, tmean - s.baseTempC);
  const perennial = !!s.perennial;
  const growing = perennial ? crop.f < 1 && gddToday > 0 : !crop.mature;

  // ---- biomass from transpiration, limited by nitrogen -------------------------------------------------------
  let nTaken = 0, nFixed = 0;
  if (growing && crop.emerged && w.transp > 0 && et0 > 0) {
    // cold limit: growth is zero at the crop's minimum growth temperature and full from the lower end of its optimum (ECOCROP)
    const t = def.temperature, tAir = (wx.tmin + wx.tmax) / 2;
    const coldFactor = Math.min(1, Math.max(0, (tAir - t.minGrowthC) / (t.optMinC - t.minGrowthC)));
    const dBpot = def.growth.wpStarGPerM2 * crop.params.wpScale * (w.transp / et0) * coldFactor;
    const demand = dBpot * BIOMASS_G_M2_TO_LB_AC * def.nitrogen.nContentOfBiomass;
    const fixed = demand * def.nitrogen.fixFractionOfUptake * (1 - Math.min(0.6, organic.nMin / 150));
    const soilDemand = demand - fixed;
    const take = Math.min(soilDemand, organic.nMin * 0.3);
    const supplied = fixed + take;
    const fN = demand > 1e-12 ? supplied / demand : 1;
    crop.biomass += dBpot * fN;
    organic.nMin -= take; crop.nPlant += supplied; crop.nFixed += fixed;
    nTaken = take; nFixed = fixed;
  }
  if (growing && crop.emerged) { crop.trSum += w.transp; crop.tpSum += w.tp; if (w.ks < 1) crop.stressDays++; }

  // ---- stages ---------------------------------------------------------------------------------------------------
  crop.gdd += gddToday;
  if (perennial && crop.gdd > crop.gddMat) crop.gdd = crop.gddMat;
  crop.f = crop.gdd / crop.gddMat;
  const f = crop.f;
  if (!crop.emerged && f >= sf.emerge) { crop.emerged = true; ev.push('emerged'); }
  if (!crop.canopyFullSeen && f >= sf.canopyFull) crop.canopyFullSeen = true;
  const inFlower = f >= sf.flowerStart && f <= sf.flowerEnd;
  if (inFlower && !crop.flowered) { crop.flowered = true; ev.push('flowering'); }
  if (!perennial && !crop.mature && f >= 1) { crop.mature = true; ev.push('maturity'); }

  // ---- stress on the canopy ----------------------------------------------------------------------------------------
  if (crop.emerged && f < sf.senescence) {
    if (w.ks < 1) crop.health = Math.max(CANOPY_HEALTH_MIN, crop.health - CANOPY_STRESS_LOSS * (1 - w.ks));
    else crop.health = Math.min(1, crop.health + CANOPY_HEALTH_RECOVERY);
  } else if (crop.emerged && w.ks < 0.5) crop.health = Math.max(CANOPY_HEALTH_MIN, crop.health - SENESCENCE_STRESS_LOSS);

  // ---- heat and frost ---------------------------------------------------------------------------------------------
  if (inFlower && wx.tmax > crop.params.heatThresholdC && def.kind !== 'cover') {
    crop.heatFactor = Math.max(HEAT_YIELD_FLOOR, crop.heatFactor * (1 - crop.params.heatLossPerDay));
    crop.heatDays++;
  }
  if (crop.emerged && wx.tmin <= def.temperature.killTempC) {
    crop.dead = true; crop.deadReason = 'frost'; crop.cc = 0; ev.push('frost-kill');
    return { events: ev, nTaken, nFixed, cutReady: false };
  }
  const ff = def.temperature.flowerFrostC;
  if (ff != null && def.temperature.frostTolerant && inFlower && !crop.flowerFrostHit && wx.tmin <= ff && def.kind !== 'cover') {
    crop.flowerFrostHit = true; crop.frostFactor *= 1 - FROST_FLOWER_LOSS; ev.push('flower-frost');
  }

  // ---- canopy and roots for tomorrow --------------------------------------------------------------------------------
  crop.cc = canopyPotential(def, f) * crop.health;
  const rt = smooth((f - sf.emerge) / (sf.canopyFull - sf.emerge));
  crop.zr = MIN_ROOT_DEPTH_M + (crop.zrMax - MIN_ROOT_DEPTH_M) * rt;
  return { events: ev, nTaken, nFixed, cutReady: perennial && crop.f >= 1 && cuttingAllowed(crop, wx.doy) };
}

/** Kcb at full canopy (FAO-56: Kcb is a little below single Kc), eased down in senescence toward the end value. */
export function kcbFor(crop) {
  const k = crop.def.water.kc, sf = crop.def.season.stageFractions;
  const kcbMax = Math.max(0.2, k.mid - 0.05);
  let scale = 1;
  if (crop.f > sf.senescence && !crop.def.season.perennial) {
    const prog = Math.min(1, (crop.f - sf.senescence) / (1 - sf.senescence));
    scale = 1 + (Math.min(1, k.end / k.mid) - 1) * 0.5 * prog;
  }
  return { kcbMax, scale };
}

/** FAO-33 correction of the harvest index: Ky x relative shortage replaces the proportional loss already inside the biomass. */
export function kyCorrection(ky, rET) {
  const r = Math.min(1, Math.max(rET, MIN_RET_FOR_KY));
  const fy = Math.max(0, 1 - ky * (1 - r));
  return Math.min(KY_CORRECTION_MAX, fy / r);
}

/**
 * Harvest a cash crop (or one alfalfa cutting): returns { yieldUnits, harvestedDMLb, hiEff }. Does not change the crop.
 * pestLoss 0-1 comes from the pest module.
 */
export function harvestYield(crop, pestLoss) {
  const def = crop.def;
  const biomassLb = crop.biomass * BIOMASS_G_M2_TO_LB_AC;
  if (crop.dead || def.kind === 'cover') return { yieldUnits: def.kind === 'cover' && !crop.dead ? biomassLb : 0, harvestedDMLb: 0, hiEff: 0, biomassLb, rET: 1 };
  const rET = crop.tpSum > 1e-9 ? Math.min(1, crop.trSum / crop.tpSum) : 1;
  const build = crop.def.season.perennial ? 1 : smooth((crop.f - EARLY_HARVEST_HI_START) / (1 - EARLY_HARVEST_HI_START));
  const hiEff = def.growth.harvestIndex * build * kyCorrection(crop.params.ky, rET) * crop.heatFactor * crop.frostFactor * (1 - pestLoss);
  const harvestedDMLb = biomassLb * hiEff;
  const d = def.defaults;
  const yieldUnits = (harvestedDMLb * d.turnout) / (1 - d.harvestMoisture) / d.lbPerYieldUnit;
  return { yieldUnits, harvestedDMLb, hiEff, biomassLb, rET };
}
