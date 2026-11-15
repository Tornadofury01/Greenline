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
export const MIN_SCENES = 4;              // clear scenes in the crop's season needed to date its peak
export const SOIL_MOISTURE_MIN_R = 0.6;   // check 6: monthly correlation with SMAP root-zone moisture on a field
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const doyOfIso = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7), day = +d.slice(8, 10); return CUM[m - 1] + day + (m > 2 && isLeap(y) ? 1 : 0); };
const monthOfDoy = (y, doy) => { let m = 12; while (m > 1 && doy <= CUM[m - 1] + (m > 2 && isLeap(y) ? 1 : 0)) m--; return m; };
function pearson(xs, ys) {
  const n = xs.length; if (n < 4) return null;
  const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Run the real crop history of 2014..last year and compare with the measurements. `tillage` = the management assumed for the field. */
export function validateField(ctx, { tillage = ctx.constraints.currentTillage } = {}) {
  const { field, slots, library, lib } = ctx;
  const A = slots.slots.A;
  const last = Math.max(...A.cropByYear.map((r) => r.year));
  const years = [];
  for (let y = VALIDATION_FIRST_YEAR; y <= last; y++) years.push(y);
  const plan = planFromSlots(slots, library, { years, management: { tillage } });
  const canopy = new Map(); // `${year}:${crop}` -> [[doy, cc]]
  const water = new Map();  // `${year}-${month}` -> [sum of root-zone fraction, days]
  const { sum } = runPlan(ctx, plan, {
    startYear: VALIDATION_FIRST_YEAR, years: years.length, keepSummary: true,
    onDay: (r) => {
      // whole soil profile (fixed depth, like SMAP's 0-100 cm root zone); the crop's own root zone changes depth with its roots
      if (Number.isFinite(r.soilWaterMm)) {
        const m = monthOfDoy(r.year, r.doy), k = `${r.year}-${m}`, w = water.get(k) ?? [0, 0];
        w[0] += r.soilWaterMm; w[1]++; water.set(k, w);
      }
      if (!r.crop || r.crop === 'fallow' || r.canopyCover <= 0) return;
      const k = `${r.year}:${r.crop}`;
      if (!canopy.has(k)) canopy.set(k, []);
      canopy.get(k).push([r.doy, r.canopyCover]);
    },
  });
  // simulated peak = the middle of the days the canopy is within 2 % of its season maximum (the canopy curve is flat-topped,
  // so its first day at maximum would be early; satellite greenness peaks in the middle of that plateau)
  const peaks = new Map();
  for (const [k, days] of canopy) {
    const max = Math.max(...days.map((d) => d[1]));
    const top = days.filter((d) => d[1] >= 0.98 * max);
    peaks.set(k, { cc: max, doy: Math.round((top[0][0] + top[top.length - 1][0]) / 2) });
  }
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

  // ---- crop timing: simulated day of peak canopy vs the date of the greenest clear Landsat 8/9 scene (8-16 days apart) in
  // the crop's season; files without scenes fall back to the month of peak NDVI (mid-month day)
  const ndvi = new Map();
  for (const r of field.ndviMonthlyL89 ?? []) if (Number.isFinite(r.ndvi)) ndvi.set(`${r.year}-${r.month}`, r.ndvi);
  const scenes = new Map(); // year -> [[doy, ndvi]]
  for (const s of field.ndviScenesL89 ?? []) {
    const y = Number(s.d.slice(0, 4));
    if (!scenes.has(y)) scenes.set(y, []);
    scenes.get(y).push([doyOfIso(s.d), s.v]);
  }
  const useScenes = scenes.size > 0;
  const errs = [], dateErrors = [];
  for (const row of A.cropByYear) {
    const cal = A.cropDates[row.crop];
    if (!cal || row.year <= VALIDATION_FIRST_YEAR || !lib[row.crop] || lib[row.crop].kind !== 'cash') continue;
    const p = peaks.get(`${row.year}:${row.crop}`);
    if (!p) continue;
    if (useScenes) {
      // scenes while the crop is in the field, in the harvest year
      const fromDoy = cal.plantYearOffset === -1 ? 1 : cal.plantDoy, toDoy = cal.endDoy;
      const inSeason = (scenes.get(row.year) ?? []).filter(([d]) => d >= fromDoy && d <= toDoy);
      if (inSeason.length < MIN_SCENES) continue;
      const best = inSeason.reduce((a, b) => (b[1] > a[1] ? b : a));
      const e = Math.abs(p.doy - best[0]);
      errs.push(e); dateErrors.push({ crop: row.crop, year: row.year, errDays: e, simulatedPeakDoy: p.doy, measuredPeakDoy: best[0] });
      continue;
    }
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
    ? { status: mean(errs) <= DATE_TOLERANCE_DAYS ? 'pass' : 'fail', meanAbsErrorDays: r1(mean(errs)), n: errs.length, resolution: useScenes ? 'scene' : 'month' }
    : { status: 'not-run', meanAbsErrorDays: null, n: errs.length, resolution: useScenes ? 'scene' : 'month' };

  // ---- soil moisture: simulated water in the soil profile vs SMAP L4 root-zone moisture (0-100 cm), month by month (2015+)
  const smPairs = (field.smapRootzoneMonthly ?? []).map((m) => [water.get(`${m.year}-${m.month}`), m.sm]).filter(([w]) => w && w[1] >= 20).map(([w, sm]) => [w[0] / w[1], sm]);
  const smR = pearson(smPairs.map((x) => x[0]), smPairs.map((x) => x[1]));
  const soilMoisture = smPairs.length >= 24 && smR != null
    ? { status: smR >= SOIL_MOISTURE_MIN_R ? 'pass' : 'fail', correlation: Math.round(smR * 100) / 100, months: smPairs.length }
    : { status: 'not-run', correlation: null, months: smPairs.length };

  const yields = sum.episodes.filter((e) => e.role === 'cash' && e.year > VALIDATION_FIRST_YEAR).map((e) => ({ crop: e.crop, year: e.year, yield: e.yield, unit: e.unit }));
  return { bareDays, cropDates, yields, pairs, dateErrors, soilMoisture };
}
