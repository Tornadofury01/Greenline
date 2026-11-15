// Daily weather for the engine, built ONLY from the field file (field.climateMonthly, field.climateYearly, field.field.lat).
//
// The field files hold monthly rain and monthly mean daily min/max temperature (2008-2025), plus yearly rain from 1985.
// The engine needs days, so each month is turned into days by a seeded generator that keeps the month totals exact:
//   - rain: the month's total is split over a plausible number of wet days with heavy-tailed amounts (sum = the monthly value),
//   - temperature: a smooth seasonal curve plus correlated daily noise, shifted so the monthly means match,
//   - ET0: Hargreaves-Samani from daily min/max temperature and latitude (needs nothing else).
// Same field + year + seed = same days, always (no Math.random, no clock). The days are invented inside the real month totals:
// they are NOT observed storms. Real daily weather (NASA POWER / Daymet) can replace this later with makeWeatherFromDaily().
//
// Years without monthly rows (before 2008) use the field's own month-by-month climate average, with rain scaled to that
// year's real yearly total when the field file has it (source 'climatology').
import {
  WET_DAY_MEAN_MM, RAIN_GAMMA_SHAPE, TMAX_NOISE_SD, TMIN_NOISE_SD, TEMP_AR1, WET_DAY_TMAX_DROP, WET_DAY_TMIN_RISE,
} from './constants.js';

const DAY_MS = 86400000;
export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInYear = (y) => (isLeap(y) ? 366 : 365);
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
export const dayNumber = (year, doy) => Math.floor(Date.UTC(year, 0, doy) / DAY_MS);
export const isoOfDayNumber = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const yearOfDayNumber = (n) => new Date(n * DAY_MS).getUTCFullYear();
export const doyOfDayNumber = (n) => n - dayNumber(yearOfDayNumber(n), 1) + 1;

