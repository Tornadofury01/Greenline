// Everything one field's analysis shares: the library, the model slots, one weather generator (cached), prices, and `runPlan()`
// which runs the daily engine and reduces the result to the numbers the option builder uses. Pure JS (no fs): the Node script and
// the browser build the same context.
import { createSimulation, makeWeather, planFromSlots, pricesFromField, hargreavesET0, extraterrestrialMm } from '../engine/index.js';
import { metricsOf } from './metrics.js';
import { SIM_START_YEAR, SIM_YEARS, CURRENT_ROTATION_YEARS, WARMING_2040_C } from './constants.js';

export const libById = (library) => (library.crops ? Object.fromEntries(library.crops.map((c) => [c.id, c])) : library);

/**
 * @param cfg { field, slots (makeSlots result), library, economics, scoresConfig, regional?, buyers?, constraints? }
 * constraints: { irrigationAvailable?: bool, currentTillage?: 'conventional'|'reduced'|'no-till' }
 */
export function makeContext(cfg) {
  const { field, slots, library, economics, scoresConfig } = cfg;
  const lib = libById(library);
  const A = slots.slots.A;
  return {
    field, slots, library, lib, economics, scoresConfig,
    calendars: A.cropDates,
    weather: makeWeather(field, { seed: 1 }),
    prices: pricesFromField(field, library),
    nPrice: economics?.nPricePerLb ?? 0.6,
    regional: cfg.regional ?? null,
    buyers: cfg.buyers ?? {},
    constraints: { irrigationAvailable: false, currentTillage: 'reduced', ...(cfg.constraints ?? {}) },
    cache: new Map(),
  };
}

/** Weather with a warming offset and a rain change on top of a base weather (the 2040 scenarios: simple offsets, not climate-model output). */
export function scenarioWeather(base, { warmC = 0, rain = 0 }, lat) {
  const cache = new Map();
  return {
    kind: 'scenario', fieldId: base.fieldId,
    year(y) {
      let w = cache.get(y);
      if (w) return w;
      const b = base.year(y);
      const n = b.days;
      const tmin = new Float64Array(n), tmax = new Float64Array(n), r = new Float64Array(n), et0 = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        tmin[i] = b.tmin[i] + warmC; tmax[i] = b.tmax[i] + warmC; r[i] = b.rain[i] * (1 + rain);
        et0[i] = hargreavesET0(tmin[i], tmax[i], extraterrestrialMm(lat, i + 1));
      }
      w = { year: y, days: n, rain: r, tmin, tmax, et0 };
      cache.set(y, w);
      return w;
    },
    sourceOf(y) { return base.sourceOf(y); },
  };
}

/**
 * Run a plan and reduce it. `plan` as the engine reads it (sequence + management). Returns { sum, m }.
 * years/startYear: the full run is SIM_START_YEAR..+SIM_YEARS; the search uses a shorter, later window.
 */
export function runPlan(ctx, plan, { startYear = SIM_START_YEAR, years = SIM_YEARS, weather = ctx.weather, keepSummary = false, onDay } = {}) {
  const sim = createSimulation({
    field: ctx.field, slots: ctx.slots, library: ctx.library, plan, years, startYear, economics: ctx.economics, weather, prices: ctx.prices,
  });
  const sum = sim.run(onDay ? { onDay } : undefined);
  const m = metricsOf(sum, { startYear, years, lib: ctx.lib });
  return keepSummary ? { sum, m } : { m };
}

/** The current rotation: the last CURRENT_ROTATION_YEARS years with a crop the library has a calendar for (slot A), oldest first. */
export function currentPlan(ctx, tillage = ctx.constraints.currentTillage) {
  const A = ctx.slots.slots.A;
  const known = A.cropByYear.filter((r) => ctx.lib[r.crop] && ctx.lib[r.crop].kind !== 'fallow' && A.cropDates[r.crop]).map((r) => r.year);
  const years = known.slice(-CURRENT_ROTATION_YEARS);
  const basis = years.length ? years : A.cropByYear.slice(-1).map((r) => r.year);
  const plan = planFromSlots(ctx.slots, ctx.library, { years: basis, management: { tillage } });
  return { plan, basisYears: basis, knownYears: years.length };
}

export const sourceOfSlot = (ctx, k) => ctx.slots.sources[k];
export { WARMING_2040_C };
