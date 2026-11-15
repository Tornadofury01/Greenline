// Engine checks: node scoring/engine/selftest-engine.js
// Library, weather, water balance closes, no negatives, nitrogen closes, bare erodes more than covered, determinism,
// slots really drive the result, no earlier-model inputs, real daily weather path, frost kill, speed.
import { readFileSync, readdirSync } from 'node:fs';
import { makeSlots } from '../modelSlots.js';
import { loadPlaceholders } from '../modelSlots.node.js';
import { loadLibrary, loadField, loadEconomics } from './node.js';
import * as E from './index.js';
import { makeWeather, makeWeatherFromDaily, daysInYear, daysInMonth } from './weather.js';
import { lsFactor } from './soilWater.js';

let failed = 0;
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failed++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const lib = loadLibrary(), ph = loadPlaceholders(), eco = loadEconomics();
const libById = Object.fromEntries(lib.crops.map((c) => [c.id, c]));
const f1 = loadField('ec-251'), f2 = loadField('ec-000');
const slots1 = makeSlots({ field: f1, modelFile: null, placeholders: ph });
const slots2 = makeSlots({ field: f2, modelFile: null, placeholders: ph });
const YEARS = Array.from({ length: 18 }, (_, i) => 2008 + i);

/** n years of one crop (or 'fallow') with the slot-A calendar. */
function monoPlan(slots, id, { years = YEARS, management = {} } = {}) {
  const cal = slots.slots.A.cropDates[id];
  const entry = id === 'fallow'
    ? { crop: 'fallow', role: 'fallow', plantDoy: 1, endDoy: 365, plantYearOffset: 0 }
    : { crop: id, role: libById[id].kind, plantDoy: cal.plantDoy, endDoy: cal.endDoy, plantYearOffset: cal.plantYearOffset };
  return { id: `mono-${id}`, startYear: years[0], sequence: years.map((_, i) => ({ year: i + 1, crops: [{ ...entry }] })), management };
}
const run = (field, slots, plan, extra = {}) => E.runSimulation({ field, slots, library: lib, plan, economics: eco, ...extra });

// =================================================================================== 1. crop library
const WANT = ['winter_wheat', 'corn', 'grain_sorghum', 'cotton', 'soybeans', 'cowpea', 'cereal_rye', 'crimson_clover', 'hairy_vetch', 'sorghum_sudangrass', 'sunflower', 'sesame', 'alfalfa', 'fallow'];
check(WANT.every((id) => libById[id]) && lib.crops.length === WANT.length, 'library: the 14 Ellis County crops are all there');
check(lib.crops.every((c) => c.verified === false) && lib.verified === false, 'library: every record says "verified": false');
const GROUPS = ['temperature', 'season', 'plantingWindow', 'water', 'growth', 'groundCover', 'nitrogen', 'residue', 'pests', 'defaults'];
const live = lib.crops.filter((c) => c.kind !== 'fallow');
check(live.every((c) => GROUPS.every((g) => c[g] && Array.isArray(c.sources?.[g]) && c.sources[g].length)), 'library: every group of every crop names its source(s)');
check(lib.crops.every((c) => Object.values(c.sources).flat().every((s) => lib.sourceRefs[s])), 'library: every source id has a full citation in sourceRefs');
check(live.every((c) => c.temperature.minGrowthC < c.temperature.optMinC && c.temperature.optMinC < c.temperature.optMaxC && c.temperature.optMaxC < c.temperature.maxGrowthC), 'library: temperature limits are in order');
check(live.every((c) => { const sf = c.season.stageFractions; return sf.emerge < sf.canopyFull && sf.canopyFull <= 1 && sf.flowerStart <= sf.flowerEnd && sf.senescence < 1 && c.season.gddToMaturity > 0; }), 'library: stage fractions are in order');
check(live.every((c) => c.water.kc.mid > 0 && c.water.droughtKy > 0 && c.water.rootDepthM > 0 && c.water.depletionFractionP > 0 && c.water.depletionFractionP < 1 && c.growth.wpStarGPerM2 > 0), 'library: water and growth values are positive and in range');
const mismatch = live.filter((c) => ph.modelB.crops[c.id].droughtKy !== c.water.droughtKy).map((c) => c.id);
check(mismatch.length === 0, `placeholders: droughtKy equals the sourced library value for every crop${mismatch.length ? ' (differs: ' + mismatch.join(', ') + ')' : ''}`);
check(live.every((c) => ph.modelA.calendars[c.id] && ph.calibrationE.crops[c.id]), 'placeholders: every library crop has a calendar and a typical yield');
const winPlant = live.filter((c) => { const d = ph.modelA.calendars[c.id], w = c.plantingWindow; return d.plantDoy < w.earliestDoy - 14 || d.plantDoy > w.latestDoy + 14; }).map((c) => c.id);
check(winPlant.length === 0, `placeholder planting days sit inside (or within 14 days of) the library planting windows${winPlant.length ? ' (outside: ' + winPlant.join(', ') + ')' : ''}`);

