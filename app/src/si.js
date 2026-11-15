// Display helpers for the SI model results in field.si (see /shared/data-format.md "SI results").
// Read-only: these never change data or scores. All text goes through t().
import { MODEL_CLASS } from '@scoring/confidence.js';

export const modelClassFor = (cropId) => MODEL_CLASS[cropId] || null;

// "Greenness (NDVI) in March mattered most" etc., from a driver { key, params } exported by the pipeline.
export function cropDriverText(t, d) {
  if (!d) return null;
  const months = t('story.monthsLong');
  return t(d.key, { month: d.params?.month ? months[d.params.month - 1] : '' });
}

// Stress drivers: { key: 'si.driver.<feature>', params: { month, direction } } -> si.stress.<feature>.<direction>
export function stressDriverText(t, d) {
  if (!d) return null;
  const feature = d.key.replace('si.driver.', '');
  const months = t('story.monthsLong');
  return t(`si.stress.${feature}.${d.params.direction}`, { month: months[d.params.month - 1] });
}

// What the models saw for one crop on this field.
export function cropInsight(field, cropId) {
  const si = field.si;
  if (!si) return null;
  const cls = modelClassFor(cropId);
  const vs = si.models.vegStress;
  if (!cls) return { cropId, hasModel: false };
  // Years the USDA crop map shows this crop class here (2008+). The model's right/wrong is only known for unseen
  // years (2023-2025, `correct`); for the rest we show how often it finds this class on unseen years overall.
  const years = si.years.filter((y) => y.cdlClass === cls);
  const tested = years.filter((y) => y.correct != null);
  const latest = years.at(-1);
  const signalAllowed = (vs.showSignalFor || []).includes(cls);
  const seasons = years.filter((y) => y.stressMonths != null);
  const flagged = seasons.filter((y) => (y.predictedStressMonths || []).length > 0).length;
  const lastStress = [...seasons].reverse().find((y) => y.stressDriver);
  const perCrop = si.models.seasonCrop.perClass?.[cls];
  return {
    cropId, cls, hasModel: true, years: years.length, tested: tested.length, recognized: tested.filter((y) => y.correct).length,
    recall: perCrop?.recall ?? null,
    driver: latest?.cropDriver || null, driverYear: latest?.year ?? null,
    signalAllowed, beat: null, seasons: seasons.length, flagged,
    stressDriver: lastStress?.stressDriver || null, stressYear: lastStress?.year ?? null,
  };
}

const pct = (x) => (x == null ? null : Math.round(x * 100));

export function modelSummary(field) {
  const si = field?.si;
  if (!si) return null;
  const { seasonCrop: c, vegStress: v, yearPatterns: y } = si.models;
  return {
    cropAcc: pct(c.heldOutAccuracy), cropBal: pct(c.heldOutBalancedAccuracy), cropBase: pct(c.baselineAccuracy),
    cropClean: pct(c.heldOutAccuracyClean), cropYears: c.years,
    stressAcc: pct(v.heldOutAccuracy), stressAuc: v.heldOutAuc, stressBaseAuc: v.baselineCvAuc, stressCrops: v.showSignalFor || [],
    yearGroups: y.groups || {}, yearYears: y.years,
    fieldAgree: field.quality?.modelAgreesWithCdlPct ?? null,
  };
}

// The crop on the field in the latest year, with how sure we are (Model 1, see /shared/data-format.md "years[]").
// source 'usda' = the USDA crop map has a label; 'model' = the model's guess, with its probability.
// A model guess under LOW_CROP_CONF is shown as "not sure" (dashed pill).
export const LOW_CROP_CONF = 0.6;
export function cropThisYear(field) {
  const y = field?.si?.years?.at(-1);
  const h = field?.cropHistory?.at(-1);
  if (!y?.cropFinal) return h ? { year: h.year, cropId: h.crop === 'other' ? null : h.crop, cls: h.cdlClass || 'other', source: 'usda', pct: null, notSure: false } : null;
  const sameYear = h && h.year === y.year && h.crop !== 'other' && y.cropSource === 'usda';
  return {
    year: y.year, cropId: sameYear ? h.crop : null, cls: y.cropFinal, source: y.cropSource,
    pct: y.confidence == null ? null : Math.round(y.confidence * 100),
    notSure: y.cropSource !== 'usda' && y.confidence != null && y.confidence < LOW_CROP_CONF,
  };
}
