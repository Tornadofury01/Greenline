// Farm game worker: runs the SAME daily engine as the simulator (/scoring/engine, unchanged) and the SAME scores and fit
// checks as the recommendations (/scoring/v2/scores.js, fitChecks.js, metrics.js, unchanged) for the years played so far.
//   in : { type: 'turn', runId, field, modelFile, plans: [{ id, crops, controls, nitrogenScale }], weatherYears: [y1..yk], animate: id }
//   out: { type: 'result', runId, plans: [...] }  or  { type: 'error', runId, message }
// Every number the game shows comes from here. Nothing is invented: when a value can't be computed it is null.
import library from '@content/crop-library.json';
import placeholders from '@content/model-placeholders.json';
import economics from '@content/economics.json';
import { makeSlots } from '@scoring/modelSlots.js';
import { createSimulation, makeWeather, pricesFromField } from '@scoring/engine/index.js';
import { metricsOf } from '@scoring/v2/metrics.js';
import { scoreOption } from '@scoring/v2/scores.js';
import { structureOf, waterCheck, diseaseCheck, marketCheck, seasonCheck } from '@scoring/v2/fitChecks.js';
import { buildPlan, START_YEAR, libById } from '../sim/simSetup.js';

const DAY_KEYS = ['rain', 'tmax', 'rz', 'rzCap', 'stress', 'canopy', 'ground', 'residue', 'stage', 'eros', 'biomass'];

function runOne(field, slots, weather, prices, p, weatherYears, animate) {
  const k = weatherYears.length;
  const crops = Array.from({ length: k }, (_, i) => p.crops[i % p.crops.length]);
  const plan = buildPlan(slots, crops, p.controls, p.id);
  if (p.controls.nitrogen === 'default' && p.nitrogenScale) plan.management.nitrogenScale = p.nitrogenScale;
  const sim = createSimulation({ field, slots, library, plan, years: k, startYear: START_YEAR, weather, weatherYears, prices, economics });
  const lastYear = START_YEAR + k - 1;
  const day = animate ? Object.fromEntries(DAY_KEYS.map((x) => [x, []])) : null;
  const dayCrop = [];
  while (!sim.done()) {
    const r = sim.step();
    if (!animate || r.year !== lastYear) continue;
    day.rain.push(r.rain); day.tmax.push(r.tmax); day.rz.push(r.rootZoneWaterMm); day.rzCap.push(r.rootZoneCapacityMm);
    day.stress.push(r.waterStress); day.canopy.push(r.canopyCover); day.ground.push(r.groundCover); day.residue.push(r.residueCover);
    day.stage.push(r.stage); day.eros.push(r.erosionTonsPerAcre); day.biomass.push(r.biomassLbAc);
    dayCrop.push(r.crop ?? 'none');
  }
  const sum = sim.summary();
  return { plan, sum, day, dayCrop, lastYear };
}

// Money per played year from the engine's own ledger. Costs booked in the fall before year 1 (planting a fall crop) count in year 1.
function moneyByYear(sum, k) {
  const out = new Array(k).fill(0);
  for (const e of sum.ledger) {
    const i = Math.min(k - 1, Math.max(0, Number(e.date.slice(0, 4)) - START_YEAR));
    out[i] += e.usd;
  }
  return out.map((x) => Math.round(x * 100) / 100);
}

// metricsOf leaves out the first and last calendar year of a run (it was built for 41-year runs). The game plays short runs,
// so it reads the money and season numbers over a window one year wider on each side (= exactly the played years), and the
// per-year nitrogen numbers with the real length.
function metricsFor(sum, k, lib) {
  const wide = metricsOf(sum, { startYear: START_YEAR - 1, years: k + 2, lib });
  const real = metricsOf(sum, { startYear: START_YEAR, years: k, lib });
  return {
    ...wide,
    nFertilizerLbPerYear: real.nFertilizerLbPerYear, nFixedLbPerYear: real.nFixedLbPerYear, nRemovedLbPerYear: real.nRemovedLbPerYear,
    nLeachedLbPerYear: real.nLeachedLbPerYear, nBalanceLbPerYear: real.nBalanceLbPerYear, yearsRun: k,
  };
}