// =================================================================================== 2. weather
{
  const w = makeWeather(f1);
  const y = w.year(2011);
  let off = 0, okMonths = true;
  for (let m = 1; m <= 12; m++) {
    const dim = daysInMonth(2011, m); let sp = 0, sx = 0, sn = 0;
    for (let d = 0; d < dim; d++) { sp += y.rain[off + d]; sx += y.tmax[off + d]; sn += y.tmin[off + d]; }
    const row = f1.climateMonthly.find((r) => r.year === 2011 && r.month === m);
    if (!near(sp, row.precipMm, 1e-6) || !near(sx / dim, row.tMaxC, 1e-6) || !near(sn / dim, row.tMinC, 1e-6)) okMonths = false;
    off += dim;
  }
  check(okMonths, 'weather: generated days keep every monthly rain total and mean min/max temperature of the field file');
  check(w.sourceOf(2011) === 'monthly' && w.sourceOf(1995) === 'climatology', 'weather: months from the file for 2008+, field climate average (rain scaled to the real yearly total) before');
  const a = makeWeather(f1).year(2015), b = makeWeather(f1).year(2015), c = makeWeather(f1, { seed: 2 }).year(2015);
  check(a.rain.every((v, i) => v === b.rain[i]) && a.tmax.every((v, i) => v === b.tmax[i]), 'weather: same field + year + seed gives identical days');
  check(a.rain.some((v, i) => v !== c.rain[i]), 'weather: another seed gives other days');
  let bad = 0; for (let i = 0; i < y.days; i++) if (y.tmin[i] >= y.tmax[i] || y.rain[i] < 0 || y.et0[i] < 0) bad++;
  check(bad === 0, 'weather: tmin < tmax, no negative rain or ET0');
  const et = mean(YEARS.map((yr) => w.year(yr).et0.reduce((p, q) => p + q, 0)));
  check(et > 1100 && et < 1800, `weather: yearly reference ET ${et.toFixed(0)} mm is plausible for North Texas (1100-1800)`);
  const dayRain = []; for (const yr of YEARS) { const d = w.year(yr); for (let i = 0; i < d.days; i++) if (d.rain[i] > 0) dayRain.push(d.rain[i]); }
  check(Math.max(...dayRain) > 50, `weather: heavy-tailed storms exist (largest day ${Math.max(...dayRain).toFixed(0)} mm over 18 years)`);
  check(near(lsFactor(3.2), 0.47, 0.03) && lsFactor(6) > lsFactor(3) && lsFactor(3) > lsFactor(1), `erosion: LS for 3.2% slope, 150 ft = ${lsFactor(3.2).toFixed(2)} (RUSLE hand calc 0.47) and rises with slope`);
}

