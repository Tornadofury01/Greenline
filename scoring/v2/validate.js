// Field-level validation that can run now (docs/fieldshift-v2.md "Validation", checks 2, 3 and 4):
// the engine is run on what the field REALLY grew (USDA crop map, slot A) with the field's own weather, and compared with
//   2 measured bare days a year (Landsat 8/9, 2014+)     3 measured crop timing (month of peak NDVI, Landsat 8/9 monthly)
//   4 yields (the caller compares the simulated yields with NASS county yields across all fields)
// Pure JS. The targets are the plan's "to confirm" numbers.
import { planFromSlots } from '../engine/index.js';
import { runPlan } from './context.js';

export const BARE_TOLERANCE_DAYS = 15;   // plan: "within about 15 days a year on most fields"
export const DATE_TOLERANCE_DAYS = 10;   // plan: "within about 10 days"
export const VALIDATION_FIRST_YEAR = 2014; // Landsat 8/9 era (bare days use L8/9 only)
export const MIN_KNOWN_YEARS = 3;        // fewer years with a known crop than this = the field is not compared (status not-run)
const MID_MONTH_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
const r1 = (x) => Math.round(x * 10) / 10;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Run the real crop history of 2014..last year and compare with the measurements. `tillage` = the management assumed for the field. */
export function validateField(ctx, { tillage = ctx.constraints.currentTillage } = {}) {
  const { field, slots, library, lib } = ctx;
  const A = slots.slots.A;
  const last = Math.max(...A.cropByYear.map((r) => r.year));
  const years = [];
  for (let y = VALIDATION_FIRST_YEAR; y <= last; y++) years.push(y);
  const plan = planFromSlots(slots, library, { years, management: { tillage } });
  const peaks = new Map(); // `${year}:${crop}` -> { cc, doy }
  const { sum } = runPlan(ctx, plan, {
    startYear: VALIDATION_FIRST_YEAR, years: years.length, keepSummary: true,
    onDay: (r) => {
      if (!r.crop || r.crop === 'fallow' || r.canopyCover <= 0) return;
      const k = `${r.year}:${r.crop}`, p = peaks.get(k);
      if (!p || r.canopyCover > p.cc) peaks.set(k, { cc: r.canopyCover, doy: r.doy });
    },
  });
  // ---- bare days
  const measured = new Map((field.bareDaysPerYearL89 ?? []).filter((r) => Number.isFinite(r.days)).map((r) => [r.year, r.days]));
  const simByYear = new Map(sum.yearly.filter((y) => y.days >= 365).map((y) => [y.year, y.bareDays]));
  // only years in which the crop map names a crop with a calendar: a pasture or an unknown crop is simulated as fallow, which is not a fair comparison
  const knownYear = new Set(A.cropByYear.filter((r) => A.cropDates[r.crop]).map((r) => r.year));
  const pairs = [...measured].filter(([y]) => simByYear.has(y) && y > VALIDATION_FIRST_YEAR && knownYear.has(y)).map(([y, v]) => ({ year: y, measured: v, simulated: simByYear.get(y) }));
  const simMean = mean(pairs.map((p) => p.simulated)), measMean = mean(pairs.map((p) => p.measured));
  const diff = pairs.length ? mean(pairs.map((p) => p.simulated - p.measured)) : null;
  const bareDays = pairs.length >= MIN_KNOWN_YEARS
    ? { status: Math.abs(diff) <= BARE_TOLERANCE_DAYS ? 'pass' : 'fail', simulatedPerYear: r1(simMean), measuredPerYear: r1(measMean), differenceDays: r1(diff), years: pairs.length, tillageAssumed: tillage }
    : { status: 'not-run', reason: 'no-crop-history', simulatedPerYear: null, measuredPerYear: null, differenceDays: null, years: pairs.length, tillageAssumed: tillage };

  // ---- crop timing: simulated day of peak canopy vs the month of peak NDVI (mid-month day), for years with a known crop
  const ndvi = new Map();
  for (const r of field.ndviMonthlyL89 ?? []) if (Number.isFinite(r.ndvi)) ndvi.set(`${r.year}-${r.month}`, r.ndvi);
  const errs = [], dateErrors = [];
  for (const row of A.cropByYear) {
    const cal = A.cropDates[row.crop];
    if (!cal || row.year <= VALIDATION_FIRST_YEAR || !lib[row.crop] || lib[row.crop].kind !== 'cash') continue;
    const p = peaks.get(`${row.year}:${row.crop}`);
    if (!p) continue;
    // months where the crop is in the field, in the harvest year
    const from = cal.plantYearOffset === -1 ? 1 : Math.max(1, Math.ceil(cal.plantDoy / 30.5));
    const to = Math.min(12, Math.ceil(cal.endDoy / 30.5));
    let bestM = null, bestV = -Infinity;
    for (let m = from; m <= to; m++) { const v = ndvi.get(`${row.year}-${m}`); if (v !== undefined && v > bestV) { bestV = v; bestM = m; } }
    if (bestM === null) continue;
    const e = Math.abs(p.doy - MID_MONTH_DOY[bestM - 1]);
    errs.push(e); dateErrors.push({ crop: row.crop, year: row.year, errDays: e, simulatedPeakDoy: p.doy, measuredPeakMonth: bestM });
  }
  const cropDates = errs.length >= 3
    ? { status: mean(errs) <= DATE_TOLERANCE_DAYS ? 'pass' : 'fail', meanAbsErrorDays: r1(mean(errs)), n: errs.length, resolution: 'month' }
    : { status: 'not-run', meanAbsErrorDays: null, n: errs.length, resolution: 'month' };

  const yields = sum.episodes.filter((e) => e.role === 'cash' && e.year > VALIDATION_FIRST_YEAR).map((e) => ({ crop: e.crop, year: e.year, yield: e.yield, unit: e.unit }));
  return { bareDays, cropDates, yields, pairs, dateErrors };
}
