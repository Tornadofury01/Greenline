// Report card check 5 (erosion): simulated soil loss vs MEASURED soil loss at the USDA-ARS Riesel watersheds
// (McLennan County, Houston Black clay). Measured: daily sediment records (t/acre) of the four watersheds that were
// conventionally tilled corn / wheat cropland 2001-2019 (W12, W13, Y10, Y13), v2/data/riesel/sediment/.
// Simulated: the engine on McLennan study fields' real crop history 2001-2019, conventional tillage, same years.
// Pass rule (set before the comparison): simulated mean within a factor of 2 of measured.
//   node pipeline/v2/compare_erosion.mjs   -> shared/v2/erosion-check.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { slotsForField } from '../../scoring/modelSlots.node.js';
import { loadField, loadLibrary, loadEconomics } from '../../scoring/engine/node.js';
import { makeContext, runPlan } from '../../scoring/v2/context.js';
import { planFromSlots } from '../../scoring/engine/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const FIRST = 2001, LAST = 2019, SHEDS = ['w12', 'w13', 'y10', 'y13'];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

// measured: annual totals per watershed; a year marked "nd" (no data) is left out, a year with no event counts as 0
const yearly = {};
for (const w of SHEDS) {
  const yr = {}, nd = new Set();
  for (const line of readFileSync(resolve(root, `v2/data/riesel/sediment/sed${w}day.txt`), 'utf8').split(/\r?\n/)) {
    const m = line.trim().split(/\s+/);
    if (/^\d{4}$/.test(m[m.length - 2]) && m[m.length - 1] === 'nd') { nd.add(+m[m.length - 2]); continue; }
    if (m.length === 5 && /^\d{4}$/.test(m[3]) && Number.isFinite(Number(m[4]))) yr[+m[3]] = (yr[+m[3]] ?? 0) + Number(m[4]);
  }
  yearly[w.toUpperCase()] = { yr, nd };
}
const measuredMean = (a, b) => {
  const per = {};
  for (const [w, { yr, nd }] of Object.entries(yearly)) {
    const vals = []; for (let y = a; y <= b; y++) if (!nd.has(y)) vals.push(yr[y] ?? 0);
    per[w] = +mean(vals).toFixed(3);
  }
  return { per, mean: mean(Object.values(per)) };
};
// simulated: McLennan fields with mostly cash crops, conventional tillage, raw RUSLE (EROSION_CALIBRATION not applied)
const library = loadLibrary(), economics = loadEconomics(), scoresConfig = readJson('content/v2-scores.json');
const cash = new Set(library.crops.filter((c) => c.kind === 'cash').map((c) => c.id));
const ids = readJson('shared/v2/input-index.json').fields.filter((r) => r.countyFips === '48309').map((r) => r.id);
function simulated(a, b) {
  const per = [];
  const years = []; for (let y = a; y <= b; y++) years.push(y);
  for (const id of ids) {
    const field = loadField(id);
    if (field.soil?.waterStorage100Cm == null) continue;
    const slots = slotsForField(field);
    const cropYears = slots.slots.A.cropByYear.filter((r) => r.year >= a && r.year <= b && cash.has(r.crop)).length;
    if (cropYears < 0.75 * years.length) continue; // cropland like the Riesel watersheds, not pasture
    const ctx = makeContext({ field, slots, library, economics, scoresConfig, regional: { cropFieldShare: {} }, now: new Date().toISOString() });
    const plan = planFromSlots(slots, library, { years, management: { tillage: 'conventional' } });
    let total = 0;
    runPlan(ctx, plan, { startYear: a, years: years.length, onDay: (d) => { if (Number.isFinite(d.erosionRawTonsPerAcre ?? d.erosionTonsPerAcre)) total += d.erosionRawTonsPerAcre ?? d.erosionTonsPerAcre; } });
    per.push(total / years.length);
  }
  return { fields: per.length, mean: mean(per), median: median(per) };
}
const FIT = [1985, 2000];
const fitMeas = measuredMean(...FIT), fitSim = simulated(...FIT);
const factor = fitMeas.mean / fitSim.mean;
const testMeas = measuredMean(FIRST, LAST), testSim = simulated(FIRST, LAST);
const ratio = (testSim.mean * factor) / testMeas.mean;
const out = {
  schemaVersion: 1, rule: 'calibrated simulated mean annual soil loss within a factor of 2 of measured, on test years', status: ratio >= 0.5 && ratio <= 2 ? 'pass' : 'fail',
  calibration: { fitYears: FIT, measuredMean: +fitMeas.mean.toFixed(3), rawSimulatedMean: +fitSim.mean.toFixed(3), factor: +factor.toFixed(4), fields: fitSim.fields },
  test: { years: [FIRST, LAST], measured: { source: 'USDA-ARS Riesel watersheds W12, W13, Y10, Y13 daily sediment records', watersheds: testMeas.per, meanTonsPerAcreYear: +testMeas.mean.toFixed(3) },
    simulated: { fields: testSim.fields, county: 'McLennan (48309)', tillage: 'conventional', rawMean: +testSim.mean.toFixed(3), calibratedMean: +(testSim.mean * factor).toFixed(3) },
    ratioSimOverMeasured: +ratio.toFixed(2) },
};
writeFileSync(resolve(root, 'shared/v2/erosion-check.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
