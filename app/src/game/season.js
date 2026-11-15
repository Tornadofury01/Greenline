// One season of the game, prepared once from the 4 plot engine runs (gameWorker.js), then read day by day.
// Pure JavaScript. buildSeason() -> timeline; frameAt() -> what each plot looks like on a day; coinsAt() -> coins per plot.
import { isSetupItem } from './plots.js';

const HOT_C = 35;
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
export const monthOf = (day) => { let m = 0; while (m < 11 && day >= MONTH_START[m + 1]) m++; return m; };

/**
 * runs: [run x4] for k+1 played years; prevRuns: the runs of the season before (or null); coinsBefore: [coins per plot];
 * plots: game plots (tillage, irrigation). Returns the timeline the season view plays.
 */
export function buildSeason({ runs, prevRuns, coinsBefore, plots }) {
  const days = runs[0].day.rain.length;
  const P = runs.map((run, i) => {
    const k = run.money.length - 1;
    const prevTotal = prevRuns ? prevRuns[i].money.reduce((a, x) => a + x, 0) : 0;
    const newPrev = run.money.slice(0, k).reduce((a, x) => a + x, 0);
    const moneyEv = run.events.filter((e) => e.kind === 'money');
    const setup = moneyEv.filter((e) => isSetupItem(e.item)).reduce((a, e) => a + e.usd, 0);
    const flows = moneyEv.filter((e) => !isSetupItem(e.item));
    const cumEros = new Float32Array(days);
    let s = 0;
    for (let d = 0; d < days; d++) { s += run.day.eros[d]; cumEros[d] = s; }
    const machines = [];
    for (const e of moneyEv) if (e.item.startsWith('tillage:')) machines.push({ day: e.day, span: 8, kind: 'tractor' });
    for (const e of run.events) {
      if (e.kind === 'planted' && !machines.some((m) => Math.abs(m.day - e.day) < 4)) machines.push({ day: e.day, span: 6, kind: 'tractor' });
      if (e.kind === 'harvested') machines.push({ day: e.day, span: 10, kind: 'combine' });
    }
    const harvests = run.events.filter((e) => e.kind === 'harvested').map((e) => ({
      day: e.day, crop: e.crop, units: e.units,
      usd: moneyEv.filter((m) => m.item === `revenue:${e.crop}` && Math.abs(m.day - e.day) <= 1).reduce((a, m) => a + m.usd, 0),
    }));
    return { run, coinsBefore: coinsBefore[i], pre: newPrev - prevTotal + setup, flows, cumEros, machines, harvests, tillage: plots[i].controls.tillage, irrigationOn: plots[i].controls.irrigation !== 'none' };
  });
  return { days, plots: P, events: seasonEvents(P, days), harvestDays: [...new Set(P.flatMap((p) => p.harvests.map((h) => h.day)))].sort((a, b) => a - b) };
}

/** Coins per plot on a day: setup costs come off at the start, the rest (sprays, water, harvest) on their own day. */
export function coinsAt(S, cur) {
  return S.plots.map((p) => p.coinsBefore + p.pre + p.flows.reduce((a, f) => (f.day <= cur ? a + f.usd : a), 0));
}

/** The plot frames scene.js draws, straight from each plot's own day numbers. */
export function frameAt(S, cur, labels) {
  const i = Math.max(0, Math.min(S.days - 1, Math.floor(cur)));
  const r0 = S.plots[0].run.day;
  return {
    weather: { rain: r0.rain[i], tmax: r0.tmax[i] },
    month: monthOf(i),
    plots: S.plots.map((p, n) => {
      const d = p.run.day, c = p.run.dayCrop[i];
      const m = p.machines.find((x) => cur >= x.day && cur < x.day + x.span);
      return {
        crop: c >= 0 ? p.run.cropIds[c] : null, stage: d.stage[i], canopy: d.canopy[i], ground: d.ground[i], residue: d.residue[i],
        stress: d.stress[i], nShare: d.nShare[i], pest: d.pest[i], bare: d.bare[i] > 0, erosSoFar: p.cumEros[i], T: p.run.toleranceT,
        rzShare: d.rzCap[i] > 0 ? d.rz[i] / d.rzCap[i] : 1, irrigating: d.irr[i] > 0, irrigationOn: p.irrigationOn, tillage: p.tillage,
        machine: m ? { kind: m.kind, p: (cur - m.day) / m.span } : null, label: labels[n],
      };
    }),
  };
}

