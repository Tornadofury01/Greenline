// Farm game worker: runs the SAME daily engine as the simulator (/scoring/engine, unchanged) for ONE plot.
// The game keeps a small pool of these and runs the 4 plots (+ the hidden "farm today" run) side by side.
//   in : { type: 'run', reqId, field, modelFile, plan: { id, crops: [{main, cover}], controls: {tillage, nScale, irrigation} },
//          weatherYears: [y1..yk], prevCrop, animate }
//   out: { type: 'result', reqId, run }  or  { type: 'error', reqId, message }
// Every number the game shows comes from here. Nothing is invented: when a value can't be computed it is null.
import library from '@content/crop-library.json';
import placeholders from '@content/model-placeholders.json';
import economics from '@content/economics.json';
import { makeSlots } from '@scoring/modelSlots.js';
import { createSimulation, makeWeather, pricesFromField, PEST_TABLE } from '@scoring/engine/index.js';
import { BIOMASS_G_M2_TO_LB_AC } from '@scoring/engine/constants.js';
import { metricsOf } from '@scoring/v2/metrics.js';
import { buildPlan, START_YEAR, libById } from '../sim/simSetup.js';
import { playedStructure } from './plots.js';

const DAY_KEYS = ['rain', 'tmax', 'rz', 'rzCap', 'stress', 'canopy', 'ground', 'residue', 'stage', 'eros', 'nShare', 'pest', 'irr', 'bare'];

function runOne(field, slots, weather, prices, p, weatherYears, animate) {
  const k = weatherYears.length;
  const controls = { tillage: p.controls.tillage, irrigation: p.controls.irrigation ?? 'none', nitrogen: 'default', shiftDays: 0, maturity: 'full', termination: 'at-planting' };
  const plan = buildPlan(slots, p.crops.slice(0, k), controls, p.id);
  plan.management.nitrogenScale = p.controls.nScale ?? 1;
  const sim = createSimulation({ field, slots, library, plan, years: k, startYear: START_YEAR, weather, weatherYears, prices, economics });
  const lastYear = START_YEAR + k - 1;
  const cols = {};
  const cropIds = [];
  const dayCrop = [];
  const pestTop = [];
  if (animate) for (const x of DAY_KEYS) cols[x] = [];
  while (!sim.done()) {
    const r = sim.step();
    if (!animate || r.year !== lastYear) continue;
    const S = sim.state, crop = S.crop && !S.crop.fallow ? S.crop : null;
    cols.rain.push(r.rain); cols.tmax.push(r.tmax); cols.rz.push(r.rootZoneWaterMm); cols.rzCap.push(r.rootZoneCapacityMm);
    cols.stress.push(r.waterStress); cols.canopy.push(r.canopyCover); cols.ground.push(r.groundCover); cols.residue.push(r.residueCover);
    cols.stage.push(r.stage); cols.eros.push(r.erosionTonsPerAcre); cols.irr.push(r.irrigation ?? 0); cols.bare.push(r.bare ? 1 : 0);
    // Nitrogen supply share of the growing crop: N taken up so far / N its biomass needs (the engine's own fN, cumulative).
    let nShare = 1;
    if (crop && !crop.dead) {
      const needLb = crop.biomass * BIOMASS_G_M2_TO_LB_AC * (crop.def.nitrogen?.nContentOfBiomass ?? 0);
      if (needLb > 2) nShare = Math.min(1, crop.nPlant / needLb);
    }
    cols.nShare.push(nShare);
    // Expected pest loss so far = sum over the crop's pests of maxLoss x carry-over pressure x risk index (pests.js, season end rule).
    let loss = 0, top = null, topV = 0;
    for (const [id, risk] of Object.entries(r.pestRisk ?? {})) {
      const v = (PEST_TABLE[id]?.maxLoss ?? 0) * (S.pests[id]?.pressure ?? 0) * risk;
      loss += v; if (v > topV) { topV = v; top = id; }
    }
    cols.pest.push(loss); pestTop.push(top);
    const c = r.crop && r.crop !== 'fallow' ? r.crop : null;
    let idx = c ? cropIds.indexOf(c) : -1;
    if (c && idx < 0) { cropIds.push(c); idx = cropIds.length - 1; }
    dayCrop.push(idx);
  }
  const sum = sim.summary();
  return { plan, sum, cols, cropIds, dayCrop, pestTop, lastYear };
}

