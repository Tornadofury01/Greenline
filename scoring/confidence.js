// CONFIDENCE: how much should the farmer trust this score?
// Every reason carries a `tone`: 'up' (adds trust), 'down' (costs trust) or 'note' (a limit to know about, no points).
// Points (each +1 unless noted):
//   1. Years of record: >= 30 climate years (>= 15 for the old sample format).
//   2. Crop history: >= 8 years of satellite crop maps.
//   3. Familiar crops: most crops were grown on this field before (-1 if most are new).
//   4. Model accuracy on held-out years: the crop model's BALANCED accuracy >= 0.7 (+1).
//      Crops in the rotation it struggles to recognise (held-out recall < 0.5) cost -1.
//   5. Datasets agree: POWER and IMERG yearly rain correlate >= 0.8 and differ by <= 15%.
//   6. Crop traits: a crop whose scored trait (drought sensitivity, water need, nitrogen fixed) is an
//      unsourced estimate, or unknown, costs -1.
// Data resolution never adds a point. It is always stated so nobody over-reads coarse weather.
// PRISM (ground-station rain) agreement is shown for POWER and IMERG when field.quality.rainVsPrism exists. It adds no points.
import { reason } from './rules/helpers.js';

// crops.json id -> crop-model class. Crops without a class have no satellite model yet.
export const MODEL_CLASS = { corn: 'corn', cotton: 'cotton', grain_sorghum: 'grain_sorghum', winter_wheat: 'winter_wheat', fallow: 'fallow' };

// Traits the scores actually use. A trait counts as an estimate if crops.json lists it under `estimates`,
// or if it is unknown (nFixLbPerAcre is null for a nitrogen-fixing crop, e.g. alfalfa).
const SCORED_TRAITS = ['droughtSensitivity', 'seasonalWaterMm', 'nFixLbPerAcre'];
export function estimatedTraits(crop) {
  return SCORED_TRAITS.filter((k) =>
    crop.estimates?.includes(k) || (k === 'nFixLbPerAcre' && crop.nitrogenFixing && crop.nFixLbPerAcre == null));
}

const tone = (kind, key, params, src) => ({ ...reason(key, params, src), tone: kind });

// "0.5° × 0.625° (~50 km)" -> "~50 km"; "9 km" -> "9 km"; "0.1°" -> "0.1°" (falls back to the whole text).
const shortRes = (s) => s?.resolution?.match(/~?\d+(?:\.\d+)?\s*(?:km|m)\b/)?.[0] ?? s?.resolution ?? null;

