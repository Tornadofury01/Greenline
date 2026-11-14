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
  const years = si.years.filter((y) => y.cdlClass === cls);
  const recognized = years.filter((y) => y.correct).length;
  const latest = years.at(-1);
  const signalAllowed = (vs.showSignalFor || []).includes(cls);
  const seasons = years.filter((y) => y.stressMonths != null);
  const flagged = seasons.filter((y) => (y.predictedStressMonths || []).length > 0).length;
  const lastStress = [...seasons].reverse().find((y) => y.stressDriver);
  const perCrop = si.models.seasonCrop.perClass?.[cls];
  // The weather risk signal is only worth showing where it beat "assume a normal year" on unseen years.
  const pc = vs.perCrop?.[cls];
  const beat = signalAllowed && pc?.beatsBaseline ? { rmse: pc.rmse, base: pc.baselineRmse, pct: Math.round(((pc.baselineRmse - pc.rmse) / pc.baselineRmse) * 100) } : null;
  return {
    cropId, hasModel: true, years: years.length, recognized,
    recall: perCrop?.recall ?? null,
    driver: latest?.cropDriver || null, driverYear: latest?.year ?? null,
    signalAllowed, beat, seasons: seasons.length, flagged,
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
    cropYears: c.years, stressR2: v.heldOutR2, stressCrops: v.showSignalFor || [],
    yearStability: pct(y.heldOutStability), yearYears: y.years,
    fieldAgree: field.quality?.modelAgreesWithCdlPct ?? null,
  };
}
