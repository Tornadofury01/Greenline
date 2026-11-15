// Compare report-card checks 2 (bare days) and 3 (crop dates) and the yield series on a sample of fields, for two
// folders of model slot files. Reads only; writes nothing. Fit/test split: dates are fitted on 1985-2013, checks use 2014+.
//   node pipeline/v2/compare_validation.mjs <slotsDirA> <slotsDirB> [perCounty=10]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { slotsForField } from '../../scoring/modelSlots.node.js';
import { loadField, loadLibrary, loadEconomics } from '../../scoring/engine/node.js';
import { makeContext } from '../../scoring/v2/context.js';
import { validateField } from '../../scoring/v2/validate.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const [dirA, dirB, perArg, calA, calB] = process.argv.slice(2);
const per = Number(perArg ?? 10);
const index = readJson('shared/v2/input-index.json').fields;
const sample = Object.values(index.reduce((a, r) => ((a[r.countyFips] ??= []).push(r), a), {}))
  .flatMap((rows) => rows.filter((_, i) => i % Math.floor(rows.length / per) === 5).slice(0, per));
const baseLibrary = loadLibrary(), economics = loadEconomics(), scoresConfig = readJson('content/v2-scores.json');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

// optional growth calibration (pipeline/v2/growth_calibration.json) applied in memory: canopyFull per crop
function libraryWith(cal) {
  const lib = structuredClone(baseLibrary);
  if (!cal || cal === '-') return lib;
  const c = JSON.parse(readFileSync(cal, 'utf8')).crops;
  for (const crop of lib.crops) if (c[crop.id]) crop.season.stageFractions.canopyFull = c[crop.id].canopyFullNew;
  return lib;
}
let library = baseLibrary;
function run(dir) {
  const res = { within: [], diff: [], dateErr: [], byCounty: {}, yields: {}, smR: [] };
  for (const r of sample) {
    const field = loadField(r.id);
    if (field.soil?.waterStorage100Cm == null) continue;
    const slots = slotsForField(field, { modelsDir: dir });
    const ctx = makeContext({ field, slots, library, economics, scoresConfig, regional: { cropFieldShare: {} }, now: new Date().toISOString() });
    const v = validateField(ctx);
    const c = (res.byCounty[r.countyFips] ??= { within: [], err: [] });
    if (v.bareDays.status !== 'not-run') {
      const ok = Math.abs(v.bareDays.differenceDays) <= 15 ? 1 : 0;
      res.within.push(ok); res.diff.push(v.bareDays.differenceDays); c.within.push(ok);
    }
    if (v.soilMoisture?.correlation != null) res.smR.push(v.soilMoisture.correlation);
    for (const e of v.dateErrors) { res.dateErr.push(e.errDays); c.err.push(e.errDays); }
    for (const y of v.yields) (res.yields[`${r.countyFips}:${y.crop}:${y.year}`] ??= []).push(y.yield);
  }
  return res;
}
const nass = {};
for (const r of sample) for (const y of loadField(r.id).market.yields) if (y.level === 'county') nass[`${r.countyFips}:${y.crop}:${y.year}`] = y.value;
function yieldCorr(res) {
  const out = {};
  for (const crop of ['corn', 'grain_sorghum', 'cotton', 'winter_wheat']) {
    const pts = Object.entries(res.yields).filter(([k]) => k.split(':')[1] === crop && nass[k] != null).map(([k, v]) => [mean(v), nass[k]]);
    if (pts.length < 8) continue;
    const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
    const sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0), sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0), syy = pts.reduce((a, p) => a + (p[1] - my) ** 2, 0);
    out[crop] = { r: +(sxy / Math.sqrt(sxx * syy)).toFixed(2), n: pts.length, simMean: +mx.toFixed(0), nassMean: +my.toFixed(0) };
  }
  return out;
}
for (const [name, dir, cal] of [['A', dirA, calA], ['B', dirB, calB]]) {
  library = libraryWith(cal);
  const t0 = Date.now();
  const res = run(dir);
  console.log(`\n== ${name}: ${dir}  (${sample.length} fields, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(`  bare days: ${(100 * mean(res.within)).toFixed(0)}% of fields within 15 days, mean diff ${mean(res.diff).toFixed(1)} days`);
  console.log(`  crop dates: mean error ${mean(res.dateErr).toFixed(1)} days (n ${res.dateErr.length})`);
  for (const [k, c] of Object.entries(res.byCounty)) console.log(`    ${k}: within ${(100 * mean(c.within)).toFixed(0)}%, date err ${mean(c.err).toFixed(1)}`);
  const sr = [...res.smR].sort((a, b) => a - b);
  console.log(`  soil moisture vs SMAP: ${(100 * mean(res.smR.map((x) => (x >= 0.6 ? 1 : 0)))).toFixed(0)}% of fields r >= 0.6, median r ${sr[sr.length >> 1]} (n ${sr.length})`);
  console.log('  yields vs NASS county (r):', JSON.stringify(yieldCorr(res)));
}
