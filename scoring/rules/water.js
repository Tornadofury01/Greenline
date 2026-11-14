// SAVE WATER: lower average crop water use scores higher.
// Score 10 = every crop has water need 1. Score 0 = every crop has water need 5 (see waterNeed in helpers).
// Real field conditions: if this field's own history has drought in >= 20% of years,
// thirsty crops (high water need or high drought sensitivity) lose a little more.
import { avg, clamp, round1, reason, droughtYears, waterNeed, isThirsty } from './helpers.js';

export function waterRule(crops, field) {
  const growing = crops.filter((c) => c.id !== 'fallow');
  const avgUse = avg(growing.map(waterNeed));
  const nYears = field.climateYearly.length;
  const drought = droughtYears(field);
  const dryShare = nYears ? drought / nYears : 0;
  const thirsty = growing.filter(isThirsty).length;
  const droughtPenalty = dryShare >= 0.2 ? thirsty * 0.5 : 0;
  const score = clamp(10 - (avgUse - 1) * 2.5 - droughtPenalty);
  const reasons = [reason('reasons.waterAvg', { value: round1(avgUse) })];

  if (drought >= 2) reasons.push(reason('reasons.droughtHistory', { count: drought, total: nYears }, ['NASA POWER', 'Greenline SI models']));
  // SMAP root-zone soil moisture: growing seasons at least 10% drier than this field's normal.
  const smYears = field.climateYearly.filter((y) => y.soilMoistureAnomaly != null);
  const drySm = smYears.filter((y) => y.soilMoistureAnomaly <= -0.1).length;
  if (smYears.length >= 5) reasons.push(reason('reasons.drySoilYears', { count: drySm, total: smYears.length }, ['SMAP L4']));
  return { score, reasons };
}
