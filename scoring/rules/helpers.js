// Small shared helpers for rules. Keep rules readable: no clever math here.
export const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const clamp = (x, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, x));
export const round1 = (x) => Math.round(x * 10) / 10;
// A reason is an i18n key plus params, so the app can show it in any language.
// `src` (optional) lists the dataset names behind it, matching field.sources[].dataset (the app's "evidence receipt").
export const reason = (key, params = {}, src) => (src ? { key, params, src } : { key, params });

// Field facts the rules share. All optional: the fake sample field (v1) has fewer of them.
// Average bare days per year over the most recent 10 years with data.
export function recentBareDays(field) {
  const b = (field.bareDaysPerYear || []).slice(-10);
  return b.length ? Math.round(avg(b.map((x) => x.days))) : null;
}
export const droughtYears = (field) => field.climateYearly.filter((y) => y.yearType === 'drought').length;
