// Where the game gets its numbers: ONE function, runSeason(). The screens only use what it returns.
// Today it returns MOCK numbers (mockRuns.js) so the UI can be seen; USING_MOCK makes the game show a "Mock numbers" tag.
//
// To plug in the engine (gameWorker.js is already written for this):
//   1. set USING_MOCK = false;
//   2. for each plot (and the hidden "today" plan) post { type: 'run', reqId, field, modelFile, plan, weatherYears, prevCrop,
//      animate } to a small pool of gameWorker.js workers and await the results (same shape as mockRun, minus scores/fit);
//   3. on the main thread add  scores = scoreOption(run.metrics, today.metrics, run.st)  and
//      fit = { water: waterCheck(m, base, field), disease: diseaseCheck(st, m.meanPestLoss, m.meanPestLoss),
//              market: marketCheck(st.cash, field, { regional: null, buyers: {} }), season: seasonCheck(m, []) }.
import { mockRun } from './mockRuns.js';
import { cropsUpTo } from './plots.js';

export const USING_MOCK = true;

/**
 * Run one season: k = years.length played years for every plot. plots: game plots; today: { crops, controls } (hidden baseline).
 * Returns { runs: [run x4], today: run } where run = gameWorker result + { scores, fit }.
 */
export async function runSeason({ plots, today, years, prevCrop }) {
  const k = years.length - 1;
  await new Promise((r) => setTimeout(r, 450)); // a short "growing" moment, like a worker round trip
  const runs = plots.map((p) => mockRun({ id: `plot${p.id}`, crops: cropsUpTo(p, k), controls: p.controls, years, prevCrop }));
  const base = today ? mockRun({ id: 'today', crops: Array.from({ length: k + 1 }, (_, i) => today.crops[i % today.crops.length]), controls: today.controls, years, prevCrop, animate: false }) : null;
  return { runs, today: base };
}
