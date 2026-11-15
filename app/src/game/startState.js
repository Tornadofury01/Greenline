// "Your field today": the state every plot starts year 1 from. Pure JavaScript, used by the game worker.
//
// Spin-up: the engine (unchanged rules) runs once over the field's real crop history (model slot A: USDA CDL labels, or Model A
// when its file exists) on the field's real monthly weather for those years, with the farm's tillage. Where that run ends
// becomes createSimulation's `initialState` (soil water, carbon / nitrogen / residue, pest pressure) for every plot.
// Soil water: Model D when a real model file gives it (e.g. SMAP as of 2025-12-31), otherwise the spun-up water.
// Farmer corrections (free play only): the last crop (replaces the newest history year) and a soil-test nitrate number.
// No crop history or weather = no spin-up: the engine defaults are used and labeled "default".
import library from '@content/crop-library.json';
import economics from '@content/economics.json';
import { createSimulation } from '@scoring/engine/index.js';
import { somPercent, residueCover } from '@scoring/engine/soilOrganic.js';
import { buildPlan, START_YEAR, pastYears, libById } from '../sim/simSetup.js';

const ORGANIC_KEYS = ['cFast', 'cSlow', 'nMin', 'nRes', 'residueLb', 'residueCoeff'];

/** History rows used for the spin-up: slot A crop years that also have 12 months of weather, oldest first. */
export function historyOf(field, slots) {
  const wx = new Set(pastYears(field));
  return (slots.slots.A.cropByYear ?? []).filter((r) => wx.has(r.year)).sort((a, b) => a.year - b.year);
}

const mainOf = (crop) => (libById[crop] && libById[crop].kind !== 'cover' ? crop : 'fallow');

/** The field's last crop (newest history row), or null. */
export function lastCropOf(field, slots) {
  const rows = historyOf(field, slots);
  return rows.length ? mainOf(rows.at(-1).crop) : null;
}

const snapshot = (S) => ({
  soilW: [...S.soil.w],
  organic: Object.fromEntries(ORGANIC_KEYS.map((k) => [k, S.organic[k]])),
  pests: Object.fromEntries(Object.entries(S.pests).map(([id, p]) => [id, { counter: p.counter, pressure: p.pressure }])),
});

/**
 * Run the history up to the day before `stopDay` (the day number before the played run's first day) and return
 * { init, history: { years, lastCrop } } or null when there is no history to run.
 * ctx = { field, slots, weather, prices }; opts = { tillage, lastCrop }.
 */
export function spinUp(ctx, { tillage, lastCrop }, stopDay) {
  const rows = historyOf(ctx.field, ctx.slots);
  if (!rows.length) return null;
  const crops = rows.map((r) => ({ main: mainOf(r.crop), cover: null }));
  if (lastCrop) crops[crops.length - 1] = { main: mainOf(lastCrop), cover: null };
  const controls = { tillage: tillage ?? 'reduced', irrigation: 'none', nitrogen: 'default', shiftDays: 0, maturity: 'full', termination: 'at-planting' };
  const plan = buildPlan(ctx.slots, crops, controls, 'history');
  const H = rows.length;
  const sim = createSimulation({
    field: ctx.field, slots: ctx.slots, library, plan, years: H, startYear: START_YEAR - H,
    weather: ctx.weather, weatherYears: rows.map((r) => r.year), prices: ctx.prices, economics,
  });
  while (!sim.done() && sim.state.dayNum < stopDay) sim.step();
  return { init: snapshot(sim.state), history: { years: rows.map((r) => r.year), lastCrop: crops.at(-1).main } };
}

/**
 * The starting state for one played run + what the card shows.
 * probeState = sim.state of a fresh played run (defaults; gives the soil's capacity and the defaults to fall back on).
 * spun = spinUp() result or null. opts = { lastCrop, soilTestNLb }.
 */
export function startStateFor({ slots, probeState, spun, opts = {} }) {
  const D = slots.slots.D, fromModelD = slots.sources?.modelD === 'model';
  const init = spun ? structuredClone(spun.init) : snapshot(probeState);
  const taw = probeState.soil.taw;
  if (fromModelD) init.soilW = taw.map((x) => x * D.rootZoneFraction);
  const soilTest = Number.isFinite(opts.soilTestNLb) && opts.soilTestNLb >= 0 ? opts.soilTestNLb : null;
  if (soilTest != null) init.organic.nMin = soilTest;
  const pests = Object.entries(init.pests).sort((a, b) => b[1].pressure - a[1].pressure);
  const hist = spun ? 'history' : 'default';
  const show = {
    waterShare: init.soilW.reduce((a, x) => a + x, 0) / taw.reduce((a, x) => a + x, 0),
    nMinLb: init.organic.nMin,
    somPct: somPercent(init.organic),
    residueCover: residueCover(init.organic),
    topPest: pests[0] ? { id: pests[0][0], pressure: pests[0][1].pressure } : null,
    lastCrop: spun?.history.lastCrop ?? null,
    historyYears: spun ? [spun.history.years[0], spun.history.years.at(-1)] : null,
    asOf: fromModelD ? D.asOf ?? null : null,
    sources: {
      water: fromModelD ? 'modelD' : hist,
      n: soilTest != null ? 'input' : hist,
      som: spun ? 'ssurgoHistory' : 'ssurgo',
      residue: hist, pests: hist,
      lastCrop: opts.lastCrop ? 'input' : spun ? (slots.sources?.modelA === 'model' ? 'modelA' : 'cdl') : null,
    },
  };
  return { init, show };
}
