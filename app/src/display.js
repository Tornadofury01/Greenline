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

export function climateStats(field) {
  const c = field.climateYearly;
  const avgBareDays = Math.round(avg(field.bareDaysPerYear.map((b) => b.days)));
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
  const years = new Set(field.ndviMonthly.map((n) => n.year)).size;
  const counts = Array(12).fill(0);
  for (const n of field.ndviMonthly) if (n.ndvi < BARE_NDVI) counts[n.month - 1]++;
  return counts.map((c, i) => (c > years / 2 ? i + 1 : null)).filter(Boolean);
}
