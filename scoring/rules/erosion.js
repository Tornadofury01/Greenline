// STOP EROSION: average erosion protection of each season's crop, minus a penalty for bare days.
// Fallow seasons (bare ground) count as 0. Soil that erodes easily on a slope = bare ground hurts more.
// "Erodible" = SSURGO erosion factor K x SRTM slope % >= 0.5 (e.g. K 0.25 on a 2% slope). Without K, slope > 2%.
// Bare days come from this rotation's own estimate (scoring/bareDays.js: crop calendars from satellites,
// calibrated on this field where it has its own record). 60 days a year or fewer costs nothing; every extra
// 60 days costs 1 point, up to 2 points (3 on erodible ground).
import { avg, clamp, round1, reason } from './helpers.js';

const FREE_BARE_DAYS = 60;
const BARE_DAYS_PER_POINT = 60;
const ERODIBLE_K_SLOPE = 0.5;

export function erosionRule(crops, field, _constraints, ctx = {}) {
  const protection = avg(crops.map((c) => c.erosionProtection)); // 0-5
  const bareSeasons = crops.filter((c) => c.erosionProtection <= 1).length;
  const k = field.soil?.kFactor;
  const kSlope = k != null ? k * field.terrain.slopePct : null;
  const steep = kSlope != null ? kSlope >= ERODIBLE_K_SLOPE : field.terrain.slopePct > 2;
  const slopePenalty = steep ? bareSeasons * 0.5 : 0;
  const bare = ctx.bareDays;
  const barePenalty = bare
    ? clamp((bare.bareDays - FREE_BARE_DAYS) / BARE_DAYS_PER_POINT, 0, 2) * (steep ? 1.5 : 1)
    : 0;
  const score = clamp(protection * 2 - slopePenalty - barePenalty);
  const reasons = [reason('reasons.erosionAvg', { value: round1(protection) })];
  if (slopePenalty > 0) reasons.push(reason('reasons.slopeBare', { slope: field.terrain.slopePct }, ['SRTM']));
  if (kSlope != null) {
    reasons.push(reason(steep ? 'reasons.erodible' : 'reasons.notErodible', { k, slope: field.terrain.slopePct }, ['USDA SSURGO', 'SRTM']));
  }
  if (bare) {
    reasons.push(reason('reasons.rotationBare', { days: bare.bareDays }, ['Landsat 5/7/8/9', 'USDA Cropland Data Layer']));
    if (bare.calibrated.length) {
      reasons.push(reason('reasons.bareCalibrated', { crops: bare.calibrated.map((c) => c.crop) }, ['Landsat 5/7/8/9', 'USDA Cropland Data Layer']));
    }
  }
  return { score, reasons };
}