// =================================================================================== 3. water balance, negatives, nitrogen
const rotation = (slots, ids, startYear = 2015) => {
  const cal = slots.slots.A.cropDates;
  return { id: 'rot', startYear, sequence: ids.map((id, i) => ({ year: i + 1, crops: [{ crop: id, role: libById[id].kind, plantDoy: cal[id].plantDoy, endDoy: cal[id].endDoy, plantYearOffset: cal[id].plantYearOffset }] })), management: {} };
};
{
  const plans = [
    ['cotton-sorghum-wheat conventional', f1, slots1, { ...rotation(slots1, ['cotton', 'grain_sorghum', 'winter_wheat', 'cotton', 'grain_sorghum', 'winter_wheat'], 2008) }],
    ['covers + no-till', f2, slots2, { ...rotation(slots2, ['corn', 'cereal_rye', 'soybeans', 'crimson_clover', 'grain_sorghum', 'hairy_vetch'], 2012), management: { tillage: 'no-till' } }],
    ['irrigated corn', f1, slots1, { ...monoPlan(slots1, 'corn', { years: YEARS.slice(0, 6) }), management: { irrigation: 'full' } }],
  ];
  for (const [name, fld, sl, plan] of plans) {
    const r = run(fld, sl, plan);
    check(Math.abs(r.balances.waterResidualMm) < 1e-6 && r.balances.waterMaxDailyResidualMm < 1e-6, `water balance closes: ${name} (residual ${r.balances.waterResidualMm.toExponential(1)} mm, worst day ${r.balances.waterMaxDailyResidualMm.toExponential(1)})`);
    check(Math.abs(r.balances.nitrogenResidualLb) < 1e-6, `nitrogen balance closes: ${name} (residual ${r.balances.nitrogenResidualLb.toExponential(1)} lb)`);
    if (name === 'irrigated corn') check(r.totals.irrigationMm > 0, `irrigation applied water (${r.totals.irrigationMm} mm) and the books still close`);
  }
  // nothing negative, nothing NaN, day by day
  const plan = rotation(slots1, ['cotton', 'corn', 'cereal_rye', 'soybeans', 'winter_wheat'], 2018);
  const sim = E.createSimulation({ field: f1, slots: slots1, library: lib, plan, economics: eco });
  let neg = 0, nan = 0, days = 0;
  while (!sim.done()) {
    const d = sim.step(); days++;
    const S = sim.state, o = S.organic;
    if (S.soil.w.some((v) => v < -1e-9) || o.nMin < -1e-9 || o.cFast < 0 || o.cSlow < 0 || o.residueLb < 0 || o.nRes < -1e-9 || o.nPlant < -1e-9 || (S.crop && !S.crop.fallow && (S.crop.biomass < 0 || S.crop.nPlant < -1e-9)) || d.erosionTonsPerAcre < 0 || d.runoff < 0 || d.transpiration < 0 || d.evaporation < 0 || d.drainage < 0) neg++;
    for (const k of ['rain', 'et0', 'runoff', 'transpiration', 'soilWaterMm', 'canopyCover', 'residueCover', 'biomassLbAc', 'mineralNLb', 'somPct', 'erosionTonsPerAcre', 'stage']) if (!Number.isFinite(d[k])) nan++;
  }
  check(days > 365 * 4 && neg === 0, `no negative water, nitrogen, carbon, biomass, runoff or erosion on any of ${days} days`);
  check(nan === 0, 'no NaN or infinite value in any daily record');
}

// =================================================================================== 4. bare erodes more than covered
{
  const fallow = run(f1, slots1, monoPlan(slots1, 'fallow'));
  const wheat = run(f1, slots1, monoPlan(slots1, 'winter_wheat'));
  const clover = run(f1, slots1, monoPlan(slots1, 'crimson_clover'));
  const cConv = run(f1, slots1, monoPlan(slots1, 'grain_sorghum'));
  const cNoTill = run(f1, slots1, monoPlan(slots1, 'grain_sorghum', { management: { tillage: 'no-till' } }));
  const ft = fallow.perYear.erosionTonsPerAcre;
  check(fallow.perYear.bareDays >= 360, `fallow is bare almost every day (${fallow.perYear.bareDays.toFixed(0)} days a year)`);
  check(ft > wheat.perYear.erosionTonsPerAcre && ft > clover.perYear.erosionTonsPerAcre && ft > cConv.perYear.erosionTonsPerAcre, `bare soil erodes more: fallow ${ft} t/ac/yr vs wheat ${wheat.perYear.erosionTonsPerAcre}, clover ${clover.perYear.erosionTonsPerAcre}, sorghum ${cConv.perYear.erosionTonsPerAcre}`);
  check(cNoTill.perYear.erosionTonsPerAcre < cConv.perYear.erosionTonsPerAcre && cNoTill.perYear.bareDays < cConv.perYear.bareDays, `no-till erodes less (${cNoTill.perYear.erosionTonsPerAcre} vs ${cConv.perYear.erosionTonsPerAcre} t/ac/yr) and has fewer bare days (${cNoTill.perYear.bareDays.toFixed(0)} vs ${cConv.perYear.bareDays.toFixed(0)})`);
  check(cNoTill.soil.somTrendPctPerDecade > cConv.soil.somTrendPctPerDecade && fallow.soil.somTrendPctPerDecade < cNoTill.soil.somTrendPctPerDecade, `soil carbon: no-till (${cNoTill.soil.somTrendPctPerDecade}) beats conventional (${cConv.soil.somTrendPctPerDecade}); bare fallow loses most (${fallow.soil.somTrendPctPerDecade} % per decade)`);
  check(near(cConv.soil.somTrendPctPerDecade, 0, 0.5) && near(cNoTill.soil.somTrendPctPerDecade, 0, 0.5), 'soil carbon: crops move organic matter by less than 0.5 point per decade (no runaway)');
}

