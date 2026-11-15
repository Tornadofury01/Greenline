// MOCK DATA, NOT THE ENGINE. Made-up numbers so the game screens can be seen and tested before the engine is wired in.
// The game shows a "Mock numbers" tag whenever this file is used (runSource.js USING_MOCK).
// mockRun() returns exactly the shape gameWorker.js returns for one plot, plus `scores` and `fit` (which the real path
// computes on the main thread with scoring/v2 scoreOption + fit checks). To switch to the engine, see runSource.js.
//
// Nothing here is calibrated. Weather, growth, yields, prices and scores are simple curves with a seeded random.
import placeholders from '@content/model-placeholders.json';
import { libById } from './plots.js';

const DAYS = 365;
const T_TOL = 5;                       // mock soil loss tolerance, t/acre/yr
// mock typical yield, unit and price per crop
const YIELD = {
  corn: [110, 'bu', 4.6], grain_sorghum: [70, 'bu', 4.3], winter_wheat: [45, 'bu', 5.8], cotton: [650, 'lb', 0.72],
  soybeans: [32, 'bu', 11], sunflower: [1300, 'lb', 0.22], sesame: [600, 'lb', 0.55], alfalfa: [4, 'ton', 180],
};
const DRY = { 2011: 0.35, 2022: 0.6, 2006: 0.6, 2018: 0.8, 2009: 0.8 };   // mock rain multiplier
const WET = { 2015: 1.6, 2007: 1.5, 2019: 1.3, 2016: 1.2 };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const cal = (id) => placeholders.modelA?.calendars?.[id] ?? { plantYearOffset: 0, plantDoy: 100, endDoy: 240 };

/** Mock weather for one calendar year: daily rain (mm) and max temperature (C). */
export function mockWeather(year) {
  const r = rng(year * 7919);
  const k = DRY[year] ?? WET[year] ?? 1;
  const hot = DRY[year] ? (1 - DRY[year]) * 6 : 0;
  const rain = new Float32Array(DAYS), tmax = new Float32Array(DAYS);
  for (let d = 0; d < DAYS; d++) {
    const season = Math.sin(((d - 105) / 365) * 2 * Math.PI);
    tmax[d] = 24 + 11 * season + hot * Math.max(0, season) + (r() - 0.5) * 6;
    const wetMonth = d > 90 && d < 170 ? 1.6 : d > 250 && d < 320 ? 1.3 : 0.8;
    rain[d] = r() < 0.16 * wetMonth * Math.min(1.4, k) ? r() * 28 * k + (r() < 0.04 * k ? 40 : 0) : 0;
  }
  return { rain, tmax };
}