function seasonDetails(run, k, weatherYears) {
  const { sum } = run;
  const money = moneyByYear(sum, k);
  return weatherYears.map((wy, i) => {
    const y = START_YEAR + i;
    const yr = sum.yearly.find((r) => r.year === y) ?? null;
    const eps = sum.episodes.filter((e) => e.year === y && e.role === 'cash');
    return {
      index: i, weatherYear: wy, money: money[i], weatherSource: sum.weatherSources?.[y] ?? null,
      erosion: yr?.erosionTonsPerAcre ?? null, bareDays: yr?.bareDays ?? null, rainMm: yr?.rainMm ?? null, somPct: yr?.somPct ?? null,
      nLeachedLb: yr?.nLeachedLb ?? null, toleranceT: sum.perYear.toleranceT,
      crops: eps.map((e) => ({
        crop: e.crop, yield: e.yield, unit: e.unit, yieldVsTypical: e.yieldVsTypical, revenueUsd: e.revenueUsd, killed: e.killed,
        waterStressDays: e.waterStressDays, heatDays: e.heatDays, pestLoss: e.pestLoss, stageAtEnd: e.stageAtEnd,
      })),
    };
  });
}

// Things that happen on a day of the animated year: tractor passes, planting, harvest (with its revenue), frost kills.
function dayEvents(sum, year) {
  const dayIdx = (iso) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(year, 0, 1)) / 86400000);
  const out = [];
  for (const e of sum.ledger) {
    if (!e.date.startsWith(String(year))) continue;
    if (e.item.startsWith('tillage:')) out.push({ day: dayIdx(e.date), kind: 'tillage' });
    else if (e.item.startsWith('revenue:')) out.push({ day: dayIdx(e.date), kind: 'revenue', usd: e.usd, crop: e.crop });
  }
  for (const e of sum.events) {
    if (!e.date.startsWith(String(year))) continue;
    if (['planted', 'harvested', 'terminated', 'frost-kill', 'flower-frost'].includes(e.kind)) out.push({ day: dayIdx(e.date), kind: e.kind, crop: e.crop, units: e.units });
  }
  return out.sort((a, b) => a.day - b.day);
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    const field = m.field;
    const slots = makeSlots({ field, modelFile: m.modelFile ?? null, placeholders });
    const weather = makeWeather(field, { seed: 1 });
    const prices = pricesFromField(field, library);
    const lib = libById;
    const k = m.weatherYears.length;
    const runs = m.plans.map((p) => ({ p, run: runOne(field, slots, weather, prices, p, m.weatherYears, p.id === m.animate) }));
    const metrics = runs.map(({ run }) => metricsFor(run.sum, k, lib));
    const baseIdx = Math.max(0, runs.findIndex(({ p }) => p.id === 'today'));
    const base = metrics[baseIdx];
    const yearType = (y) => slots.slots.C.yearTypes?.find((r) => r.year === y)?.type ?? null;
    const out = runs.map(({ p, run }, i) => {
      const mm = metrics[i];
      const st = structureOf(run.plan, lib);
      const scores = scoreOption(mm, base, st);
      const fit = {
        water: waterCheck(mm, base, field),
        disease: diseaseCheck(st, mm.meanPestLoss, mm.meanPestLoss),
        market: marketCheck(st.cash, field, { regional: null, buyers: {} }),
        season: seasonCheck(mm, []),
      };
      const seasons = seasonDetails(run, k, m.weatherYears);
      return {
        id: p.id, scores, fit, seasons,
        moneyTotal: Math.round(seasons.reduce((a, s) => a + s.money, 0)),
        toleranceT: run.sum.perYear.toleranceT,
        somStart: run.sum.soil.somStartPct, somEnd: run.sum.soil.somEndPct,
        placeholderSlots: run.sum.placeholderSlots ?? slots.placeholderSlots,
        day: run.day, dayCrop: run.dayCrop, events: run.day ? dayEvents(run.sum, run.lastYear) : null,
        familyRepeats: st.familyRepeats,
      };
    });
    self.postMessage({ type: 'result', runId: m.runId, plans: out, yearTypes: m.weatherYears.map(yearType), placeholderSlots: slots.placeholderSlots });
  } catch (err) {
    self.postMessage({ type: 'error', runId: m.runId, message: String(err?.message ?? err) });
  }
};
