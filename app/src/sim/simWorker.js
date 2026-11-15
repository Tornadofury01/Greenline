// Web worker: runs the /scoring/engine daily simulator off the main thread so the phone stays smooth.
//   in : { type: 'run',  runId, field, plans:[{ id, crops, controls }], years, scen, money }
//        { type: 'band', runId, field, plans:[...], scen, money }   (the same plans through every past season)
//   out: { type: 'progress', runId, done, total }  then  { type: 'result', runId, ... }  or  { type: 'error', runId, message }
// Nothing here uses fs, fetch or the DOM. The field file is passed in by the screen.
import { createSimulation, PEST_IDS } from '@scoring/engine/index.js';
import { slotsFor, buildPlan, engineConfig, pastYears, COLS } from './simSetup.js';

function runOne(field, slots, p, years, scen, money, onProgress) {
  const plan = buildPlan(slots, p.crops, p.controls, p.id);
  const sim = createSimulation(engineConfig({ field, slots, plan, years, scen, money }));
  const S = sim.state;
  const total = (sim.config.years * 365) | 0;
  const cols = Object.fromEntries(COLS.map((c) => [c, new Float32Array(total + 400)]));
  const cropIdx = new Int16Array(total + 400), cropNames = [];
  const date0 = S.dayNum + 1;
  let n = 0;
  while (!sim.done()) {
    const r = sim.step();
    if (n >= cropIdx.length) break;
    const c = S.cum;
    cols.rain[n] = r.rain; cols.tmax[n] = r.tmax; cols.tmin[n] = r.tmin; cols.irr[n] = r.irrigation; cols.rz[n] = r.rootZoneWaterMm; cols.rzCap[n] = r.rootZoneCapacityMm;
    cols.stress[n] = r.waterStress; cols.canopy[n] = r.canopyCover; cols.ground[n] = r.groundCover; cols.residue[n] = r.residueCover; cols.biomass[n] = r.biomassLbAc;
    cols.stage[n] = r.stage; cols.eros[n] = r.erosionTonsPerAcre; cols.minN[n] = r.mineralNLb; cols.som[n] = r.somPct; cols.profit[n] = c.revenue - c.cost;
    cols.nFix[n] = r.nFixedLb; cols.drain[n] = r.drainage; cols.runoff[n] = r.runoff;
    for (const id of PEST_IDS) cols[id][n] = r.pestRisk?.[id] ?? 0;
    const name = r.crop ?? 'none';
    let k = cropNames.indexOf(name); if (k < 0) { k = cropNames.length; cropNames.push(name); }
    cropIdx[n] = k;
    n++;
    if (onProgress && n % 365 === 0) onProgress(n, total);
  }
  const summary = sim.summary();
  const trim = (a) => a.slice(0, n);
  return {
    id: p.id, days: n, date0, cols: Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, trim(v)])), cropIdx: trim(cropIdx), cropNames,
    episodes: summary.episodes, yearly: summary.yearly, totals: summary.totals, perYear: summary.perYear, soil: summary.soil,
    events: summary.events, ledger: summary.ledger, placeholderSlots: summary.placeholderSlots, weatherSources: summary.weatherSources,
  };
}

// Percentile of a sorted array.
const pct = (sorted, q) => { const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };

/** One plan, first rotation year only, under each past season's real weather: running profit by day, and the year-end profit. */
function bandOne(field, slots, p, scen, money) {
  const first = { ...p, crops: [p.crops[0]] };
  const years = pastYears(field);
  const curves = [], finals = [];
  for (const y of years) {
    const r = runOne(field, slots, first, 1, { ...scen, kind: 'past', year: y }, money, null);
    curves.push(r.cols.profit); finals.push({ year: y, profit: r.totals.revenueUsd - r.totals.variableCostUsd, yield: r.episodes.find((e) => e.role === 'cash')?.yield ?? null });
  }
  const len = Math.min(...curves.map((c) => c.length));
  const lo = new Float32Array(len), mid = new Float32Array(len), hi = new Float32Array(len);
  const tmp = new Float32Array(curves.length);
  for (let d = 0; d < len; d++) {
    for (let i = 0; i < curves.length; i++) tmp[i] = curves[i][d];
    const s = Array.from(tmp).sort((a, b) => a - b);
    lo[d] = pct(s, 0.1); mid[d] = pct(s, 0.5); hi[d] = pct(s, 0.9);
  }
  return { id: p.id, seasons: years.length, lo, mid, hi, finals };
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    const slots = slotsFor(m.field);
    if (m.type === 'run') {
      const out = m.plans.map((p, i) => runOne(m.field, slots, p, m.years, m.scen, m.money, (d, t) => self.postMessage({ type: 'progress', runId: m.runId, done: i * t + d, total: m.plans.length * t })));
      self.postMessage({ type: 'result', runId: m.runId, plans: out }, out.flatMap((o) => [...Object.values(o.cols).map((a) => a.buffer), o.cropIdx.buffer]));
    } else if (m.type === 'band') {
      const out = m.plans.map((p) => bandOne(m.field, slots, p, m.scen, m.money));
      self.postMessage({ type: 'band', runId: m.runId, plans: out });
    }
  } catch (err) {
    self.postMessage({ type: 'error', runId: m.runId, message: String(err?.message ?? err) });
  }
};