export function confidenceFor(crops, field, cropLibraryVerified, bareDays = null) {
  let points = 0;
  const reasons = [];
  const si = field.si;
  const q = field.quality;

  const climateYears = field.climateYearly.length;
  const longEnough = si ? 30 : 15;
  if (climateYears >= longEnough) { points++; reasons.push(tone('up', 'confidence.longClimate', { count: climateYears }, ['NASA POWER'])); }
  else reasons.push(tone('down', 'confidence.shortClimate', { count: climateYears }, ['NASA POWER']));

  const histYears = field.cropHistory.length;
  if (histYears >= 8) { points++; reasons.push(tone('up', 'confidence.goodHistory', { count: histYears }, ['USDA Cropland Data Layer'])); }

  const grown = new Set(field.cropHistory.map((h) => h.crop));
  const growing = crops.filter((c) => c.id !== 'fallow');
  const newShare = growing.filter((c) => !grown.has(c.id)).length / Math.max(1, growing.length);
  if (newShare <= 0.34) { points++; reasons.push(tone('up', 'confidence.familiarCrops', {}, ['USDA Cropland Data Layer'])); }
  else if (newShare > 0.66) { points--; reasons.push(tone('down', 'confidence.newCrops', {}, ['USDA Cropland Data Layer'])); }
  else reasons.push(tone('note', 'confidence.someNewCrops', {}, ['USDA Cropland Data Layer']));

  if (si) {
    const m = si.models.seasonCrop;
    const acc = Math.round(m.heldOutAccuracy * 100);
    const bal = Math.round(m.heldOutBalancedAccuracy * 100);
    if (m.heldOutBalancedAccuracy >= 0.7) { points++; reasons.push(tone('up', 'confidence.modelStrong', { acc, bal }, ['Greenline SI models'])); }
    else reasons.push(tone('down', 'confidence.modelMixed', { acc, bal }, ['Greenline SI models']));
    const per = m.perClass || {};
    const hard = [...new Set(crops.map((c) => c.id))].filter((id) => per[MODEL_CLASS[id]]?.recall < 0.5);
    if (hard.length) { points--; reasons.push(tone('down', 'confidence.cropHardToSee', { crops: hard }, ['Greenline SI models'])); }

    const ra = q?.rainAgreement;
    if (ra && ra.corr >= 0.8 && Math.abs(ra.imergVsPowerPct) <= 15) {
      points++;
      reasons.push(tone('up', 'confidence.datasetsAgree', { corr: ra.corr, pct: ra.imergVsPowerPct }, ['NASA POWER', 'GPM IMERG']));
    } else if (ra) {
      reasons.push(tone('down', 'confidence.datasetsDisagree', { corr: ra.corr, pct: ra.imergVsPowerPct }, ['NASA POWER', 'GPM IMERG']));
    }

    // Ground-station check (PRISM, 4 km, gauge-based). One line per NASA rain dataset, with this field's own
    // numbers (quality.rainVsPrism). Adds no points: POWER and IMERG are both adjusted with gauge data, so
    // agreement is consistency evidence, not proof from a separate source (docs/data-validation.md).
    const rp = q?.rainVsPrism;
    for (const [k, name] of [['power', 'NASA POWER'], ['imerg', 'GPM IMERG']]) {
      const vs = rp?.[k];
      if (!vs) continue;
      const ok = vs.corr >= 0.8 && Math.abs(vs.pct) <= 15;
      const dir = vs.pct < 0 ? 'Lower' : 'Higher';
      reasons.push(tone(ok ? 'up' : 'down', `confidence.prism.${ok ? 'agrees' : 'differs'}${dir}`,
        { name, corr: vs.corr, pct: Math.abs(vs.pct), years: vs.years }, ['PRISM', name]));
    }
    reasons.push(tone('note', 'confidence.cdlNoise', {}, ['USDA Cropland Data Layer']));
  }

  // Resolution, read from the field's own dataset list so it is always what was really used.
  const src = (prefix) => field.sources?.find((s) => s.dataset.startsWith(prefix));
  const fine = shortRes(src('Landsat'));
  const mid = shortRes(src('GPM IMERG'));
  const coarse = shortRes(src('NASA POWER'));
  if (fine && mid && coarse) {
    reasons.push(tone('note', 'confidence.resolution', { fine, mid, coarse }, [src('Landsat'), src('GPM IMERG'), src('NASA POWER')].map((x) => x.dataset)));
  }

  // Crop traits: estimates cost a point. Everything in crops.json is still unverified until AgriLife / NRCS check it.
  const estimated = [...new Set(growing.filter((c) => estimatedTraits(c).length).map((c) => c.id))];
  if (estimated.length) { points--; reasons.push(tone('down', 'confidence.traitsEstimated', { crops: estimated })); }
  if (!cropLibraryVerified) reasons.push(tone('note', 'confidence.placeholderTraits'));
  // Bare-day shapes for these crops are estimates (no measured record for them on this field).
  if (bareDays?.estimated?.length) reasons.push(tone('note', 'confidence.bareEstimated', { crops: bareDays.estimated }, ['Landsat 8/9']));

  // 5 possible points with SI data, 3 with the old sample format.
  const [hi, medium] = si ? [4, 2] : [3, 2];
  const level = points >= hi ? 'high' : points >= medium ? 'medium' : 'low';
  return { level, points, reasons };
}

// The two reasons to show on the card face: the most important thing helping and the most important thing hurting.
// If one side is empty, fill from the other, then from notes.
export function topReasons(confidence, n = 2) {
  const by = (k) => confidence.reasons.filter((r) => r.tone === k);
  const up = by('up');
  const down = by('down');
  const picked = [down[0], up[0]].filter(Boolean);
  for (const r of [...down.slice(1), ...up.slice(1), ...by('note')]) {
    if (picked.length >= n) break;
    picked.push(r);
  }
  return picked.slice(0, n);
}
