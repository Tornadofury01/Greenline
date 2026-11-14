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
