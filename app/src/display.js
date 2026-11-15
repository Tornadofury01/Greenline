// Display-only helpers: turn raw field data into farmer-friendly numbers and words.
// These never change the data or the scores.
import { BARE_NDVI } from './data/loadField.js';

export const mmToIn = (mm) => Math.round(mm / 25.4);

// The bad year the Compare scoreboard shows by default: 2011 if it is one of the field's drought presets,
// else its first drought preset, else its latest drought year. { year, yearType } or null.
export function defaultBadYear(field) {
  const presets = field?.si?.replayPresets
    || (field?.climateYearly || []).filter((y) => y.yearType === 'drought').slice(-3).reverse().map((y) => ({ year: y.year, yearType: y.yearType }));
  const droughts = presets.filter((p) => p.yearType === 'drought');
  return droughts.find((p) => p.year === 2011) || droughts[0] || presets[0] || null;
}

// Slope in plain words (thresholds follow common NRCS slope classes).
export function slopeWord(pct) {
  if (pct < 2) return 'flat';
  if (pct < 5) return 'gentle';
  if (pct < 10) return 'moderate';
  return 'steep';
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Bare days and cover come from Landsat 8/9 only (the `*L89` keys, docs/app-changes-needed.md section 5).
// Landsat 7 reads NDVI about 0.05 lower and was mixed into the older record until ~2023, so the mixed keys are used only
// for years before 2013 (shown as low confidence, never averaged) and as a fallback for files without L89 keys.
// SENSOR_YEAR is the visual line on the charts; bare-day numbers start in 2014 (first full Landsat 8 year).
export const SENSOR_YEAR = 2013;

// Bare-day rows used for numbers: L89 (2014+). Fallback: mixed rows from SENSOR_YEAR on (files without L89 keys).
export function bareRows(field) {
  if (field.bareDaysPerYearL89?.length) return field.bareDaysPerYearL89;
  const r = (field.bareDaysPerYear || []).filter((x) => x.year >= SENSOR_YEAR);
  return r.length ? r : field.bareDaysPerYear || [];
}

// One bare-day row per year for display: L89 when it has the year, the old record before 2013 (low confidence).
// Years from 2013 on with no L89 number (too cloudy) are left out on purpose: callers show "too cloudy".
export function bareRowFor(field, year) {
  if (year < SENSOR_YEAR) {
    const b = field.bareDaysPerYear?.find((y) => y.year === year);
    return b ? { ...b, lowConfidence: true } : null;
  }
  return bareRows(field).find((y) => y.year === year) || null;
}

// Cover rows for the timeline: L89 for 2013+, the old record before 2013 (flagged lowConfidence).
export function coverRows(field) {
  const l89 = field.coverYearlyL89;
  if (!l89?.length) return field.coverYearly.map((r) => ({ ...r, lowConfidence: r.year < SENSOR_YEAR || !!r.lowConfidence }));
  const old = field.coverYearly.filter((r) => r.year < SENSOR_YEAR).map((r) => ({ ...r, lowConfidence: true }));
  return [...old, ...l89.map((r) => ({ ...r, lowConfidence: false }))];
}
// Rows that may go into averages: never the low-confidence ones (fallback: all, for the fake sample).
const trusted = (rows) => { const r = rows.filter((x) => !x.lowConfidence && x.year >= SENSOR_YEAR); return r.length ? r : rows; };

export function climateStats(field) {
  const c = field.climateYearly;
  const avgBareDays = Math.round(avg(bareRows(field).map((b) => b.days)));
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

// Months (1-12) that were bare in more than half of the years (Landsat 8/9 NDVI), in calendar order.
export function usuallyBareMonths(field) {
  const rows = field.ndviMonthlyL89?.length ? field.ndviMonthlyL89 : field.ndviMonthly.filter((n) => n.year >= SENSOR_YEAR);
  const years = new Set(rows.map((n) => n.year)).size;
  const counts = Array(12).fill(0);
  for (const n of rows) if (n.ndvi < BARE_NDVI) counts[n.month - 1]++;
  return counts.map((c, i) => (c > years / 2 ? i + 1 : null)).filter(Boolean);
}

// Cover share per year, as % of the clear months: [{ year, green, partly, bare, lowConfidence }].
// Years with < 9 clear months are left out (2013 has only Apr-Dec from Landsat 8, so it is left out too).
export function coverShares(field) {
  return coverRows(field)
    .map((row) => {
      const clear = row.months.filter(Boolean);
      if (clear.length < 9) return null;
      const pct = (st) => Math.round((100 * clear.filter((m) => m === st).length) / clear.length);
      const bare = pct('bare');
      const green = pct('green');
      return { year: row.year, green, partly: 100 - bare - green, bare, lowConfidence: row.lowConfidence };
    })
    .filter(Boolean);
}
export const trustedShares = (shares) => trusted(shares);

// Chance (0-1) the ground is bare in each month, over the Landsat 8/9 years.
export function typicalBareMonths(field) {
  const rows = trusted(coverRows(field));
  return Array.from({ length: 12 }, (_, m) => {
    const seen = rows.map((r) => r.months[m]).filter(Boolean);
    return seen.length ? Math.round((100 * seen.filter((s) => s === 'bare').length) / seen.length) / 100 : 0;
  });
}

// Chance (0-1) the ground is green in each month, over the Landsat 8/9 years (same rows as typicalBareMonths).
export function typicalGreenMonths(field) {
  const rows = trusted(coverRows(field));
  return Array.from({ length: 12 }, (_, m) => {
    const seen = rows.map((r) => r.months[m]).filter(Boolean);
    return seen.length ? Math.round((100 * seen.filter((s) => s === 'green').length) / seen.length) / 100 : 0;
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