// =================================================================================== 5. determinism
{
  const plan = rotation(slots1, ['cotton', 'grain_sorghum', 'winter_wheat'], 2016);
  const a = run(f1, slots1, plan), b = run(f1, slots1, plan);
  check(JSON.stringify(a) === JSON.stringify(b), 'same inputs give exactly the same output (whole summary, ledger and events)');
  const sim = E.createSimulation({ field: f1, slots: slots1, library: lib, plan, economics: eco });
  while (!sim.done()) sim.step();
  const s = sim.summary();
  check(JSON.stringify(s.totals) === JSON.stringify(a.totals) && JSON.stringify(s.episodes) === JSON.stringify(a.episodes), 'stepping day by day gives the same result as run()');
  const c = run(f1, slots1, plan, { seed: 7 });
  check(c.totals.erosionTonsPerAcre !== a.totals.erosionTonsPerAcre, 'another weather seed changes the result (the generator is the only random part)');
  const r2011 = run(f1, slots1, monoPlan(slots1, 'grain_sorghum', { years: [2012] }), { weatherYears: [2011] });
  const r2012 = run(f1, slots1, monoPlan(slots1, 'grain_sorghum', { years: [2012] }));
  check(r2011.episodes[0].yield < r2012.episodes[0].yield, `replay of 2011 (drought) gives a lower sorghum yield (${r2011.episodes[0].yield}) than 2012 weather (${r2012.episodes[0].yield} bu/ac)`);
}

