// Display-only helpers: turn raw field data into farmer-friendly numbers and words.
// These never change the data or the scores.
import { BARE_NDVI } from './data/loadField.js';

export const mmToIn = (mm) => Math.round(mm / 25.4);

// Slope in plain words (thresholds follow common NRCS slope classes).
export function slopeWord(pct) {
  if (pct < 2) return 'flat';
  if (pct < 5) return 'gentle';
  if (pct < 10) return 'moderate';
  return 'steep';
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Landsat 8/9 era. Before this, Landsat 5/7 read NDVI lower, so older years look barer (pipeline/MODELS.md #14).
export const SENSOR_YEAR = 2013;
// Rows from SENSOR_YEAR on; falls back to all rows if the field has none (the fake sample).
const modern = (rows) => { const r = rows.filter((x) => x.year >= SENSOR_YEAR); return r.length ? r : rows; };

export function climateStats(field) {
  const c = field.climateYearly;
  const avgBareDays = Math.round(avg(modern(field.bareDaysPerYear).map((b) => b.days)));
  return {
    droughtYears: c.filter((y) => y.yearType === 'drought').map((y) => y.year),
    hotYears: c.filter((y) => y.yearType === 'heat').map((y) => y.year),
    avgRainIn: mmToIn(avg(c.map((y) => y.precipMm))),
    avgRainMm: Math.round(avg(c.map((y) => y.precipMm))),
    avgHeatDays: Math.round(avg(c.map((y) => y.heatStressDays))),
    avgBareDays,
    avgBareMonths: Math.round(avgBareDays / 30),
  };
}

// Months (1-12) that were bare in more than half of all years, in calendar order.
export function usuallyBareMonths(field) {
  const rows = modern(field.ndviMonthly);
  const years = new Set(rows.map((n) => n.year)).size;
  const counts = Array(12).fill(0);
  for (const n of rows) if (n.ndvi < BARE_NDVI) counts[n.month - 1]++;
  return counts.map((c, i) => (c > years / 2 ? i + 1 : null)).filter(Boolean);
}

// Cover share per year, as % of the clear months: [{ year, green, partly, bare }]. Years with < 9 clear months are left out.
export function coverShares(field) {
  return field.coverYearly
    .map((row) => {
      const clear = row.months.filter(Boolean);
      if (clear.length < 9) return null;
      const pct = (st) => Math.round((100 * clear.filter((m) => m === st).length) / clear.length);
      const bare = pct('bare');
      const green = pct('green');
      return { year: row.year, green, partly: 100 - bare - green, bare };
    })
    .filter(Boolean);
}

// Chance (0-1) the ground is bare in each month, over the years from SENSOR_YEAR on.
export function typicalBareMonths(field) {
  const rows = modern(field.coverYearly);
  return Array.from({ length: 12 }, (_, m) => {
    const seen = rows.map((r) => r.months[m]).filter(Boolean);
    return seen.length ? Math.round((100 * seen.filter((s) => s === 'bare').length) / seen.length) / 100 : 0;
  });
}

// --- Soil (SSURGO) in plain words. Thresholds from docs/app-changes-needed.md. ---
export function kWord(k) {
  if (k == null) return null;
  if (k < 0.2) return 'low';
  if (k <= 0.35) return 'moderate';
  return 'high';
}
// "2e" -> { cls: 2, sub: 'e' }. Subclass letters: e erosion, w wetness, s soil limits, c climate.
export function parseCapability(lcc) {
  const m = String(lcc ?? '').match(/^([1-8])([ewsc])?$/i);
  return m ? { cls: Number(m[1]), sub: m[2]?.toLowerCase() ?? null } : null;
}

// --- Frost dates (PRISM, 4 km). Typical = median over the last `n` years that have the date. ---
// Display only. Model 3 (year types) keeps using NASA POWER frostFreeDays.
const dayOfYear = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
};
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// Day of year -> { month: 0-11, day } in a non-leap year.
const fromDoy = (doy) => {
  const d = new Date(Date.UTC(2023, 0, 1) + (Math.round(doy) - 1) * 86400000);
  return { month: d.getUTCMonth(), day: d.getUTCDate() };
};
export function frostDates(field, n = 10) {
  const rows = field.climateYearly.filter((y) => y.lastSpringFrostPrism || y.firstFallFrostPrism).slice(-n);
  if (!rows.length) return null;
  const spring = rows.map((y) => y.lastSpringFrostPrism).filter(Boolean).map(dayOfYear);
  const fall = rows.map((y) => y.firstFallFrostPrism).filter(Boolean).map(dayOfYear);
  const season = rows.map((y) => y.frostFreeDaysPrism).filter((x) => x != null);
  const power = rows.map((y) => y.frostFreeDays).filter((x) => x != null);
  return {
    from: rows[0].year, to: rows.at(-1).year,
    spring: spring.length ? fromDoy(median(spring)) : null,
    fall: fall.length ? fromDoy(median(fall)) : null,
    seasonDays: season.length ? Math.round(median(season)) : null,
    powerDays: power.length ? Math.round(median(power)) : null,
  };
}
