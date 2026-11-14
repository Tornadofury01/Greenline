// Small shared helpers for rules. Keep rules readable: no clever math here.
export const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const clamp = (x, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, x));
export const round1 = (x) => Math.round(x * 10) / 10;
// A reason is an i18n key plus params, so the app can show it in any language.
// `src` (optional) lists the dataset names behind it, matching field.sources[].dataset (the app's "evidence receipt").
export const reason = (key, params = {}, src) => (src ? { key, params, src } : { key, params });

// Field facts the rules share. All optional: the fake sample field (v1) has fewer of them.
// Average bare days per year over the most recent 10 years with data (Landsat 8/9 only when the file has it).
export function recentBareDays(field) {
  const b = (field.bareDaysPerYearL89 || field.bareDaysPerYear || []).slice(-10);
  return b.length ? Math.round(avg(b.map((x) => x.days))) : null;
}
export const droughtYears = (field) => field.climateYearly.filter((y) => y.yearType === 'drought').length;

// Crop water need on a 1-5 scale, from the midpoint of the FAO seasonal range (crops.json seasonalWaterMm).
// Mapping (docs/crop-traits-verification.md): <475 mm -> 1, <600 -> 2, <=800 -> 3, <1050 -> 4, else 5. Fallow = 0.
export function waterNeed(crop) {
  const [lo, hi] = crop.seasonalWaterMm || [0, 0];
  const mid = (lo + hi) / 2;
  if (mid === 0) return 0;
  if (mid < 475) return 1;
  if (mid < 600) return 2;
  if (mid <= 800) return 3;
  if (mid < 1050) return 4;
  return 5;
}
// "Thirsty" = a lot of water over the season OR yield badly hurt by a dry spell (corn).
export const isThirsty = (crop) => waterNeed(crop) >= 4 || (crop.droughtSensitivity || 0) >= 4;