// ---- seeded random numbers --------------------------------------------------------------------------------------
function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rng) { return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); }
// Gamma(shape k) with scale 1. k < 1 uses the boost Gamma(k+1) * U^(1/k) (Marsaglia and Tsang for k >= 1).
function gamma(rng, k) {
  if (k < 1) return gamma(rng, k + 1) * Math.pow(1 - rng(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = normal(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (Math.log(1 - u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

// ---- reference evapotranspiration (FAO-56 eq. 21 for Ra, Hargreaves-Samani) -------------------------------------------
export function extraterrestrialMm(latDeg, doy) {
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  const ra = (24 * 60 / Math.PI) * 0.0820 * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws)); // MJ/m2/day
  return 0.408 * ra; // mm/day equivalent
}
export const hargreavesET0 = (tmin, tmax, ra) => Math.max(0, 0.0023 * ((tmin + tmax) / 2 + 17.8) * Math.sqrt(Math.max(tmax - tmin, 0)) * ra);

// ---- monthly inputs of a field-year -----------------------------------------------------------------------------------
function climatology(field) {
  const acc = Array.from({ length: 12 }, () => ({ p: 0, tn: 0, tx: 0, n: 0 }));
  for (const r of field.climateMonthly ?? []) { const a = acc[r.month - 1]; a.p += r.precipMm; a.tn += r.tMinC; a.tx += r.tMaxC; a.n++; }
  return acc.map((a) => (a.n ? { precipMm: a.p / a.n, tMinC: a.tn / a.n, tMaxC: a.tx / a.n } : null));
}
function monthlyFor(field, clim, year) {
  const rows = (field.climateMonthly ?? []).filter((r) => r.year === year);
  if (rows.length === 12) return { source: 'monthly', months: [...rows].sort((a, b) => a.month - b.month).map((r) => ({ precipMm: r.precipMm, tMinC: r.tMinC, tMaxC: r.tMaxC })) };
  if (clim.some((c) => c === null)) throw new Error(`field ${field?.field?.id}: no monthly climate to build weather from`);
  const climTotal = clim.reduce((a, c) => a + c.precipMm, 0);
  const yearly = (field.climateYearly ?? []).find((r) => r.year === year);
  const k = yearly && Number.isFinite(yearly.precipMm) && climTotal > 0 ? yearly.precipMm / climTotal : 1;
  return { source: 'climatology', months: clim.map((c) => ({ precipMm: c.precipMm * k, tMinC: c.tMinC, tMaxC: c.tMaxC })) };
}

// ---- one year of days ---------------------------------------------------------------------------------------------------
function generateYear(fieldId, lat, year, months, seed) {
  const n = daysInYear(year);
  const rain = new Float64Array(n), tmin = new Float64Array(n), tmax = new Float64Array(n), et0 = new Float64Array(n);
  // seasonal baseline: linear between mid-month anchors
  // (January and December lean on themselves at the year edges: no data for the neighbouring year's month is pulled in)
  const anchor = (m) => Math.min(11, Math.max(0, m));
  let doy0 = 0;
  for (let m = 0; m < 12; m++) {
    const dim = daysInMonth(year, m + 1);
    const rng = mulberry32(hashString(`${fieldId}|${year}|${m}|${seed}`));
    // rain: wet days and amounts
    const p = months[m].precipMm;
    const idx = Array.from({ length: dim }, (_, i) => i);
    for (let i = dim - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const nWet = p <= 0 ? 0 : Math.max(1, Math.min(dim, Math.round(p / WET_DAY_MEAN_MM)));
    const wet = new Uint8Array(dim);
    let wsum = 0; const w = new Float64Array(dim);
    for (let i = 0; i < nWet; i++) { const d = idx[i]; wet[d] = 1; w[d] = gamma(rng, RAIN_GAMMA_SHAPE); wsum += w[d]; }
    if (nWet > 0 && wsum <= 0) { w[idx[0]] = 1; wsum = 1; }
    for (let d = 0; d < dim; d++) rain[doy0 + d] = wet[d] ? (p * w[d]) / wsum : 0;
    // temperature: baseline curve + AR(1) noise
    const prevM = anchor(m - 1), nextM = anchor(m + 1);
    let zx = normal(rng), zn = normal(rng);
    const txm = new Float64Array(dim), tnm = new Float64Array(dim);
    for (let d = 0; d < dim; d++) {
      const pos = (d + 0.5) / dim - 0.5; // -0.5..0.5 around mid-month
      const other = pos < 0 ? prevM : nextM;
      const wgt = Math.abs(pos);
      const baseX = months[m].tMaxC * (1 - wgt) + months[other].tMaxC * wgt;
      const baseN = months[m].tMinC * (1 - wgt) + months[other].tMinC * wgt;
      zx = TEMP_AR1 * zx + Math.sqrt(1 - TEMP_AR1 * TEMP_AR1) * normal(rng);
      zn = 0.7 * zx + 0.714 * (TEMP_AR1 * zn + Math.sqrt(1 - TEMP_AR1 * TEMP_AR1) * normal(rng));
      txm[d] = baseX + TMAX_NOISE_SD * zx - (wet[d] ? WET_DAY_TMAX_DROP : 0);
      tnm[d] = baseN + TMIN_NOISE_SD * zn + (wet[d] ? WET_DAY_TMIN_RISE : 0);
    }
    // shift so the month means equal the field file's monthly values
    let sx = 0, sn = 0;
    for (let d = 0; d < dim; d++) { sx += txm[d]; sn += tnm[d]; }
    const dx = months[m].tMaxC - sx / dim, dn = months[m].tMinC - sn / dim;
    for (let d = 0; d < dim; d++) {
      const hi = txm[d] + dx;
      tmax[doy0 + d] = hi;
      tmin[doy0 + d] = Math.min(tnm[d] + dn, hi - 3);
    }
    doy0 += dim;
  }
  for (let i = 0; i < n; i++) et0[i] = hargreavesET0(tmin[i], tmax[i], extraterrestrialMm(lat, i + 1));
  return { year, days: n, rain, tmin, tmax, et0 };
}

/**
 * Weather provider for one field.
 * `year(y)` returns { year, days, rain[], tmin[], tmax[], et0[] } (index = day of year - 1), cached.
 * `sourceOf(y)` says 'monthly' (real month totals) or 'climatology' (field average, rain scaled to the real yearly total).
 */
export function makeWeather(field, { seed = 1 } = {}) {
  const fieldId = field?.field?.id ?? 'field';
  const lat = field?.field?.lat;
  if (!Number.isFinite(lat)) throw new Error('field.field.lat is needed for reference ET');
  const clim = climatology(field);
  const cache = new Map();
  const src = new Map();
  return {
    kind: 'generated', fieldId, seed,
    year(y) {
      let w = cache.get(y);
      if (!w) {
        const m = monthlyFor(field, clim, y);
        w = generateYear(fieldId, lat, y, m.months, seed);
        cache.set(y, w); src.set(y, m.source);
      }
      return w;
    },
    sourceOf(y) { this.year(y); return src.get(y); },
  };
}

/**
 * Weather from real daily rows [{ date:'YYYY-MM-DD', rain, tmin, tmax, et0? }] (e.g. NASA POWER or Daymet), same interface.
 * ET0 is computed (Hargreaves) when a row has none. Years with a missing day are rejected (no silent gaps).
 */
export function makeWeatherFromDaily(rows, { lat, fieldId = 'field' } = {}) {
  const byYear = new Map();
  for (const r of rows) { const y = Number(r.date.slice(0, 4)); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(r); }
  const cache = new Map();
  return {
    kind: 'daily', fieldId,
    year(y) {
      let w = cache.get(y);
      if (w) return w;
      const list = byYear.get(y);
      const n = daysInYear(y);
      if (!list || list.length !== n) throw new Error(`daily weather for ${y} needs ${n} rows, got ${list ? list.length : 0}`);
      const rain = new Float64Array(n), tmin = new Float64Array(n), tmax = new Float64Array(n), et0 = new Float64Array(n);
      for (const r of list) {
        const doy = doyOfDayNumber(Math.floor(Date.parse(r.date) / DAY_MS)) - 1;
        rain[doy] = r.rain; tmin[doy] = r.tmin; tmax[doy] = r.tmax;
        et0[doy] = Number.isFinite(r.et0) ? r.et0 : hargreavesET0(r.tmin, r.tmax, extraterrestrialMm(lat, doy + 1));
      }
      w = { year: y, days: n, rain, tmin, tmax, et0 };
      cache.set(y, w);
      return w;
    },
    sourceOf() { return 'daily'; },
  };
}

/** Years of a given Model C type from the slot C result, e.g. yearsOfType(slots.C, 'drought') -> [2000, 2011]. */
export function yearsOfType(slotC, type) {
  return slotC.yearTypes.filter((r) => r.type === type).map((r) => r.year);
}