// =================================================================================== 6. slots really drive the result
{
  const years = [2016, 2017, 2018];
  const base = (slots) => run(f1, slots, monoPlan(slots, 'corn', { years }));
  const b0 = base(slots1);
  const slotsWith = (extra) => makeSlots({ field: f1, modelFile: { schemaVersion: 1, fieldId: 'ec-251', ...extra }, placeholders: ph });
  check(b0.placeholderSlots.length === 5, 'run with no model file reports all five slots as placeholders');
  // Model B: very drought sensitive corn in a dry year
  const slotsB = slotsWith({ modelB: { crops: { corn: { droughtKy: 2.0, heatLossPerDay: 0.05, heatThresholdC: 30 } } } });
  const rB = base(slotsB);
  check(rB.placeholderSlots.length === 4 && !rB.placeholderSlots.includes('modelB') && rB.slotSources.modelB === 'model', 'switching slot B to a model file flips only that slot to "model"');
  check(rB.episodes.some((e, i) => e.yield !== b0.episodes[i].yield) && mean(rB.episodes.map((e) => e.yield)) < mean(b0.episodes.map((e) => e.yield)), `slot B: higher drought + heat sensitivity changes the yield (${mean(b0.episodes.map((e) => e.yield)).toFixed(1)} -> ${mean(rB.episodes.map((e) => e.yield)).toFixed(1)} bu/ac)`);
  // Calibration E
  const rE = base(slotsWith({ calibrationE: { crops: { corn: { typicalYield: 85, unit: 'bu/acre', wpScale: 0.6 } } } }));
  check(mean(rE.episodes.map((e) => e.yield)) < 0.9 * mean(b0.episodes.map((e) => e.yield)), `slot E: wpScale 0.6 lowers the yield (${mean(rE.episodes.map((e) => e.yield)).toFixed(1)} bu/ac)`);
  const rE2 = base(slotsWith({ calibrationE: { crops: { corn: { typicalYield: 85, unit: 'bu/acre', heatThresholdOffsetC: -8 } } } }));
  check(rE2.episodes.some((e, i) => e.heatFactor < b0.episodes[i].heatFactor), 'slot E: a lower heat threshold (offset -8 C) adds heat loss');
  // Model D
  const dry = base(slotsWith({ modelD: { rootZoneFraction: 0 } })), wet = base(slotsWith({ modelD: { rootZoneFraction: 1 } }));
  check(dry.soil.waterAtStartMm < b0.soil.waterAtStartMm && b0.soil.waterAtStartMm < wet.soil.waterAtStartMm, `slot D: starting soil water follows the model (${dry.soil.waterAtStartMm} < ${b0.soil.waterAtStartMm} < ${wet.soil.waterAtStartMm} mm)`);
  // Model A: other calendar -> other plan -> other result
  const cd = { ...ph.modelA.calendars, corn: { ...ph.modelA.calendars.corn, plantDoy: 110, endDoy: 235 } };
  const slotsA = slotsWith({ modelA: { cropByYear: [{ year: 2016, crop: 'corn' }, { year: 2017, crop: 'corn' }, { year: 2018, crop: 'corn' }], cropDates: cd } });
  const planBase = E.planFromSlots(makeSlots({ field: { ...f1, cropHistory: [2016, 2017, 2018].map((y) => ({ year: y, crop: 'corn' })) }, placeholders: ph }), lib, { years });
  const planA = E.planFromSlots(slotsA, lib, { years });
  check(planBase.sequence[0].crops[0].plantDoy === 79 && planA.sequence[0].crops[0].plantDoy === 110, 'slot A: planFromSlots takes planting days from the model calendar (79 -> 110)');
  const rA0 = run(f1, slots1, planBase), rA1 = run(f1, slotsA, planA);
  check(rA1.slotSources.modelA === 'model' && rA0.episodes[0].yield !== rA1.episodes[0].yield, `slot A: the model calendar changes the simulated crop (${rA0.episodes[0].yield} -> ${rA1.episodes[0].yield} bu/ac)`);
  // Model C: drought years list drives scenario years
  const slotsC = slotsWith({ modelC: { yearTypes: [{ year: 2016, type: 'drought', probability: 0.9 }, { year: 2017, type: 'wet', probability: 0.9 }], frequencies2040: { ssp245: { drought: 0.4, hot: 0.2, wet: 0.2, normal: 0.2 }, ssp585: { drought: 0.5, hot: 0.2, wet: 0.1, normal: 0.2 } } } });
  check(JSON.stringify(E.yearsOfType(slotsC.slots.C, 'drought')) === '[2016]' && JSON.stringify(E.yearsOfType(slots1.slots.C, 'drought')) === '[2000,2011]', 'slot C: scenario years of a type come from the slot (model [2016] vs placeholder [2000, 2011])');
  // a rejected model section is ignored, not half-applied
  const slotsBad = slotsWith({ modelB: { crops: { corn: { droughtKy: -3 } } } });
  check(JSON.stringify(base(slotsBad).totals) === JSON.stringify(b0.totals) && slotsBad.problems.length > 0, 'a model section that fails the checks is ignored (placeholder result) and reported');
}

