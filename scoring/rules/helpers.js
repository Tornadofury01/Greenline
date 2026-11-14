// Small shared helpers for rules. Keep rules readable: no clever math here.
export const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const clamp = (x, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, x));
export const round1 = (x) => Math.round(x * 10) / 10;
// A reason is an i18n key plus params, so the app can show it in any language.
export const reason = (key, params = {}) => ({ key, params });