/** One plot, k = years.length seasons, the same carry-over idea as the engine (soil, residue, pests persist). */
export function mockRun({ id, crops, controls, years, prevCrop, animate = true }) {
  const k = years.length;
  const till = controls.tillage, nScale = controls.nScale ?? 1, irr = controls.irrigation ?? 'none';
  let residue = 0.35, som = 2.2, rz = 110, pressure = 0.3, last = prevCrop ?? null;
  const som0 = som;
  const seasons = [];
  let out = null;
  for (let y = 0; y < k; y++) {
    const wx = mockWeather(years[y]);
    const choice = crops[y] ?? { main: 'fallow', cover: null };
    const main = choice.main ?? 'fallow';
    const cash = main !== 'fallow' ? cal(main) : null;
    const plant = cash ? (cash.plantYearOffset === -1 ? 0 : cash.plantDoy) : DAYS;
    const end = cash ? cash.endDoy : DAYS;
    const coverEnd = choice.cover ? Math.max(40, plant - 1) : 0;
    const legume = libById[main]?.family === 'legume';
    const sameFamily = last && libById[last]?.family === libById[main]?.family && main !== 'fallow';
    pressure = Math.min(1, Math.max(0.1, pressure * (sameFamily ? 1.5 : 0.6) + (main === 'fallow' ? -0.1 : 0.05)));
    const cols = Object.fromEntries(['rain', 'tmax', 'rz', 'rzCap', 'stress', 'canopy', 'ground', 'residue', 'stage', 'eros', 'nShare', 'pest', 'irr', 'bare'].map((x) => [x, new Float32Array(DAYS)]));
    const dayCrop = new Int8Array(DAYS).fill(-1), cropIds = [], pestTop = [];
    const idx = (c) => { let i = cropIds.indexOf(c); if (i < 0) { cropIds.push(c); i = cropIds.length - 1; } return i; };
    const events = [];
    const money = (day, item, usd, crop = null) => events.push({ day, kind: 'money', item, usd: Math.round(usd * 100) / 100, crop });
    // setup costs (same lines as the engine books, mock-sized)
    const lib = libById[main]?.defaults?.costUsdPerAcre ?? {};
    if (main === 'fallow') money(0, 'fallow:weed-control', -22);
    else {
      money(plant, `plant:${main}`, -((lib.seed ?? 0) + (lib.plantingOps ?? 0) + (lib.other ?? 0)), main);
      if (!legume) money(plant, `fertilizer-N:${main}`, -(libById[main].defaults.nRateLbPerAcre ?? 0) * nScale * 0.6, main);
      money(plant, till === 'no-till' ? 'no-till-planter' : 'tillage:pre-plant', till === 'no-till' ? -6 : -12);
      events.push({ day: plant, kind: 'planted', crop: main });
    }
    if (choice.cover) money(0, `plant:${choice.cover}`, -25, choice.cover);
    let stressSum = 0, stressDays = 0, heatDays = 0, eros = 0, bare = 0, pestLoss = 0, irrMm = 0;
    for (let d = 0; d < DAYS; d++) {
      const rain = wx.rain[d], tmax = wx.tmax[d];
      const live = cash && d >= plant && d <= end ? main : choice.cover && d < coverEnd ? choice.cover : null;
      const stage = live === main ? (d - plant) / Math.max(1, end - plant) : live ? 0.5 : 0;
      let canopy = 0;
      if (live === main) canopy = stage < 0.6 ? 0.9 * Math.min(1, stage / 0.6) : stage < 0.85 ? 0.9 : 0.9 * (1 - (stage - 0.85) * 3);
      else if (live) canopy = 0.55;
      const et = Math.max(0, (tmax - 8) * 0.16) * (0.4 + canopy);
      let water = 0;
      if (irr !== 'none' && live === main && rz < 70) { water = irr === 'full' ? 12 : irrMm < 150 ? 8 : 0; irrMm += water; }
      rz = Math.max(5, Math.min(160, rz + rain * 0.7 + water - et));
      const share = rz / 160;
      const stress = live ? Math.max(0, Math.min(1, (0.45 - share) / 0.45)) : 0;
      if (live === main) { stressSum += stress; if (stress > 0.3) stressDays++; if (tmax >= 35) heatDays++; }
      canopy *= 1 - stress * 0.35;
      if (d === end + 1 && cash) residue = till === 'no-till' ? 0.75 : till === 'reduced' ? 0.5 : 0.2;
      if (!live) residue = Math.max(0.05, residue - 0.0015);
      const ground = Math.max(canopy, residue);
      const isBare = ground < 0.3 ? 1 : 0;
      const e = isBare ? rain * 0.006 * (till === 'conventional' ? 1.6 : 1) : rain * 0.0006;
      eros += e; bare += isBare;
      const host = live === main && main !== 'fallow';
      const pest = host ? Math.min(0.2, pressure * 0.15 * stage * (tmax > 28 ? 1.2 : 0.8)) : 0;
      if (host) pestLoss = pest;
      cols.rain[d] = rain; cols.tmax[d] = tmax; cols.rz[d] = rz; cols.rzCap[d] = 160; cols.stress[d] = stress; cols.canopy[d] = canopy;
      cols.ground[d] = ground; cols.residue[d] = residue; cols.stage[d] = stage; cols.eros[d] = e; cols.irr[d] = water; cols.bare[d] = isBare;
      cols.nShare[d] = live === main ? (legume ? 1 : Math.min(1, 0.55 + 0.45 * nScale)) : 1;
      cols.pest[d] = pest; pestTop.push(pest > 0 ? (libById[main]?.pests?.hosts?.[0] ?? null) : null);
      dayCrop[d] = live ? idx(live) : -1;
      if (irrMm && water) money(d, `irrigation:${main}`, -water * 0.35, main);
    }
    if (till === 'conventional') som -= 0.04; else if (till === 'no-till') som += 0.02;
    if (choice.cover) som += 0.02;
    const cropsOut = [];
    if (cash && main !== 'fallow') {
      const [typ, unit, price] = YIELD[main] ?? [50, 'bu', 5];
      const avgStress = stressSum / Math.max(1, end - plant);
      const nF = legume ? 1 : Math.min(1, 0.7 + 0.3 * nScale);
      const vs = Math.max(0.05, (1 - avgStress * 0.9) * (1 - pestLoss) * nF * (DRY[years[y]] ? 0.85 : 1));
      const units = typ * vs;
      money(end, `revenue:${main}`, units * price, main);
      money(end, `harvest-cost:${main}`, -((lib.harvestOps ?? 30) + units * 0.1), main);
      if (till === 'conventional') money(Math.min(364, end + 5), 'tillage:post-harvest', -12);
      events.push({ day: end, kind: 'harvested', crop: main, units: Math.round(units * 100) / 100 });
      cropsOut.push({ crop: main, yield: Math.round(units * 10) / 10, unit, yieldVsTypical: Math.round(vs * 100) / 100, revenueUsd: Math.round(units * price), killed: null, waterStressDays: stressDays, heatDays, pestLoss: Math.round(pestLoss * 1000) / 1000, stageAtEnd: 1 });
    }
    events.sort((a, b) => a.day - b.day);
    const seasonMoney = events.filter((e) => e.kind === 'money').reduce((a, e) => a + e.usd, 0);
    seasons.push({ index: y, weatherYear: years[y], money: Math.round(seasonMoney * 100) / 100, weatherSource: 'mock', erosion: Math.round(eros * 100) / 100, bareDays: bare, rainMm: Math.round(cols.rain.reduce((a, x) => a + x, 0)), somPct: Math.round(som * 100) / 100, toleranceT: T_TOL, crops: cropsOut });
    if (y === k - 1) out = { cols, cropIds, dayCrop, pestTop, events };
    if (main !== 'fallow') last = main;
  }
  const total = seasons.reduce((a, s) => a + s.money, 0);
  const avg = (f) => seasons.reduce((a, s) => a + f(s), 0) / seasons.length;
  const ero = avg((s) => s.erosion), bareD = avg((s) => s.bareDays);
  const lin = (x, z, f) => Math.round(Math.max(0, Math.min(100, ((x - z) / (f - z)) * 100)));
  const water = lin(avg((s) => s.crops[0]?.waterStressDays ?? 0), 90, 0);
  const pestV = lin(avg((s) => s.crops[0]?.pestLoss ?? 0), 0.15, 0);
  const scores = {
    profit: { value: lin(total / k, -100, 300), reasons: [{ key: 'v2.reason.profit.median', params: { usd: Math.round(total / k) } }] },
    risk: { value: lin(Math.min(...seasons.map((s) => s.money)), -250, 200), reasons: [{ key: 'v2.reason.risk.worst10', params: { usd: Math.round(Math.min(...seasons.map((s) => s.money))) } }] },
    soil: { value: Math.round((lin(ero, T_TOL * 1.5, 0) + lin(bareD, 250, 30)) / 2), reasons: [{ key: ero > T_TOL ? 'v2.reason.soil.erosionOverT' : 'v2.reason.soil.erosionUnderT', params: { erosion: Math.round(ero * 10) / 10, t: T_TOL } }, { key: 'v2.reason.soil.bareDays', params: { days: Math.round(bareD) } }] },
    water: { value: water, reasons: [{ key: 'v2.reason.water.ok', params: {} }] },
    nutrients: { value: Math.round(60 + (crops.some((c) => libById[c?.main]?.family === 'legume') ? 25 : 0) - Math.abs(nScale - 1) * 30), reasons: [{ key: 'v2.reason.nutrients.bought', params: { lb: Math.round(60 * nScale) } }] },
    pests: { value: pestV, reasons: [{ key: 'v2.reason.pests.loss', params: { pct: Math.round(avg((s) => s.crops[0]?.pestLoss ?? 0) * 100) } }] },
  };
  const repeat = crops.slice(0, k).some((c, i) => { const prev = i ? crops[i - 1]?.main : prevCrop; return prev && c?.main && c.main !== 'fallow' && libById[prev]?.family === libById[c.main]?.family; });
  const fit = {
    water: { status: water < 35 ? 'fail' : water < 60 ? 'warn' : 'pass', evidence: { key: 'v2.reason.water.ok', params: {} } },
    disease: { status: repeat ? 'warn' : 'pass', evidence: { key: repeat ? 'v2.reason.pests.grassRepeat' : 'v2.reason.pests.familiesRotate', params: {} } },
    market: { status: 'pass', evidence: { key: 'v2.reason.water.ok', params: {} } },
    season: { status: 'pass', evidence: { key: 'v2.reason.water.ok', params: {} } },
  };
  return {
    id, mock: true, seasons, money: seasons.map((s) => s.money), moneyTotal: Math.round(total), toleranceT: T_TOL,
    somStart: som0, somEnd: Math.round(som * 100) / 100, scores, fit, placeholderSlots: ['modelA', 'modelB', 'modelC', 'modelD', 'calibrationE'],
    yearType: DRY[years[k - 1]] ? 'drought' : WET[years[k - 1]] ? 'wet' : 'normal',
    day: animate ? out.cols : null, cropIds: out.cropIds, dayCrop: animate ? out.dayCrop : null, pestTop: animate ? out.pestTop : null, events: animate ? out.events : null,
  };
}
