// Field Shift v2: calibrate each cash crop's canopy timing to the North Texas Landsat record, FIT YEARS ONLY (1985-2013).
// The report card tests 2014-2025 (Landsat 8/9), so nothing it measures is used here.
//
// For a sample of fields the engine runs each field's real crop history (model slot A) over 1985-2013 on the current
// crop library. For every field-year with a cash crop and a clear Landsat (5/7) season, we read the crop's development
// stage f (heat-sum fraction, 0 sowing .. 1 maturity) on the middle day of the month of peak NDVI. The median f per crop
// is where the crop's canopy should be full; it becomes stageFractions.canopyFull (kept below senescence).
//   node pipeline/v2/calibrate_growth.mjs [perCounty=12]     -> pipeline/v2/growth_calibration.json (nothing else changes)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { slotsForField } from '../../scoring/modelSlots.node.js';
import { loadField, loadLibrary, loadEconomics } from '../../scoring/engine/node.js';
import { makeContext, runPlan } from '../../scoring/v2/context.js';
import { planFromSlots } from '../../scoring/engine/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const per = Number(process.argv[2] ?? 12);
const FIRST = 1986, LAST = 2013; // 1985 has no previous autumn for winter crops
const MID = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
const CROPS = ['corn', 'grain_sorghum', 'cotton', 'winter_wheat', 'soybeans', 'sunflower'];
const index = readJson('shared/v2/input-index.json').fields;
const sample = Object.values(index.reduce((a, r) => ((a[r.countyFips] ??= []).push(r), a), {}))
  .flatMap((rows) => rows.filter((_, i) => i % Math.floor(rows.length / per) === 2).slice(0, per));
const library = loadLibrary(), economics = loadEconomics(), scoresConfig = readJson('content/v2-scores.json');
const lib = Object.fromEntries(library.crops.map((c) => [c.id, c]));

const stageAtPeak = Object.fromEntries(CROPS.map((c) => [c, []]));
const peakDoy = Object.fromEntries(CROPS.map((c) => [c, []]));
for (const r of sample) {
  const field = loadField(r.id);
  if (field.soil?.waterStorage100Cm == null) continue;
  const slots = slotsForField(field);
  const A = slots.slots.A;
  const ctx = makeContext({ field, slots, library, economics, scoresConfig, regional: { cropFieldShare: {} }, now: new Date().toISOString() });
  const years = [];
  for (let y = FIRST; y <= LAST; y++) years.push(y);
  const plan = planFromSlots(slots, library, { years, management: { tillage: ctx.constraints.currentTillage } });
  const stage = new Map(); // `${year}:${doy}` -> {crop, f}
  runPlan(ctx, plan, { startYear: FIRST, years: years.length, onDay: (d) => { if (d.crop && d.crop !== 'fallow') stage.set(`${d.year}:${d.doy}`, { crop: d.crop, f: d.stage }); } });
  const ndvi = new Map(field.ndviMonthly.filter((x) => Number.isFinite(x.ndvi)).map((x) => [`${x.year}-${x.month}`, x.ndvi]));
  for (const row of A.cropByYear) {
    if (row.year < FIRST || row.year > LAST || !CROPS.includes(row.crop)) continue;
    const cal = A.cropDates[row.crop];
    const from = cal.plantYearOffset === -1 ? 1 : Math.max(1, Math.ceil(cal.plantDoy / 30.5));
    const to = Math.min(12, Math.ceil(cal.endDoy / 30.5));
    let bestM = null, bestV = -1, n = 0;
    for (let m = from; m <= to; m++) { const v = ndvi.get(`${row.year}-${m}`); if (v !== undefined) { n++; if (v > bestV) { bestV = v; bestM = m; } } }
    if (bestM == null || n < Math.max(3, (to - from + 1) * 0.6)) continue; // too cloudy to know the peak
    const s = stage.get(`${row.year}:${MID[bestM - 1]}`);
    if (!s || s.crop !== row.crop) continue;
    stageAtPeak[row.crop].push(s.f);
    peakDoy[row.crop].push(MID[bestM - 1]);
  }
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const out = { _note: `canopy timing fitted on ${FIRST}-${LAST} Landsat 5/7 peaks, ${sample.length} fields (pipeline/v2/calibrate_growth.mjs); report card tests 2014+`, crops: {} };
for (const c of CROPS) {
  const sf = lib[c].season.stageFractions;
  const med = q(stageAtPeak[c], 0.5);
  if (stageAtPeak[c].length < 30) { console.log(c, 'too few seasons', stageAtPeak[c].length); continue; }
  const canopyFull = Math.min(+(med).toFixed(3), +(sf.senescence - 0.05).toFixed(3));
  out.crops[c] = { seasons: stageAtPeak[c].length, stageAtPeakMedian: +med.toFixed(3), stageAtPeakIQR: [+q(stageAtPeak[c], 0.25).toFixed(3), +q(stageAtPeak[c], 0.75).toFixed(3)],
    canopyFullOld: sf.canopyFull, canopyFullNew: Math.max(sf.emerge + 0.1, canopyFull), senescence: sf.senescence, peakDoyMedian: q(peakDoy[c], 0.5) };
  console.log(c, JSON.stringify(out.crops[c]));
}
writeFileSync(resolve(root, 'pipeline/v2/growth_calibration.json'), JSON.stringify(out, null, 1));