/** Live mini-meters for one plot on a day (tap a plot during the season). */
export function liveMeters(S, plot, cur) {
  const i = Math.max(0, Math.min(S.days - 1, Math.floor(cur)));
  const p = S.plots[plot], d = p.run.day, c = p.run.dayCrop[i];
  return {
    crop: c >= 0 ? p.run.cropIds[c] : null, stage: d.stage[i], water: d.rzCap[i] > 0 ? d.rz[i] / d.rzCap[i] : null, cover: d.ground[i],
    soil: p.cumEros[i], T: p.run.toleranceT, n: c >= 0 ? d.nShare[i] : null, pest: c >= 0 ? d.pest[i] : null,
    money: coinsAt(S, cur)[plot] - p.coinsBefore,
  };
}

// Season pop-ups, each with real numbers from the run and its source, pointing at the plot that suffered most.
function seasonEvents(P, days) {
  const out = [];
  const wx = P[0].run.day;
  const liveAt = (p, d) => p.run.dayCrop[d] >= 0;
  // hot months (same weather for every plot)
  for (let m = 0; m < 12; m++) {
    let n = 0;
    for (let d = MONTH_START[m]; d < Math.min(days, MONTH_START[m + 1]); d++) if (wx.tmax[d] >= HOT_C) n++;
    if (n < 8) continue;
    let plot = -1, worst = 0;
    P.forEach((p, i) => {
      let s = 0;
      for (let d = MONTH_START[m]; d < Math.min(days, MONTH_START[m + 1]); d++) if (liveAt(p, d)) s += p.run.day.stress[d];
      if (s > worst) { worst = s; plot = i; }
    });
    out.push({ day: Math.min(days - 1, MONTH_START[m + 1] - 1), plot, key: 'heat', params: { month: m, n }, src: 'power' });
  }
  // big rain days (2 in or more): the plot that lost the most soil that day
  let rains = 0;
  for (let d = 0; d < days && rains < 2; d++) {
    if (wx.rain[d] < 50) continue;
    rains++;
    let plot = -1, tons = 0;
    P.forEach((p, i) => { if (p.run.day.eros[d] > tons) { tons = p.run.day.eros[d]; plot = i; } });
    out.push({ day: d, plot: tons >= 0.05 ? plot : -1, key: tons >= 0.05 ? 'rain' : 'rainNoLoss', params: { day: d, inches: wx.rain[d] / 25.4, tons }, src: 'rain' });
  }
  P.forEach((p, i) => {
    const d = p.run.day;
    // dry spell: 3 weeks in a row short of water while a crop is in the ground
    let run = 0, done = false;
    for (let x = 0; x < days && !done; x++) {
      run = liveAt(p, x) && d.stress[x] >= 0.5 ? run + 1 : 0;
      if (run === 21) { out.push({ day: x, plot: i, key: 'dry', params: { crop: p.run.cropIds[p.run.dayCrop[x]] }, src: 'water' }); done = true; }
    }
    const pest = d.pest.findIndex((v) => v >= 0.08);
    if (pest >= 0) out.push({ day: pest, plot: i, key: 'pest', params: { crop: p.run.cropIds[p.run.dayCrop[pest]], pest: p.run.pestTop?.[pest] ?? null, pct: d.pest[pest] }, src: 'pest' });
    const lowN = d.nShare.findIndex((v, x) => v < 0.75 && liveAt(p, x) && d.stage[x] > 0.15);
    if (lowN >= 0) out.push({ day: lowN, plot: i, key: 'lowN', params: { crop: p.run.cropIds[p.run.dayCrop[lowN]] }, src: 'n' });
    for (const e of p.run.events) if (e.kind === 'frost-kill') out.push({ day: e.day, plot: i, key: 'frost', params: { crop: e.crop }, src: 'frost' });
    for (const h of p.harvests) out.push({ day: h.day, plot: i, key: 'harvest', params: { crop: h.crop, units: h.units, usd: h.usd }, src: 'harvest', harvest: true });
  });
  return out.sort((a, b) => a.day - b.day);
}