// =================================================================================== 7. crop behaviour, money, pests, perennials
{
  const r = run(f1, slots1, monoPlan(slots1, 'cotton'));
  check(r.episodes.every((e) => e.revenueUsd > 0) && r.totals.revenueUsd > 0 && r.totals.variableCostUsd > 0, 'money: cash crops book revenue at harvest and costs on their dates');
  const sumLedger = r.ledger.reduce((a, l) => a + l.usd, 0);
  check(near(sumLedger, r.totals.returnAboveVariableUsd, 0.05 * r.ledger.length), `money: ledger adds up to return above variable costs ($${r.totals.returnAboveVariableUsd.toFixed(0)}, ledger $${sumLedger.toFixed(0)})`);
  check(r.ledger.some((l) => l.item.startsWith('fertilizer-N')) && r.ledger.some((l) => l.item.startsWith('plant:')) && r.ledger.some((l) => l.item.startsWith('harvest-cost')), 'money: fertilizer, planting and harvest costs are booked as separate lines');
  const cov = run(f1, slots1, monoPlan(slots1, 'cowpea'));
  check(cov.totals.revenueUsd === 0 && cov.totals.variableCostUsd > 0, 'money: cover crops earn nothing and cost seed, planting and termination');
  const leg = run(f1, slots1, monoPlan(slots1, 'hairy_vetch'));
  check(leg.totals.nFixedLb > 100 && run(f1, slots1, monoPlan(slots1, 'cereal_rye')).totals.nFixedLb === 0, `legume covers fix nitrogen (vetch ${leg.totals.nFixedLb} lb over 18 years), grasses do not`);
  const alf = run(f1, slots1, monoPlan(slots1, 'alfalfa'));
  const cuts = alf.ledger.filter((l) => l.item === 'revenue:alfalfa').length;
  check(cuts >= 18 * 3 && alf.episodes.length === 1, `alfalfa: one continuing perennial stand, ${cuts} cuttings over 18 years (about ${(cuts / 18).toFixed(1)} a year)`);
  // pests: continuous cotton builds cotton root rot pressure, rotation with sorghum keeps it lower
  const cc = run(f1, slots1, monoPlan(slots1, 'cotton'));
  const rot = run(f1, slots1, rotation(slots1, Array.from({ length: 18 }, (_, i) => (i % 2 ? 'grain_sorghum' : 'cotton')), 2008));
  const loss = (r) => mean(r.episodes.filter((e) => e.crop === 'cotton').map((e) => e.pestLossByPest['cotton-root-rot']));
  check(loss(cc) > loss(rot), `pests: continuous cotton has more root-rot loss (${(loss(cc) * 100).toFixed(1)}%) than cotton after sorghum (${(loss(rot) * 100).toFixed(1)}%)`);
  // plausible yields on the demo field (no calibration yet): within 0.5-1.6 of the placeholder typical yield
  const bands = [];
  for (const id of ['corn', 'grain_sorghum', 'cotton', 'sunflower', 'sesame', 'winter_wheat', 'soybeans']) {
    const rr = run(f1, slots1, monoPlan(slots1, id)), m = mean(rr.episodes.map((e) => e.yield)), typ = ph.calibrationE.crops[id].typicalYield;
    bands.push(`${id} ${(m / typ).toFixed(2)}x`);
    if (m / typ < 0.5 || m / typ > 1.6) check(false, `yield of ${id} is ${(m / typ).toFixed(2)} of the typical yield`);
  }
  console.log(`info yields vs placeholder typical yield, mean of 18 years (uncalibrated): ${bands.join(', ')}`);
  const covers = ['cowpea', 'sorghum_sudangrass', 'cereal_rye', 'crimson_clover', 'hairy_vetch'].map((id) => [id, mean(run(f1, slots1, monoPlan(slots1, id)).episodes.map((e) => e.yield))]);
  check(covers.every(([, v]) => v > 1000 && v < 8000), `cover crop biomass in the published range 1,000-8,000 lb/acre: ${covers.map(([id, v]) => `${id} ${v.toFixed(0)}`).join(', ')}`);
  const bad = E.validatePlan({ sequence: [{ year: 1, crops: [{ crop: 'corn', plantDoy: 400, endDoy: 217 }] }] }, lib);
  check(bad.problems.length === 1 && E.validatePlan({ sequence: [] }, lib).problems.length === 1, 'validatePlan catches impossible dates and an empty plan');
}

// =================================================================================== 8. real daily weather path + frost kill
{
  const rows = [];
  for (let d = 1; d <= 366; d++) {
    const date = new Date(Date.UTC(2020, 0, d)).toISOString().slice(0, 10);
    rows.push({ date, rain: d % 9 === 0 ? 14 : 0, tmin: d === 125 ? -6 : 14, tmax: 30 });
  }
  const w = makeWeatherFromDaily(rows, { lat: 32.3 });
  const plan = monoPlan(slots1, 'corn', { years: [2020] });
  plan.sequence[0].crops[0].plantDoy = 90; // emerged long before doy 125
  const r = run(f1, slots1, plan, { weather: w });
  check(r.episodes[0].killed === 'frost' && r.episodes[0].yield === 0, 'real daily rows work, and a -6 C night after emergence kills corn (yield 0)');
  let threw = false; try { makeWeatherFromDaily(rows.slice(0, 300), { lat: 32 }).year(2020); } catch { threw = true; }
  check(threw, 'daily weather with missing days is rejected, never gap-filled');
  const wheat = monoPlan(slots1, 'winter_wheat', { years: [2020] });
  const rw = run(f1, slots1, wheat, { weather: makeWeatherFromDaily([...Array.from({ length: 366 }, (_, i) => ({ date: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), rain: i % 7 === 0 ? 12 : 0, tmin: i === 125 ? -6 : 8, tmax: 22 })), ...Array.from({ length: 365 }, (_, i) => ({ date: new Date(Date.UTC(2019, 0, i + 1)).toISOString().slice(0, 10), rain: i % 7 === 0 ? 12 : 0, tmin: 8, tmax: 22 }))], { lat: 32.3 }) });
  check(rw.episodes[0].killed === null, 'frost-tolerant winter wheat is not killed by the same -6 C night');
}

