// STOP EROSION: average erosion protection of each season's crop.
// Fallow seasons (bare ground) count as 0. Steeper slope = bare ground hurts more.
// Real field conditions: if satellites show this field already sits bare a lot (> 120 days/yr),
// low-cover crops are penalised a bit more, because the field has little cover to spare.
import { avg, clamp, round1, reason, recentBareDays } from './helpers.js';

const BARE_HEAVY_DAYS = 120;

export function erosionRule(crops, field) {
  const protection = avg(crops.map((c) => c.erosionProtection)); // 0-5
  const bareSeasons = crops.filter((c) => c.erosionProtection <= 1).length;
  const slopePenalty = field.terrain.slopePct > 2 ? bareSeasons * 0.5 : 0;
  const bareDays = recentBareDays(field);
  const lowCover = crops.filter((c) => c.erosionProtection <= 2).length;
  const barePenalty = bareDays != null && bareDays > BARE_HEAVY_DAYS ? lowCover * 0.3 : 0;
  const score = clamp(protection * 2 - slopePenalty - barePenalty);
  const reasons = [reason('reasons.erosionAvg', { value: round1(protection) })];
  if (slopePenalty > 0) reasons.push(reason('reasons.slopeBare', { slope: field.terrain.slopePct }, ['SRTM']));
  if (bareDays != null) {
    reasons.push(reason(bareDays > BARE_HEAVY_DAYS ? 'reasons.fieldBareHigh' : 'reasons.fieldBareLow', { days: bareDays },
      ['Landsat 5/7/8/9', 'Greenline SI models']));
  }
  return { score, reasons };
}
