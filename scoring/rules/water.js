// SAVE WATER: lower average crop water use scores higher.
// Score 10 = every crop is waterUse 1. Score 0 = every crop is waterUse 5.
import { avg, clamp, round1, reason } from './helpers.js';

export function waterRule(crops, field) {
  const growing = crops.filter((c) => c.id !== 'fallow');
  const avgUse = avg(growing.map((c) => c.waterUse));
  const score = clamp(10 - (avgUse - 1) * 2.5);
  const reasons = [reason('reasons.waterAvg', { value: round1(avgUse) })];

  const droughtYears = field.climateYearly.filter((y) => y.yearType === 'drought').length;
  if (droughtYears >= 2) reasons.push(reason('reasons.droughtHistory', { count: droughtYears }));
  return { score, reasons };
}