// =================================================================================== 9. engine inputs
{
  const dir = new URL('./', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js') && !f.startsWith('selftest') && f !== 'node.js');
  const src = files.map((f) => [f, readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '')]);
  const bad = src.filter(([, t]) => /shared\/si|pipeline\/|fieldshift|\.si\.|\.si\b|\.yearType\b|cropFinal|predictedClass|seasonCrop|vegStress|node:fs|\bfetch\(|Math\.random|Date\.now|new Date\(\)/.test(t)).map(([f]) => f);
  check(bad.length === 0, `engine files read no earlier model output, no fs, no fetch, no clock or Math.random${bad.length ? ' (found in: ' + bad.join(', ') + ')' : ''}`);
  const fieldKeys = new Set(); // which keys of the field file does the engine touch?
  const used = [...src.map(([, t]) => t).join('\n').matchAll(/field\.(\w+)/g)].map((m) => m[1]);
  for (const k of used) fieldKeys.add(k);
  const allowed = new Set(['field', 'soil', 'terrain', 'climateMonthly', 'climateYearly', 'market', 'cropHistory']);
  check([...fieldKeys].every((k) => allowed.has(k)), `engine reads only these parts of the field file: ${[...fieldKeys].join(', ')}`);
}

// =================================================================================== 10. speed
{
  const ids = ['ec-251', 'ec-000', 'ec-120', 'ec-199', 'ec-299'];
  const fields = ids.map((id) => [loadField(id)]).map(([f]) => [f, makeSlots({ field: f, modelFile: null, placeholders: ph })]);
  const crops = ['cotton', 'corn', 'winter_wheat', 'grain_sorghum', 'crimson_clover'];
  // warm up the JIT once
  run(fields[0][0], fields[0][1], monoPlan(fields[0][1], 'cotton', { years: [2015] }));
  const cold = [], warm = [];
  for (let k = 0; k < 40; k++) {
    const [f, sl] = fields[k % fields.length], id = crops[k % crops.length], yr = 2008 + (k % 18);
    const plan = monoPlan(sl, id, { years: [yr] });
    const t0 = performance.now();
    run(f, sl, plan); // fresh weather generator every time: the slowest case
    cold.push(performance.now() - t0);
    const w = makeWeather(f); w.year(yr); w.year(yr - 1);
    const t1 = performance.now();
    run(f, sl, plan, { weather: w });
    warm.push(performance.now() - t1);
  }
  cold.sort((a, b) => a - b); warm.sort((a, b) => a - b);
  const p95 = (a) => a[Math.floor(a.length * 0.95)];
  console.log(`speed: one season incl. weather generation: mean ${mean(cold).toFixed(2)} ms, p95 ${p95(cold).toFixed(2)} ms, worst ${cold[cold.length - 1].toFixed(2)} ms; weather already cached: mean ${mean(warm).toFixed(2)} ms`);
  check(p95(cold) < 100, 'speed: one season runs in under 0.1 s (95th percentile, weather generated fresh each time)');
  const y40 = Array.from({ length: 40 }, (_, i) => 1985 + i);
  const t2 = performance.now();
  const r40 = run(f1, slots1, rotation(slots1, ['cotton', 'grain_sorghum', 'winter_wheat'].concat(['cotton', 'grain_sorghum', 'winter_wheat']), 1985), { years: 40 });
  const ms40 = performance.now() - t2;
  console.log(`speed: 40 seasons in one run (rotation of 6 repeated, 1985-2024): ${ms40.toFixed(0)} ms`);
  check(ms40 < 4000 && r40.yearly.length >= 40, `speed: a 40-season run takes ${ms40.toFixed(0)} ms (under 4 s)`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall engine checks passed');
process.exit(failed ? 1 : 0);
