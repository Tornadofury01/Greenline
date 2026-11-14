// SAVE WATER: lower average crop water use scores higher.
// Score 10 = every crop has water need 1. Score 0 = every crop has water need 5 (see waterNeed in helpers).
// Real field conditions: if this field's own history has drought in >= 20% of years,
// thirsty crops (high water need or high drought sensitivity) lose a little more.
// Soil water storage (SSURGO, plant-available water in the top 100 cm) scales that penalty: soil that holds
// little (< 10 cm, about 4 in) x 1.25; soil that holds a lot (>= 15 cm, about 6 in) carries crops through
// short dry spells, x 0.75. Unknown storage: x 1.
import { avg, clamp, round1, reason, droughtYears, waterNeed, isThirsty } from './helpers.js';

const LOW_STORE_CM = 10;
const HIGH_STORE_CM = 15;

export function waterRule(crops, field) {
  const growing = crops.filter((c) => c.id !== 'fallow');
  const avgUse = avg(growing.map(waterNeed));
  const nYears = field.climateYearly.length;
  const drought = droughtYears(field);
  const dryShare = nYears ? drought / nYears : 0;
  const thirsty = growing.filter(isThirsty).length;
  const store = field.soil?.waterStorage100Cm;
  const storeFactor = store == null ? 1 : store < LOW_STORE_CM ? 1.25 : store >= HIGH_STORE_CM ? 0.75 : 1;
  const droughtPenalty = dryShare >= 0.2 ? thirsty * 0.5 * storeFactor : 0;
  const score = clamp(10 - (avgUse - 1) * 2.5 - droughtPenalty);
  const reasons = [reason('reasons.waterAvg', { value: round1(avgUse) })];

  if (drought >= 2) reasons.push(reason('reasons.droughtHistory', { count: drought, total: nYears }, ['NASA POWER', 'Greenline SI models']));
  // SMAP root-zone soil moisture: growing seasons at least 10% drier than this field's normal.
  const smYears = field.climateYearly.filter((y) => y.soilMoistureAnomaly != null);
  const drySm = smYears.filter((y) => y.soilMoistureAnomaly <= -0.1).length;
  if (smYears.length >= 5) reasons.push(reason('reasons.drySoilYears', { count: drySm, total: smYears.length }, ['SMAP L4']));
  if (store != null) {
    const level = store < LOW_STORE_CM ? 'low' : store >= HIGH_STORE_CM ? 'high' : 'mid';
    reasons.push(reason(`reasons.soilStore.${level}`, { inches: round1(store / 2.54) }, ['USDA SSURGO']));
  }
  return { score, reasons };
}
