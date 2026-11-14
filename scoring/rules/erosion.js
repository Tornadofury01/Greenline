// STOP EROSION: average erosion protection of each season's crop, minus a penalty for bare days.
// Fallow seasons (bare ground) count as 0. Steeper slope = bare ground hurts more.
// Bare days come from this rotation's own estimate (scoring/bareDays.js: crop calendars from satellites,
// calibrated on this field where it has its own record). 60 days a year or fewer costs nothing; every extra
// 60 days costs 1 point, up to 2 points (3 on slopes steeper than 2%).
import { avg, clamp, round1, reason } from './helpers.js';

const FREE_BARE_DAYS = 60;
const BARE_DAYS_PER_POINT = 60;

export function erosionRule(crops, field, _constraints, ctx = {}) {
  const protection = avg(crops.map((c) => c.erosionProtection)); // 0-5
  const bareSeasons = crops.filter((c) => c.erosionProtection <= 1).length;
  const steep = field.terrain.slopePct > 2;
  const slopePenalty = steep ? bareSeasons * 0.5 : 0;
  const bare = ctx.bareDays;
  const barePenalty = bare
    ? clamp((bare.bareDays - FREE_BARE_DAYS) / BARE_DAYS_PER_POINT, 0, 2) * (steep ? 1.5 : 1)
    : 0;
  const score = clamp(protection * 2 - slopePenalty - barePenalty);
  const reasons = [reason('reasons.erosionAvg', { value: round1(protection) })];
  if (slopePenalty > 0) reasons.push(reason('reasons.slopeBare', { slope: field.terrain.slopePct }, ['SRTM']));
  if (bare) {
    reasons.push(reason('reasons.rotationBare', { days: bare.bareDays }, ['Landsat 5/7/8/9', 'USDA Cropland Data Layer']));
    if (bare.calibrated.length) {
      reasons.push(reason('reasons.bareCalibrated', { crops: bare.calibrated.map((c) => c.crop) }, ['Landsat 5/7/8/9', 'USDA Cropland Data Layer']));
    }
  }
  return { score, reasons };
}
