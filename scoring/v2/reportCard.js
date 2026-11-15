// Builds the report card (shared/v2/validation.json, docs/v2-data-contract.md 2.4) from what the precompute measured on every field.
// Checks that can run now: 2 bare days, 3 crop dates, 4 yields vs NASS. Everything that needs a model that is not plugged in yet is
// "pending-model"; checks that need data we do not have yet are "not-run". Failures are shown. Pure JS.
import { BARE_TOLERANCE_DAYS, DATE_TOLERANCE_DAYS } from './validate.js';

export const YIELD_MIN_CORRELATION = 0.5;   // target to confirm: "clear year-to-year correlation"
export const YIELD_MAX_RATIO_ERROR = 0.25;  // simulated mean within 25 % of the NASS mean (to confirm)
export const MOST_FIELDS_SHARE = 0.5;       // "on most fields" = more than half
const REGION = 'Ellis County, TX (Texas Blackland)';
const r2 = (x) => Math.round(x * 100) / 100;
const r1 = (x) => Math.round(x * 10) / 10;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 4) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/**
 * @param rows [{ fieldId, bare: { default, conventional, reduced, 'no-till' }, dateErrors: [], yields: [{crop, year, yield, unit}] }]
 * @param nassYields the NASS yield rows of the county ({crop, year, value, unit, level})
 */
export function buildReportCard(rows, nassYields, { generatedAt, engineVersion, defaultTillage }) {
  const n = rows.length;
  // ---- 2 bare days
  const within = (pick) => {
    const diffs = rows.map((r) => pick(r)?.differenceDays).filter((x) => Number.isFinite(x));
    return { n: diffs.length, shareWithin: diffs.length ? r2(diffs.filter((d) => Math.abs(d) <= BARE_TOLERANCE_DAYS).length / diffs.length) : null, meanDifferenceDays: diffs.length ? r1(mean(diffs)) : null };
  };
  const bareByTillage = {};
  for (const t of ['conventional', 'reduced', 'no-till']) bareByTillage[t] = within((r) => (t === defaultTillage ? r.bare.default : r.bare[t]));
  const bd = bareByTillage[defaultTillage];
  const sim = mean(rows.map((r) => r.bare.default?.simulatedPerYear).filter(Number.isFinite));
  const meas = mean(rows.map((r) => r.bare.default?.measuredPerYear).filter(Number.isFinite));
  const check2 = {
    id: 2, nameKey: 'v2.val.check2.name', status: bd.n ? (bd.shareWithin > MOST_FIELDS_SHARE ? 'pass' : 'fail') : 'not-run', region: REGION, n: bd.n,
    measured: {
      fieldsWithin15Days: bd.shareWithin, meanSimulatedPerYear: sim == null ? null : r1(sim), meanMeasuredPerYear: meas == null ? null : r1(meas), meanDifferenceDays: bd.meanDifferenceDays,
      assumedTillage: defaultTillage, byTillage: bareByTillage, note: 'measured = Landsat 8/9 whole-outline average, which may undercount bare soil',
    },
    target: { key: 'v2.val.check2.target', params: { days: BARE_TOLERANCE_DAYS, share: MOST_FIELDS_SHARE } }, noteKey: 'v2.val.check2.note',
  };
  // ---- 3 crop dates
  const errs = rows.flatMap((r) => r.dateErrors ?? []);
  const byCrop = {};
  for (const e of errs) (byCrop[e.crop] ??= []).push(e.errDays);
  const cropRows = Object.fromEntries(Object.entries(byCrop).map(([c, a]) => [c, { n: a.length, meanAbsErrorDays: r1(mean(a)), medianAbsErrorDays: r1(median(a)) }]));
  const allErr = errs.map((e) => e.errDays);
  const check3 = {
    id: 3, nameKey: 'v2.val.check3.name', status: allErr.length ? (mean(allErr) <= DATE_TOLERANCE_DAYS ? 'pass' : 'fail') : 'not-run', region: REGION, n: allErr.length,
    measured: {
      meanAbsErrorDays: allErr.length ? r1(mean(allErr)) : null, byCrop: cropRows,
      comparison: 'simulated day of peak canopy vs the middle of the month of peak NDVI (Landsat 8/9, monthly), so about +/- 15 days of the error is resolution', calendars: 'placeholder (model A not plugged in)',
    },
    target: { key: 'v2.val.check3.target', params: { days: DATE_TOLERANCE_DAYS } }, noteKey: 'v2.val.check3.note',
  };
  // ---- 4 yields vs NASS county yields
  const simBy = new Map();
  const unitOf = {};
  for (const r of rows) for (const y of r.yields ?? []) { const k = `${y.crop}:${y.year}`; if (!simBy.has(k)) simBy.set(k, []); simBy.get(k).push(y.yield); unitOf[y.crop] = y.unit; }
  const cropsY = {};
  for (const crop of new Set(rows.flatMap((r) => (r.yields ?? []).map((y) => y.crop)))) {
    const pairs = [];
    for (const y of nassYields.filter((v) => v.crop === crop && v.level === 'county')) {
      const s = simBy.get(`${crop}:${y.year}`);
      if (s?.length) pairs.push({ year: y.year, sim: mean(s), nass: y.value, fields: s.length });
    }
    if (pairs.length < 4) { cropsY[crop] = { years: pairs.length, status: 'not-run' }; continue; }
    const r = pearson(pairs.map((p) => p.sim), pairs.map((p) => p.nass));
    const ratio = mean(pairs.map((p) => p.sim)) / mean(pairs.map((p) => p.nass));
    const mape = mean(pairs.map((p) => Math.abs(p.sim - p.nass) / p.nass));
    cropsY[crop] = {
      years: pairs.length, correlation: r == null ? null : r2(r), meanRatioSimOverNass: r2(ratio), meanAbsPercentError: r2(mape), unit: unitOf[crop],
      status: r != null && r >= YIELD_MIN_CORRELATION && Math.abs(ratio - 1) <= YIELD_MAX_RATIO_ERROR ? 'pass' : 'fail',
    };
  }
  const ys = Object.values(cropsY).filter((c) => c.status !== 'not-run');
  const check4 = {
    id: 4, nameKey: 'v2.val.check4.name', status: !ys.length ? 'not-run' : ys.every((c) => c.status === 'pass') ? 'pass' : ys.some((c) => c.status === 'pass') ? 'partial' : 'fail',
    region: REGION, n: ys.reduce((a, c) => a + c.years, 0),
    measured: { byCrop: cropsY, fitYears: [], testYears: 'all years with a NASS county yield (nothing was fitted: calibration E is a placeholder)', comparison: 'mean simulated yield over the study fields that grew the crop that year vs the NASS county yield' },
    target: { key: 'v2.val.check4.target', params: { correlation: YIELD_MIN_CORRELATION, ratioError: YIELD_MAX_RATIO_ERROR } }, noteKey: 'v2.val.check4.note',
  };
  const later = (id, status, why) => ({ id, nameKey: `v2.val.check${id}.name`, status, region: REGION, n: 0, measured: null, target: { key: `v2.val.check${id}.target`, params: {} }, noteKey: `v2.val.check${id}.${why}` });
  return {
    schemaVersion: 1, generatedAt, engineVersion, fieldsChecked: n,
    checks: [
      later(1, 'pending-model', 'needsModels'),
      check2, check3, check4,
      later(5, 'not-run', 'needsMeasurements'),
      later(6, 'pending-model', 'needsModelD'),
      later(7, 'pending-model', 'needsModelA'),
      later(8, 'not-run', 'needsInterview'),
    ],
  };
}