const bucketOf = (iso, k) => Math.min(k - 1, Math.max(0, Number(iso.slice(0, 4)) - START_YEAR));
const dayOf = (iso, year) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(year, 0, 1)) / 86400000);

// Money per played year from the engine's own ledger. Costs booked in the fall before year 1 (planting a fall crop) count in year 1.
function moneyByYear(sum, k) {
  const out = new Array(k).fill(0);
  for (const e of sum.ledger) out[bucketOf(e.date, k)] += e.usd;
  return out.map((x) => Math.round(x * 100) / 100);
}

// metricsOf leaves out the first and last calendar year of a run (it was built for 41-year runs). The game plays short runs,
// so it reads the money and season numbers over a window one year wider on each side (= exactly the played years), and the
// per-year nitrogen numbers with the real length.
function metricsFor(sum, k) {
  const wide = metricsOf(sum, { startYear: START_YEAR - 1, years: k + 2, lib: libById });
  const real = metricsOf(sum, { startYear: START_YEAR, years: k, lib: libById });
  return {
    ...wide,
    nFertilizerLbPerYear: real.nFertilizerLbPerYear, nFixedLbPerYear: real.nFixedLbPerYear, nRemovedLbPerYear: real.nRemovedLbPerYear,
    nLeachedLbPerYear: real.nLeachedLbPerYear, nBalanceLbPerYear: real.nBalanceLbPerYear, yearsRun: k,
  };
}

function seasonDetails(sum, k, weatherYears) {
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
        waterStressDays: e.waterStressDays, heatDays: e.heatDays, pestLoss: e.pestLoss, pestLossByPest: e.pestLossByPest, stageAtEnd: e.stageAtEnd,
      })),
    };
  });
}

// Things that happen on a day of the animated year: money in and out (ledger), planting, harvest, frost / heat kills.
function dayEvents(sum, year, k) {
  const out = [];
  const last = START_YEAR + k - 1;
  for (const e of sum.ledger) {
    if (bucketOf(e.date, k) !== k - 1) continue;
    const d = Number(e.date.slice(0, 4)) === last ? dayOf(e.date, year) : 0;
    out.push({ day: Math.max(0, Math.min(364, d)), kind: 'money', item: e.item, usd: e.usd, crop: e.crop ?? null });
  }
  for (const e of sum.events) {
    if (!e.date.startsWith(String(year))) continue;
    if (['planted', 'harvested', 'terminated', 'frost-kill', 'heat-kill', 'flower-frost'].includes(e.kind)) out.push({ day: dayOf(e.date, year), kind: e.kind, crop: e.crop, units: e.units });
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
    const k = m.weatherYears.length;
    const r = runOne(field, slots, weather, prices, m.plan, m.weatherYears, m.animate);
    const seasons = seasonDetails(r.sum, k, m.weatherYears);
    const day = m.animate ? Object.fromEntries(DAY_KEYS.map((x) => [x, Float32Array.from(r.cols[x])])) : null;
    const run = {
      id: m.plan.id,
      metrics: metricsFor(r.sum, k),
      st: playedStructure(r.plan, m.prevCrop ?? null),
      seasons,
      money: seasons.map((s) => s.money),
      moneyTotal: Math.round(seasons.reduce((a, s) => a + s.money, 0)),
      toleranceT: r.sum.perYear.toleranceT,
      somStart: r.sum.soil.somStartPct, somEnd: r.sum.soil.somEndPct,
      placeholderSlots: r.sum.placeholderSlots ?? slots.placeholderSlots,
      day, cropIds: r.cropIds, dayCrop: m.animate ? Int8Array.from(r.dayCrop) : null, pestTop: m.animate ? r.pestTop : null,
      events: m.animate ? dayEvents(r.sum, r.lastYear, k) : null,
      yearType: slots.slots.C.yearTypes?.find((x) => x.year === m.weatherYears[k - 1])?.type ?? null,
    };
    const transfer = day ? [...Object.values(day).map((a) => a.buffer), run.dayCrop.buffer] : [];
    self.postMessage({ type: 'result', reqId: m.reqId, run }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', reqId: m.reqId, message: String(err?.message ?? err) });
  }
};
