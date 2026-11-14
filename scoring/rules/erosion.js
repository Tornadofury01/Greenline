// STOP EROSION: average erosion protection of each season's crop.
// Fallow seasons (bare ground) count as 0. Steeper slope = bare ground hurts more.
import { avg, clamp, round1, reason } from './helpers.js';

export function erosionRule(crops, field) {
  const protection = avg(crops.map((c) => c.erosionProtection)); // 0-5
  const bareSeasons = crops.filter((c) => c.erosionProtection <= 1).length;
  const slopePenalty = field.terrain.slopePct > 2 ? bareSeasons * 0.5 : 0;
  const score = clamp(protection * 2 - slopePenalty);
  const reasons = [reason('reasons.erosionAvg', { value: round1(protection) })];
  if (slopePenalty > 0) reasons.push(reason('reasons.slopeBare', { slope: field.terrain.slopePct }));
  return { score, reasons };
}
