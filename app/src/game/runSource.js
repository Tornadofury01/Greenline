// Where the game gets its numbers: the daily engine (/scoring/engine, unchanged) in a small pool of gameWorker.js workers.
// One engine run per plot (plus one hidden run of the farm's current rotation as the baseline), all on the same real past
// weather years. On the main thread each run gets the same six scores and four fit checks as the Plans cards
// (scoring/v2 scoreOption + fitChecks, called unchanged). Nothing is invented: a value the engine can't give stays null.
//
// Every run starts year 1 from the field's spun-up history (startState.js) with `start` = { tillage, lastCrop?, soilTestNLb? }.
// Per field the workers read: the app's field object (data/loadField.js: shared/fields/<id>.json) and the field's model file
// (data/loadModels.js: shared/v2/models/<id>.json, or null = placeholders), both passed in by the caller.
import { scoreOption } from '@scoring/v2/scores.js';
import { waterCheck, diseaseCheck, marketCheck, seasonCheck } from '@scoring/v2/fitChecks.js';
import { cropsUpTo } from './plots.js';

const POOL = Math.max(2, Math.min(4, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4));
let pool = null;
let reqSeq = 0;
const pending = new Map();

function workers() {
  if (pool) return pool;
  pool = Array.from({ length: POOL }, () => {
    const w = new Worker(new URL('./gameWorker.js', import.meta.url), { type: 'module' });
    const slot = { w, fieldKey: null, busy: 0 };
    w.onmessage = (e) => {
      const p = pending.get(e.data.reqId);
      if (!p) return;
      pending.delete(e.data.reqId);
      slot.busy--;
      if (e.data.type === 'result') p.resolve(e.data.run);
      else if (e.data.type === 'start') p.resolve(e.data.start);
      else { slot.fieldKey = null; p.reject(new Error(e.data.message)); }
    };
    w.onerror = (e) => { slot.fieldKey = null; for (const [id, p] of pending) if (p.slot === slot) { pending.delete(id); p.reject(new Error(e.message || 'worker error')); } slot.busy = 0; };
    return slot;
  });
  return pool;
}

/** Field key: the field id plus whether a model file came with it (so a newly loaded model file reaches the workers). */
export const fieldKeyOf = (field, modelFile) => `${field.field.id}|${modelFile ? 'model' : 'ph'}`;

function post(field, modelFile, msg) {
  const all = workers();
  const slot = all.reduce((b, s) => (s.busy < b.busy ? s : b), all[0]);
  const key = fieldKeyOf(field, modelFile);
  const reqId = ++reqSeq;
  msg.reqId = reqId; msg.fieldKey = key;
  if (slot.fieldKey !== key) { msg.field = field; msg.modelFile = modelFile ?? null; slot.fieldKey = key; }
  slot.busy++;
  return new Promise((resolve, reject) => { pending.set(reqId, { resolve, reject, slot }); slot.w.postMessage(msg); });
}
const runPlot = ({ field, modelFile, plan, weatherYears, prevCrop, animate, start }) => post(field, modelFile, { type: 'run', plan, weatherYears, prevCrop, animate, start });

/**
 * The state every plot starts year 1 from (startState.js), for the "Starting conditions" card.
 * start = { tillage, lastCrop?, soilTestNLb? }. Returns { waterShare, nMinLb, somPct, residueCover, topPest, lastCrop, sources, ... }.
 */
export const startConditions = ({ field, modelFile, start }) => post(field, modelFile, { type: 'start', start });

/** Scores and fit checks for one run against the baseline (same calls as scoring/v2/analyzeField.js, no 2040 scenarios). */
function judge(run, base, field) {
  const m = run.metrics, b = base?.metrics ?? m;
  const scores = scoreOption(m, b, { familyRepeatShare: run.st.familyRepeatShare, greenBridge: run.st.greenBridge });
  if (!base) scores.risk = { value: null, reasons: [] }; // risk is "vs the current rotation": no baseline, no number
  const fit = {
    water: waterCheck(m, b, field),
    disease: diseaseCheck(run.st, m.meanPestLoss, m.meanPestLoss),
    market: marketCheck(run.st.cash, field, { regional: null, buyers: {} }),
    season: seasonCheck(m, []),
  };
  return { ...run, scores, fit };
}

/**
 * Run one season: k = years.length played years for every plot. plots: game plots; today: { crops, controls } (hidden
 * baseline) or null. Returns { runs: [run x4], today: run | null, ms } where run = gameWorker result + { scores, fit }.
 */
export async function runSeason({ field, modelFile, plots, today, years, prevCrop, start }) {
  const t0 = performance.now();
  const k = years.length - 1;
  const jobs = plots.map((p) => runPlot({ field, modelFile, plan: { id: `plot${p.id}`, crops: cropsUpTo(p, k), controls: p.controls }, weatherYears: years, prevCrop, animate: true, start }));
  const todayCrops = today ? Array.from({ length: k + 1 }, (_, i) => today.crops[i % today.crops.length]) : null;
  const baseJob = today ? runPlot({ field, modelFile, plan: { id: 'today', crops: todayCrops, controls: today.controls }, weatherYears: years, prevCrop, animate: false, start }) : null;
  const [raw, baseRaw] = await Promise.all([Promise.all(jobs), baseJob]);
  const base = baseRaw ? judge(baseRaw, baseRaw, field) : null; // the baseline against itself (risk = 50 by definition)
  return { runs: raw.map((r) => judge(r, base, field)), today: base, ms: Math.round(performance.now() - t0) };
}

/** This season's setup cost per plot, $/acre, from an engine run of each plot's plan (no day arrays). */
export async function setupCosts({ field, modelFile, plots, years, prevCrop, start }) {
  const k = years.length - 1;
  const runs = await Promise.all(plots.map((p) => runPlot({ field, modelFile, plan: { id: `cost${p.id}`, crops: cropsUpTo(p, k), controls: p.controls }, weatherYears: years, prevCrop, animate: false, start })));
  return runs.map((r) => r.setupUsd);
}

/**
 * Rotations page, "Test in a bad year": runs several v2 rotations through the same past weather year (each rotation year
 * replays that year), optionally with a what-if scenario { warmC, rain }. The first plan is the baseline (today's
 * rotation): every run gets the same scores and fit checks as the game, judged against it.
 * plans: [{ id, crops: [{ main, cover }], controls, nScale }]. Returns { runs: [run], ms }.
 */
export async function testPlans({ field, modelFile, plans, year, scenario = null, prevCrop = null, start }) {
  const t0 = performance.now();
  const raw = await Promise.all(plans.map((p) => post(field, modelFile, {
    type: 'run', plan: { id: p.id, crops: p.crops, controls: { ...p.controls, nScale: p.nScale ?? 1 } },
    weatherYears: p.crops.map(() => year), prevCrop, animate: false, start, scenario,
  })));
  const base = judge(raw[0], raw[0], field);
  return { runs: [base, ...raw.slice(1).map((r) => judge(r, base, field))], ms: Math.round(performance.now() - t0) };
}
