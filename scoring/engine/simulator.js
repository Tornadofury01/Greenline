// The daily field simulator: a state object and step(). Pure JavaScript, no fs / fetch / React, so the browser and Node run the same code.
//
//   const sim = createSimulation({ field, slots, library, plan, years, startYear, economics });
//   sim.step()      // advance one day, returns that day's record
//   sim.run()       // advance to the end, returns the summary
//   sim.state       // everything (soil water, carbon, nitrogen, crop, pests, ledger) in plain objects
//
// Order of work every day (docs/fieldshift-v2.md "The engine"):
//   0 events due today (planting, tillage, fertilizer, harvest / termination, cuts)   1 weather in
//   2 irrigation decision + water balance (rain, runoff, evaporation, transpiration, drainage)
//   3 crop growth (heat sum, biomass from transpiration, nitrogen, heat / frost / water stress)
//   4 nitrogen leaching   5 ground cover and daily RUSLE erosion   6 two-pool soil carbon + mineral N
//   7 pest risk counters   8 money booked on the day it happens
//
// Field-specific settings come ONLY through `slots` (the result of scoring/modelSlots.js makeSlots):
//   slot A calendars (planFromSlots), slot B drought Ky + heat threshold/loss per crop, slot C year types (yearsOfType in weather.js),
//   slot D starting soil moisture, calibration E water-productivity scale, heat-threshold offset and typical yield.
// The field file gives weather (months -> days), soil and slope. Crop values come from the crop library. Nothing else is read.
import {
  ENGINE_VERSION, BARE_COVER_THRESHOLD, IRRIGATION_TRIGGER_DEPLETION, IRRIGATION_DEPTH_MM, IRRIGATION_LIMITED_BUDGET_MM, IRRIGATION_COST_PER_MM,
  TILLAGE_COST_PER_PASS, NOTILL_PLANTER_COST, FERT_PRICE_FALLBACK, BIOMASS_G_M2_TO_LB_AC,
} from './constants.js';
import { sensitivityFor } from '../modelSlots.js';
import { makeWeather, dayNumber, daysInYear, isoOfDayNumber, yearOfDayNumber, doyOfDayNumber } from './weather.js';
import { makeSoil, waterStep, rootZoneWater, erosionStep } from './soilWater.js';
import { makeOrganic, somPercent, residueCover, leach, organicStep, addResidue, tillagePass, totalN } from './soilOrganic.js';
import { makePests, pestDaily, pestRiskNow, pestSeasonEnd } from './pests.js';
import { createCrop, cropStep, kcbFor, harvestYield } from './crop.js';
import { DEFAULT_MANAGEMENT, buildEpisodes } from './plan.js';

const libById = (library) => (library.crops ? Object.fromEntries(library.crops.map((c) => [c.id, c])) : library);

/** Price per yield unit for each library crop: the field file's own NASS price when it has one, else the library default. */
export function pricesFromField(field, library) {
  const lib = libById(library), out = {};
  for (const [id, def] of Object.entries(lib)) {
    if (def.kind !== 'cash') continue;
    const row = (field.market?.recent ?? []).find((r) => r.crop === id && Number.isFinite(r.price));
    let usd = def.defaults.priceUsdPerUnit, source = 'library-default';
    if (row) {
      const lb = def.defaults.lbPerYieldUnit;
      if (row.priceUnit === '$/cwt') { usd = (row.price / 100) * lb; source = 'field-nass'; }
      else if (row.priceUnit === '$/lb') { usd = row.price * lb; source = 'field-nass'; }
      else if (row.priceUnit === '$/bu' || row.priceUnit === '$/ton') { usd = row.price; source = 'field-nass'; }
    }
    out[id] = { usdPerUnit: usd, source };
  }
  return out;
}

const emptyAcc = () => ({ rain: 0, irr: 0, runoff: 0, evap: 0, transp: 0, drain: 0, erosion: 0, bareDays: 0, leachN: 0, days: 0, minCover: 1 });

