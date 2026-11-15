// Display helpers for the farm simulator: units a farmer uses (inches, °F, acres) and the series each chart plots.
import { PEST_IDS } from '@scoring/engine/index.js';
import { libById } from './simSetup.js';

export const mmToIn = (mm) => mm / 25.4;
export const cToF = (c) => c * 1.8 + 32;
export const DAY_MS = 86400000;
export const isoOf = (dayNum) => new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
export const dateAt = (plan, i) => isoOf(plan.date0 + Math.min(i, plan.days - 1));

// Stage of the crop on a day: 'idle' | 'planted' | 'growing' | 'flowering' | 'filling' | 'mature'
export function stageKey(plan, i) {
  const name = plan.cropNames[plan.cropIdx[i]];
  const f = plan.cols.stage[i];
  if (!name || name === 'none' || name === 'fallow') return name === 'fallow' ? 'fallow' : 'idle';
  const sf = libById[name]?.season?.stageFractions;
  if (!sf) return 'growing';
  if (f < sf.emerge) return 'planted';
  if (f < sf.flowerStart) return 'growing';
  if (f <= sf.flowerEnd) return 'flowering';
  return f >= 1 ? 'mature' : 'filling';
}

const pestMax = (plan, i) => Math.max(0, ...PEST_IDS.map((id) => plan.cols[id][i]));
const rentAt = (money, i) => (money.rent * i) / 365;

// What each chart plots, per plan, per day index.
export const SERIES = {
  crop:      { unit: '%',   get: (p, i) => p.cols.canopy[i] * 100 },
  water:     { unit: 'in',  get: (p, i) => mmToIn(p.cols.rz[i]) },
  soil:      { unit: '%',   get: (p, i) => p.cols.ground[i] * 100 },
  nutrients: { unit: 'lb',  get: (p, i) => p.cols.minN[i] },
  pests:     { unit: '%',   get: (p, i) => pestMax(p, i) * 100 },
  money:     { unit: '$',   get: (p, i, money) => p.cols.profit[i] - rentAt(money, i) },
};

/** Chart rows: one per `stride` days over the whole run; a plan's value is null after the cursor (so play "draws" the chart). */
export function chartRows(plans, kind, cursor, money) {
  const n = Math.max(...plans.map((p) => p.days));
  const stride = Math.max(1, Math.ceil(n / 260));
  const rows = [];
  const s = SERIES[kind];
  for (let i = 0; i < n; i += stride) {
    const row = { d: i };
    plans.forEach((p, k) => { row[`p${k}`] = i <= cursor && i < p.days ? Math.round(s.get(p, i, money) * 10) / 10 : null; });
    rows.push(row);
  }
  return { rows, stride };
}

/** Running totals up to the cursor for one plan (for the "today" readout). */
export function readout(plan, i, money) {
  const c = plan.cols;
  let rain = 0, irr = 0, eros = 0;
  for (let k = 0; k <= i && k < plan.days; k++) { rain += c.rain[k]; irr += c.irr[k]; eros += c.eros[k]; }
  return {
    date: dateAt(plan, i), crop: plan.cropNames[plan.cropIdx[i]], stage: stageKey(plan, i),
    rainDay: mmToIn(c.rain[i]), high: cToF(c.tmax[i]), low: cToF(c.tmin[i]), stress: c.stress[i], irrDay: mmToIn(c.irr[i]),
    cover: c.ground[i], residue: c.residue[i], waterIn: mmToIn(c.rz[i]), capIn: mmToIn(c.rzCap[i]),
    nitrogen: c.minN[i], som: c.som[i], profit: c.profit[i] - rentAt(money, i), rainTotal: mmToIn(rain), irrTotal: mmToIn(irr), erosion: eros,
  };
}

/** Whole-run totals for the scoreboard. */
export function totalsOf(plan, money) {
  const t = plan.totals, yrs = Math.max(1, plan.days / 365.25);
  const profit = t.returnAboveVariableUsd - money.rent * yrs;
  return { profit, profitYear: profit / yrs, erosionYear: plan.perYear.erosionTonsPerAcre, tolerance: plan.perYear.toleranceT, bareYear: plan.perYear.bareDays, nLeachedYear: plan.perYear.nLeachedLb, somTrend: plan.soil.somTrendPctPerDecade, years: yrs };
}

/** The event log up to the cursor, newest last: engine events plus harvest results. */
export function eventLog(plans, cursor) {
  const out = [];
  plans.forEach((p, k) => {
    const limit = isoOf(p.date0 + Math.min(cursor, p.days - 1));
    for (const e of p.events) {
      if (e.date > limit) break;
      out.push({ date: e.date, plan: k, kind: e.kind, crop: e.crop, units: e.units });
    }
    const unitOf = Object.fromEntries(p.episodes.map((ep) => [`${ep.end}|${ep.crop}`, ep]));
    for (const ev of out) if (ev.plan === k && (ev.kind === 'harvested' || ev.kind === 'terminated')) { const ep = unitOf[`${ev.date}|${ev.crop}`]; if (ep) { ev.unit = ep.unit; ev.vs = ep.yieldVsTypical; } }
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.plan - b.plan));
}
