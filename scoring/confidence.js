// CONFIDENCE: how much should the farmer trust this score?
// Points (each +1 unless noted):
//   1. Years of record: >= 30 climate years (>= 15 for the old sample format).
//   2. Crop history: >= 8 years of satellite crop maps.
//   3. Familiar crops: most crops were grown on this field before (-1 if most are new).
//   4. Model accuracy on held-out years: the crop model's BALANCED accuracy >= 0.7 (+1).
//      Crops in the rotation it struggles to recognise (held-out recall < 0.5) cost -1.
//   5. Datasets agree: POWER and IMERG yearly rain correlate >= 0.8 and differ by <= 15%.
// Data resolution never adds a point. Coarse weather (~50 km) is always stated so nobody over-reads it.
import { reason } from './rules/helpers.js';

// crops.json id -> crop-model class. Crops without a class have no satellite model yet.
export const MODEL_CLASS = { corn: 'corn', cotton: 'cotton', grain_sorghum: 'grain_sorghum', winter_wheat: 'winter_wheat', fallow: 'fallow' };

export function confidenceFor(crops, field, cropLibraryVerified) {
  let points = 0;
  const reasons = [];
  const si = field.si;
  const q = field.quality;

  const climateYears = field.climateYearly.length;
  const longEnough = si ? 30 : 15;
  if (climateYears >= longEnough) { points++; reasons.push(reason('confidence.longClimate', { count: climateYears }, ['NASA POWER'])); }
  else reasons.push(reason('confidence.shortClimate', { count: climateYears }, ['NASA POWER']));

  const histYears = field.cropHistory.length;
  if (histYears >= 8) { points++; reasons.push(reason('confidence.goodHistory', { count: histYears }, ['USDA Cropland Data Layer'])); }

  const grown = new Set(field.cropHistory.map((h) => h.crop));
  const growing = crops.filter((c) => c.id !== 'fallow');
  const newShare = growing.filter((c) => !grown.has(c.id)).length / Math.max(1, growing.length);
  if (newShare <= 0.34) { points++; reasons.push(reason('confidence.familiarCrops', {}, ['USDA Cropland Data Layer'])); }
  else if (newShare > 0.66) { points--; reasons.push(reason('confidence.newCrops', {}, ['USDA Cropland Data Layer'])); }
  else reasons.push(reason('confidence.someNewCrops', {}, ['USDA Cropland Data Layer']));

  if (si) {
    const m = si.models.seasonCrop;
    const acc = Math.round(m.heldOutAccuracy * 100);
    const bal = Math.round(m.heldOutBalancedAccuracy * 100);
    if (m.heldOutBalancedAccuracy >= 0.7) { points++; reasons.push(reason('confidence.modelStrong', { acc, bal }, ['Greenline SI models'])); }
    else reasons.push(reason('confidence.modelMixed', { acc, bal }, ['Greenline SI models']));
    const per = m.perClass || {};
    const hard = [...new Set(crops.map((c) => c.id))].filter((id) => per[MODEL_CLASS[id]]?.recall < 0.5);
    if (hard.length) { points--; reasons.push(reason('confidence.cropHardToSee', { crops: hard }, ['Greenline SI models'])); }

    const ra = q?.rainAgreement;
    if (ra && ra.corr >= 0.8 && Math.abs(ra.imergVsPowerPct) <= 15) {
      points++;
      reasons.push(reason('confidence.datasetsAgree', { corr: ra.corr, pct: ra.imergVsPowerPct }, ['NASA POWER', 'GPM IMERG']));
    } else if (ra) {
      reasons.push(reason('confidence.datasetsDisagree', { corr: ra.corr, pct: ra.imergVsPowerPct }, ['NASA POWER', 'GPM IMERG']));
    }
    reasons.push(reason('confidence.coarseWeather', {}, ['NASA POWER', 'SMAP L4', 'Landsat 5/7/8/9']));
    reasons.push(reason('confidence.cdlNoise', {}, ['USDA Cropland Data Layer']));
  }

  if (!cropLibraryVerified) reasons.push(reason('confidence.placeholderTraits'));

  // 5 possible points with SI data, 3 with the old sample format.
  const [hi, mid] = si ? [4, 2] : [3, 2];
  const level = points >= hi ? 'high' : points >= mid ? 'medium' : 'low';
  return { level, points, reasons };
}