export function createSimulation(cfg) {
  const { field, library, plan } = cfg;
  const lib = libById(library);
  const sl = cfg.slots.slots ?? cfg.slots;           // makeSlots result or its .slots
  const sources = cfg.slots.sources ?? null;
  const placeholderSlots = cfg.slots.placeholderSlots ?? [];
  const startYear = cfg.startYear ?? plan.startYear;
  const years = cfg.years ?? plan.sequence.length;
  if (!Number.isInteger(startYear)) throw new Error('startYear is required (plan.startYear or cfg.startYear)');
  const mgmt = { ...DEFAULT_MANAGEMENT, ...(plan.management ?? {}) };
  const weather = cfg.weather ?? makeWeather(field, { seed: cfg.seed ?? 1 });
  const nPrice = cfg.economics?.nPricePerLb ?? FERT_PRICE_FALLBACK;
  const prices = cfg.prices ?? pricesFromField(field, library);
  const episodes = buildEpisodes(plan, lib, { startYear, years });
  const weatherYears = cfg.weatherYears ?? null;
  const wyOf = (year) => (weatherYears ? weatherYears[Math.min(Math.max(year - startYear, 0), weatherYears.length - 1)] : year);

  const startDay = Math.min(dayNumber(startYear, 1), episodes.length ? episodes[0].plantDay : Infinity);
  const endDay = dayNumber(startYear + years - 1, daysInYear(startYear + years - 1));

  const soil = makeSoil(field, sl.D.rootZoneFraction);
  const S = {
    fieldId: field.field.id, dayNum: startDay - 1, year: yearOfDayNumber(startDay), doy: 0,
    soil, organic: makeOrganic(field), pests: makePests(), crop: null,
    epIdx: 0, acc: emptyAcc(), years: [], episodes: [], ledger: [], events: [],
    cum: { rain: 0, irr: 0, runoff: 0, evap: 0, transp: 0, drain: 0, erosion: 0, bareDays: 0, leachN: 0, fertN: 0, fixN: 0, removedN: 0, revenue: 0, cost: 0, waterResidual: 0, waterResidualMaxDay: 0, mineralized: 0 },
  };
  const storage0 = soil.w[0] + soil.w[1] + soil.w[2];
  const totalN0 = totalN(S.organic);
  const somStart = somPercent(S.organic);

  const date = () => isoOfDayNumber(S.dayNum);
  const book = (item, usd, ctx = {}) => {
    S.ledger.push({ date: date(), item, usd: Math.round(usd * 100) / 100, ...ctx });
    if (usd >= 0) S.cum.revenue += usd; else S.cum.cost += -usd;
  };
  const log = (kind, extra = {}) => S.events.push({ date: date(), kind, ...extra });
  const eCrop = (id) => sl.E.crops[id] ?? { typicalYield: null, unit: null, wpScale: 1, heatThresholdOffsetC: 0 };

  // ------------------------------------------------------------------ episode start / end ----------------------
  function tillagePasses(n, tag) {
    for (let i = 0; i < n; i++) { tillagePass(S.organic, mgmt.tillage); book(`tillage:${tag}`, -TILLAGE_COST_PER_PASS); }
  }

  function startEpisode(ep) {
    const def = lib[ep.crop];
    const wr = rootZoneWater(soil, 1.0);
    const startInfo = { waterAtPlantingMm: wr.wr, waterAtPlantingShare: wr.taw > 0 ? wr.wr / wr.taw : null };
    if (ep.crop === 'fallow') {
      S.crop = { fallow: true, id: 'fallow', def, endDay: ep.endDay, ep, startInfo, plantDay: S.dayNum, events: [] };
      if (mgmt.tillage === 'conventional') tillagePasses(1, 'fallow');
      if (def?.defaults?.costUsdPerAcre?.weedControl) book('fallow:weed-control', -def.defaults.costUsdPerAcre.weedControl);
      log('fallow-start', { crop: 'fallow' });
      return;
    }
    const sens = sensitivityFor(sl.B, ep.crop), e = eCrop(ep.crop);
    const gddScale = mgmt.maturity === 'short' && def.season.daysToMaturity ? def.season.daysToMaturity.short / def.season.daysToMaturity.full : 1;
    const params = { ky: sens.droughtKy, heatLossPerDay: sens.heatLossPerDay, heatThresholdC: sens.heatThresholdC + e.heatThresholdOffsetC, wpScale: e.wpScale, gddScale };
    // pre-plant tillage, then planting
    if (mgmt.tillage === 'conventional' || mgmt.tillage === 'reduced') tillagePasses(1, 'pre-plant');
    else if (def.kind === 'cash') book('no-till-planter', -NOTILL_PLANTER_COST);
    S.crop = createCrop(def, ep, params, S.dayNum);
    S.crop.startInfo = startInfo; S.crop.ep = ep; S.crop.cost = 0; S.crop.revenue = 0; S.crop.irrMm = 0; S.crop.chemBooked = false;
    const c = def.defaults.costUsdPerAcre;
    const seedCost = (c.seed ?? 0) + (c.plantingOps ?? c.planting ?? 0) + (c.other ?? 0);
    if (seedCost) book(`plant:${ep.crop}`, -seedCost, { crop: ep.crop });
    const rate = mgmt.nitrogenLbPerAcre === 'default' || mgmt.nitrogenLbPerAcre == null ? def.defaults.nRateLbPerAcre : mgmt.nitrogenLbPerAcre;
    if (rate > 0 && def.kind === 'cash') {
      S.organic.nMin += rate; S.cum.fertN += rate;
      book(`fertilizer-N:${ep.crop}`, -rate * nPrice, { crop: ep.crop, lbN: rate });
    }
    log('planted', { crop: ep.crop });
  }

  function residueFromCrop(crop, harvestedDM, extra = {}) {
    const def = crop.def;
    const biomassLb = crop.biomass * BIOMASS_G_M2_TO_LB_AC;
    const aboveLb = Math.max(0, biomassLb - harvestedDM);
    const rootLb = biomassLb * def.growth.rootShootRatio;
    return { aboveLb, rootLb, carbonFraction: def.residue.carbonFraction, coverCoeff: def.residue.coverCoeffPerLb, ...extra };
  }

  // alfalfa (perennial) cutting
  function doCut(crop) {
    const def = crop.def;
    const { loss } = pestSeasonEnd(S.pests, def);
    const h = harvestYield(crop, loss);
    const units = h.yieldUnits;
    const nRem = Math.min(crop.nPlant, def.nitrogen.removalPerYieldUnit.n * units);
    crop.nPlant -= nRem; S.cum.removedN += nRem;
    const res = residueFromCrop(crop, h.harvestedDMLb);
    const nRes = Math.min(crop.nPlant, res.aboveLb * def.nitrogen.nContentOfBiomass);
    crop.nPlant -= nRes;
    addResidue(S.organic, { ...res, rootLb: 0, nLb: nRes });
    const price = prices[crop.id]?.usdPerUnit ?? 0;
    const rev = units * price, c = def.defaults;
    book(`revenue:${crop.id}`, rev, { crop: crop.id, units: Math.round(units * 100) / 100 });
    book(`harvest-cost:${crop.id}`, -(c.costUsdPerAcre.harvestOps / def.season.maxCuts + units * c.harvestUsdPerYieldUnit), { crop: crop.id });
    crop.cuts++; crop.cutsThisYear++; crop.cutYieldUnits += units; crop.cutRevenue += rev; crop.cutDM += h.harvestedDMLb;
    crop.biomass = 0; crop.trSum = 0; crop.tpSum = 0; crop.heatFactor = 1; crop.frostFactor = 1; crop.flowered = false; crop.stressDays = 0;
    crop.gdd = crop.gddMat * def.season.stageFractions.emerge; crop.f = def.season.stageFractions.emerge;
    log('cut', { crop: crop.id, units });
  }

  function endEpisode() {
    const crop = S.crop;
    if (!crop) return;
    S.crop = null;
    if (crop.fallow) { log('fallow-end', { crop: 'fallow' }); S.episodes.push({ crop: 'fallow', role: 'fallow', year: yearOfDayNumber(S.dayNum), start: isoOfDayNum(crop.ep.plantDay), end: date(), ...crop.startInfo, notes: crop.ep.notes, unknownCrop: !!crop.ep.unknownCrop }); return; }
    const def = crop.def, perennial = !!def.season.perennial;
    const { loss, byPest } = pestSeasonEnd(S.pests, def);
    let units = 0, harvestedDM = 0, hiEff = 0, rET = 1, revenue = 0;
    const biomassLbBefore = crop.biomass * BIOMASS_G_M2_TO_LB_AC;
    if (perennial) { units = crop.cutYieldUnits; revenue = crop.cutRevenue; harvestedDM = 0; }
    else {
      const h = harvestYield(crop, loss);
      units = h.yieldUnits; harvestedDM = h.harvestedDMLb; hiEff = h.hiEff; rET = h.rET;
      if (def.kind === 'cash') {
        const price = prices[crop.id]?.usdPerUnit ?? 0, c = def.defaults;
        revenue = units * price;
        book(`revenue:${crop.id}`, revenue, { crop: crop.id, units: Math.round(units * 100) / 100 });
        book(`harvest-cost:${crop.id}`, -(c.costUsdPerAcre.harvestOps + units * c.harvestUsdPerYieldUnit), { crop: crop.id });
      } else {
        const t = def.defaults.costUsdPerAcre.termination;
        if (t) book(`terminate:${crop.id}`, -t, { crop: crop.id });
      }
    }
    // nitrogen: grain / hay removal leaves the field, everything else in the plant goes to the residue pool
    const nRem = perennial ? 0 : Math.min(crop.nPlant, def.nitrogen.removalPerYieldUnit.n * (def.kind === 'cash' ? units : 0));
    S.cum.removedN += nRem;
    const res = residueFromCrop(crop, harvestedDM);
    addResidue(S.organic, { ...res, nLb: crop.nPlant - nRem });
    S.cum.fixN += crop.nFixed;
    const e = eCrop(crop.id);
    S.episodes.push({
      crop: crop.id, role: crop.role, year: yearOfDayNumber(S.dayNum), start: isoOfDayNum(crop.plantDay), end: date(),
      endKind: def.kind === 'cover' ? 'terminate' : 'harvest', yearsSpanned: perennial ? Math.round(((S.dayNum - crop.plantDay) / 365.25) * 10) / 10 : undefined,
      yield: Math.round(units * 100) / 100, unit: def.kind === 'cover' ? 'lb biomass/acre' : def.defaults.yieldUnit,
      typicalYield: e.typicalYield, yieldVsTypical: e.typicalYield ? Math.round((units / e.typicalYield) * 100) / 100 : null,
      biomassLbAc: Math.round(biomassLbBefore), harvestIndexUsed: Math.round(hiEff * 1000) / 1000, waterSupplyRatio: Math.round(rET * 1000) / 1000,
      waterStressDays: crop.stressDays, heatDays: crop.heatDays, heatFactor: Math.round(crop.heatFactor * 1000) / 1000, frostFactor: crop.frostFactor,
      killed: crop.dead ? crop.deadReason : null, cuts: perennial ? crop.cuts : undefined, pestLoss: Math.round(loss * 1000) / 1000, pestLossByPest: byPest,
      nFixedLb: Math.round(crop.nFixed * 10) / 10, nRemovedLb: Math.round(nRem * 10) / 10, stageAtEnd: Math.round(crop.f * 100) / 100,
      irrigationMm: crop.irrMm, revenueUsd: Math.round(revenue * 100) / 100, ...crop.startInfo, notes: crop.ep.notes,
    });
    log(def.kind === 'cover' ? 'terminated' : 'harvested', { crop: crop.id, units: Math.round(units * 100) / 100 });
    if (mgmt.tillage === 'conventional') tillagePasses(1, 'post-harvest');
  }
  const isoOfDayNum = isoOfDayNumber;

  // ------------------------------------------------------------------ one day ---------------------------------------------
  const rec = { date: '', rain: 0 };
  function advance() {
    S.dayNum += 1;
    S.year = yearOfDayNumber(S.dayNum);
    S.doy = doyOfDayNumber(S.dayNum);
    const dayEvents = [];
    if (S.doy === 1 && S.crop && !S.crop.fallow) S.crop.cutsThisYear = 0;

    // 0 events
    if (S.crop && S.dayNum >= S.crop.endDay) { endEpisode(); }
    while (S.epIdx < episodes.length && episodes[S.epIdx].plantDay <= S.dayNum) {
      const ep = episodes[S.epIdx++];
      if (S.crop) endEpisode();
      startEpisode(ep);
    }

    // 1 weather
    const w = weather.year(wyOf(S.year));
    const i = Math.min(S.doy, w.days) - 1;
    const rain = w.rain[i], tmin = w.tmin[i], tmax = w.tmax[i], et0 = w.et0[i], tmean = (tmin + tmax) / 2;
    const crop = S.crop, live = crop && !crop.fallow;
    const O = S.organic;
    const resCov = residueCover(O);

    // 2 irrigation + water balance
    let irr = 0;
    if (mgmt.irrigation !== 'none' && live && !crop.dead && crop.emerged && (crop.def.season.perennial || crop.f < 1)) {
      const rz = rootZoneWater(soil, crop.zr);
      if (rz.taw > 0 && 1 - rz.wr / rz.taw > IRRIGATION_TRIGGER_DEPLETION && rain < 5) {
        irr = IRRIGATION_DEPTH_MM;
        if (mgmt.irrigation === 'limited') irr = Math.max(0, Math.min(irr, IRRIGATION_LIMITED_BUDGET_MM - crop.irrMm));
        if (irr > 0) { crop.irrMm += irr; book(`irrigation:${crop.id}`, -irr * IRRIGATION_COST_PER_MM, { mm: irr }); }
      }
    }
    const k = live && !crop.dead ? kcbFor(crop) : { kcbMax: 0, scale: 1 };
    const water = waterStep(soil, {
      rain, irr, et0, cc: live ? crop.cc : 0, kcbMax: k.kcbMax, kcbScale: k.scale, resCover: resCov,
      zr: live ? crop.zr : 0, p: live ? crop.def.water.depletionFractionP : 0.5, growing: !!live && !crop.dead,
    });

    // 3 crop growth
    let nFixToday = 0;
    if (live) {
      const before = crop.canopyFullSeen;
      const r = cropStep(crop, { tmin, tmax, doy: S.doy }, water, O, et0);
      for (const e of r.events) { dayEvents.push(e); log(e, { crop: crop.id }); }
      nFixToday = r.nFixed;
      if (!before && crop.canopyFullSeen && !crop.chemBooked) {
        crop.chemBooked = true;
        const chem = crop.def.defaults.costUsdPerAcre.chemicals;
        if (chem) book(`chemicals:${crop.id}`, -chem, { crop: crop.id });
      }
      if (r.cutReady) doCut(crop);
    }

    // 4 leaching
    const lost = leach(O, water.drain);

    // 5 cover and erosion
    const cc = live && !crop.dead ? crop.cc : 0;
    const rc = residueCover(O);
    const ground = 1 - (1 - cc) * (1 - rc);
    const bare = ground < BARE_COVER_THRESHOLD;
    const ero = erosionStep(soil, { rain, runoff: water.runoff, cc, heightM: live ? crop.def.growth.heightM : 0, resCover: rc, supportPractice: mgmt.supportPractice });

    // 6 carbon and nitrogen pools
    const topWet = soil.w[0] / soil.taw[0];
    organicStep(O, tmean, topWet, mgmt.tillage);

    // 7 pests
    if (live && !crop.dead) pestDaily(S.pests, crop.def, { tmin, tmax, tmean, rain, topWetness: topWet, ks: water.ks, clayPct: soil.clayPct });

    // 8 books
    const a = S.acc, c = S.cum;
    a.days++; a.rain += rain; a.irr += irr; a.runoff += water.runoff; a.evap += water.evap; a.transp += water.transp; a.drain += water.drain; a.erosion += ero.tons; a.leachN += lost; if (bare) a.bareDays++;
    if (ground < a.minCover) a.minCover = ground;
    c.rain += rain; c.irr += irr; c.runoff += water.runoff; c.evap += water.evap; c.transp += water.transp; c.drain += water.drain; c.erosion += ero.tons; c.leachN += lost; if (bare) c.bareDays++;
    c.waterResidual += water.residual; if (Math.abs(water.residual) > c.waterResidualMaxDay) c.waterResidualMaxDay = Math.abs(water.residual);
    if (S.doy === daysInYear(S.year)) {
      S.years.push({
        year: S.year, days: a.days, rainMm: round(a.rain), irrigationMm: round(a.irr), runoffMm: round(a.runoff), evaporationMm: round(a.evap), transpirationMm: round(a.transp),
        drainageMm: round(a.drain), erosionTonsPerAcre: round(a.erosion, 3), bareDays: a.bareDays, nLeachedLb: round(a.leachN, 2), somPct: round(somPercent(O), 4), mineralNLb: round(O.nMin, 2),
      });
      S.acc = emptyAcc();
    }

    // record
    Object.assign(rec, {
      date: date(), dayNum: S.dayNum, year: S.year, doy: S.doy, rain, tmin, tmax, et0, irrigation: irr, runoff: water.runoff, evaporation: water.evap, transpiration: water.transp,
      drainage: water.drain, waterStress: live ? 1 - water.ks : 0, rootZoneWaterMm: water.wR, rootZoneCapacityMm: water.tawR, soilWaterMm: soil.w[0] + soil.w[1] + soil.w[2],
      crop: live ? crop.id : crop ? 'fallow' : null, stage: live ? crop.f : 0, canopyCover: cc, residueCover: rc, groundCover: ground, bare, biomassLbAc: live ? crop.biomass * BIOMASS_G_M2_TO_LB_AC : 0,
      erosionTonsPerAcre: ero.tons, mineralNLb: O.nMin, nFixedLb: nFixToday, somPct: somPercent(O), pestRisk: live ? pestRiskNow(S.pests, crop.def) : {},
      events: dayEvents,
    });
    S.last = rec;
    return rec;
  }
  const round = (x, d = 1) => { const m = 10 ** d; return Math.round(x * m) / m; };
  const done = () => S.dayNum >= endDay;

  function finishRun() {
    if (S.crop) endEpisode();
  }

  const out = {
    state: S, episodes, config: { startYear, years, mgmt },
    done,
    /** Advance one day. Returns the day record (a fresh copy). */
    step() {
      if (done()) throw new Error('simulation is finished');
      const r = advance();
      if (done()) finishRun();
      return { ...r, events: [...r.events] };
    },
    run({ onDay } = {}) {
      while (!done()) { const r = advance(); if (onDay) onDay({ ...r, events: [...r.events] }); }
      finishRun();
      return out.summary();
    },
    summary() {
      const c = S.cum, o = S.organic;
      const storage1 = soil.w[0] + soil.w[1] + soil.w[2];
      const waterResidual = c.rain + c.irr - c.runoff - c.evap - c.transp - c.drain - (storage1 - storage0);
      const nResidual = totalN(o) - totalN0 - (c.fertN + c.fixN - c.leachN - c.removedN);
      const fullYears = S.years.filter((y) => y.days >= 365);
      const avg = (k) => (fullYears.length ? fullYears.reduce((a, y) => a + y[k], 0) / fullYears.length : null);
      const somEnd = somPercent(o);
      const spanYears = Math.max(1, (S.dayNum - startDay + 1) / 365.25);
      return {
        engineVersion: ENGINE_VERSION, fieldId: S.fieldId, startYear, years,
        weatherSources: Object.fromEntries([...new Set(S.years.map((y) => y.year))].map((y) => [y, weather.sourceOf(wyOf(y))])),
        slotSources: sources, placeholderSlots,
        episodes: S.episodes, yearly: S.years,
        totals: {
          rainMm: round(c.rain), irrigationMm: round(c.irr), runoffMm: round(c.runoff), evaporationMm: round(c.evap), transpirationMm: round(c.transp), drainageMm: round(c.drain),
          erosionTonsPerAcre: round(c.erosion, 3), bareDays: c.bareDays, nLeachedLb: round(c.leachN, 2), nFertilizerLb: round(c.fertN, 1), nFixedLb: round(c.fixN, 1), nRemovedLb: round(c.removedN, 1),
          revenueUsd: round(c.revenue, 2), variableCostUsd: round(c.cost, 2), returnAboveVariableUsd: round(c.revenue - c.cost, 2),
        },
        perYear: {
          erosionTonsPerAcre: avg('erosionTonsPerAcre') != null ? round(avg('erosionTonsPerAcre'), 3) : round(c.erosion / spanYears, 3), toleranceT: soil.tFactor,
          bareDays: avg('bareDays') ?? round(c.bareDays / spanYears, 1), returnAboveVariableUsd: round((c.revenue - c.cost) / spanYears, 2),
          nLeachedLb: avg('nLeachedLb') ?? round(c.leachN / spanYears, 2),
        },
        soil: { somStartPct: round(somStart, 4), somEndPct: round(somEnd, 4), somTrendPctPerDecade: round(((somEnd - somStart) / spanYears) * 10, 4), toleranceT: soil.tFactor, hydrologicGroup: soil.hsg, waterAtStartMm: round(storage0) },
        balances: { waterResidualMm: waterResidual, waterMaxDailyResidualMm: c.waterResidualMaxDay, nitrogenResidualLb: nResidual },
        ledger: S.ledger, events: S.events,
      };
    },
  };
  return out;
}

/** Convenience: build, run, return the summary. */
export function runSimulation(cfg) {
  return createSimulation(cfg).run();
}
