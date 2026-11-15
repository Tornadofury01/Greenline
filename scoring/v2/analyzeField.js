// One field in, one contract output out (docs/v2-data-contract.md section 2.1), using the daily engine for everything:
//   screen crops -> generate options -> screen them in the engine -> optimize management -> full 41-season run -> four fit checks
//   -> six scores -> what-if runs for confidence -> best plans -> field risks -> field validation.
// Pure JS (no fs, no clock except the timestamp passed in), so the Node precompute and the browser use the same code.
import {
  V2_ENGINE_VERSION, SIM_START_YEAR, SIM_YEARS, SEARCH_START_YEAR, SEARCH_YEARS, SCREEN_START_YEAR, SCREEN_YEARS, MAX_OPTIONS, CANDIDATE_POOL_MAX, CLIMATE_SCENARIOS,
  WHAT_IF_RUNS, SOIL_LIMIT_FACTOR, NEIGHBOR_RADIUS_MILES, FIXED_COSTS_USD_PER_ACRE, MARKET_RECENT_YEARS,
} from './constants.js';
import { makeContext, runPlan, currentPlan, scenarioWeather } from './context.js';
import { screenCrops, generateSpecs } from './options.js';
import { materialize, DEFAULT_CHOICES, nameOf } from './plans.js';
import { optimizeOption, violation } from './optimizer.js';
import { structureOf, waterCheck, diseaseCheck, marketCheck, seasonCheck, checkLocally } from './fitChecks.js';
import { scoreOption, weightsFor, weightedTotal, gradeOf } from './scores.js';
import { drawWorlds, worldMedians, confidenceOf, quantile } from './whatIf.js';
import { buildFieldRisks } from './risks.js';
import { validateField } from './validate.js';
import { SLOT_NAMES } from '../modelSlots.js';

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const fixMojibake = (s) => String(s ?? '').replace(/Â°/g, '°').replace(/Ã—/g, '×').replace(/â‰¥/g, '≥');

/** Pick the three answers from options under a set of weights. Pure: the app can call it again when the farmer changes priorities. */
export function pickBestPlans(options, current, weights, scoresConfig) {
  const usable = options.filter((o) => o.limits ? o.limits.soilMet && o.limits.riskMet : true);
  const pool = usable.length ? usable : options;
  const relaxed = !usable.length;
  const noOptions = !pool.length;
  const by = (arr, f) => arr.reduce((b, o) => (b === null || f(o) > f(b) ? o : b), null);
  const total = (o) => weightedTotal(o.scores, weights);
  const profit = (o) => o.profit.returnAboveVariable.typical;
  const worst = (o) => o.riskDetail?.worst10Usd ?? o.profit.returnAboveVariable.low;
  const mp = noOptions ? current : by(pool, profit), bb = noOptions ? current : by(pool, total), sf = noOptions ? current : by(pool, worst);
  return {
    limits: { risk: 'worst10-no-worse-than-current', soil: 'erosion-under-T', fitChecks: 'no-fail', soilFactor: SOIL_LIMIT_FACTOR, met: !relaxed && !noOptions, relaxed },
    mostProfitable: { optionId: mp.id, why: { key: 'v2.best.mostProfitable', params: { usd: Math.round(profit(mp)), limitsMet: !relaxed } } },
    bestBalance: { optionId: bb.id, why: { key: 'v2.best.bestBalance', params: { total: total(bb), grade: gradeOf(total(bb), scoresConfig), limitsMet: !relaxed } } },
    safest: { optionId: sf.id, why: { key: 'v2.best.safest', params: { usd: Math.round(worst(sf)), limitsMet: !relaxed } } },
  };
}

/**
 * @param cfg { field, slots, library, economics, scoresConfig, priorities?: string[], regional?, buyers?, constraints?, neighborsFor?, now?: ISO string, log?: fn }
 * @returns the field output object (docs/v2-data-contract.md 2.1) plus `_meta` (timing, counts; not part of the contract).
 */
export function analyzeField(cfg) {
  const t0 = Date.now();
  const timing = {};
  const lap = (k, t) => { timing[k] = Date.now() - t; return Date.now(); };
  let t = Date.now();
  const ctx = makeContext(cfg);
  const { field, lib, slots, scoresConfig } = ctx;
  const selected = cfg.priorities ?? [];
  const weights = weightsFor(selected, scoresConfig);
  const now = cfg.now ?? new Date().toISOString();
  const placeholderSlots = slots.placeholderSlots;
  const startChoices = { tillage: ctx.constraints.currentTillage };
  const poolMax = cfg.poolMax ?? CANDIDATE_POOL_MAX;   // tests use a smaller pool
  const nPrice = ctx.nPrice;

  // ---- current rotation, on both horizons ---------------------------------------------------------------------------------
  const cur = currentPlan(ctx);
  const curSearch = runPlan(ctx, cur.plan, { startYear: SEARCH_START_YEAR, years: SEARCH_YEARS }).m;
  const curScreen = runPlan(ctx, cur.plan, { startYear: SCREEN_START_YEAR, years: SCREEN_YEARS }).m;
  const { m: curFull, sum: curSum } = runPlan(ctx, cur.plan, { keepSummary: true });
  const climate = CLIMATE_SCENARIOS.map((s) => ({ s, weather: scenarioWeather(ctx.weather, s, field.field.lat) }));
  const runClimate = (plan) => climate.map(({ weather }) => runPlan(ctx, plan, { startYear: SEARCH_START_YEAR, years: SEARCH_YEARS, weather }).m);
  const curClimate = runClimate(cur.plan);
  t = lap('current', t);

  // ---- generate and screen ------------------------------------------------------------------------------------------------
  const screen = screenCrops(ctx);
  const specs = generateSpecs(ctx, screen.kept);
  t = lap('generate', t);
  const screened = [];
  for (const spec of specs) {
    const mat = materialize(spec, startChoices, ctx);
    if (mat.problems.length) continue;
    const m = runPlan(ctx, mat.plan, { startYear: SCREEN_START_YEAR, years: SCREEN_YEARS }).m;
    const st = structureOf(mat.plan, lib);
    const scores = scoreOption(m, curScreen, { familyRepeatShare: st.familyRepeatShare, greenBridge: st.greenBridge });
    screened.push({ spec, m, scores, total: weightedTotal(scores, weights) });
  }
  t = lap('screen', t);
  // pool: best by the farmer's weights, plus the best by profit and by soil so that every goal is represented
  const chosen = new Map();
  const take = (arr, n) => { let k = 0; for (const x of arr) { if (k >= n || chosen.size >= poolMax) break; if (!chosen.has(x.spec.id)) { chosen.set(x.spec.id, x); k++; } } };
  const byTotal = [...screened].sort((a, b) => b.total - a.total);
  const perSeq = new Map(), diverse = [];
  for (const x of byTotal) { const k = x.spec.mains.map((q) => q.crop).join('|'); const c = perSeq.get(k) ?? 0; if (c < 2) { perSeq.set(k, c + 1); diverse.push(x); } }
  take(diverse, 24);
  take([...screened].sort((a, b) => b.scores.profit.value - a.scores.profit.value), 6);
  take([...screened].sort((a, b) => b.scores.soil.value - a.scores.soil.value), 6);
  const pool = [...chosen.values()].slice(0, poolMax);

  // ---- optimize, full run, checks ------------------------------------------------------------------------------------------
  const regional = ctx.regional;
  const histCrops = new Set((field.cropHistory ?? []).slice(-MARKET_RECENT_YEARS).map((r) => r.crop));
  const worlds = drawWorlds(field, Object.values(lib).filter((d) => d.kind === 'cash').map((d) => d.id));
  const curWorlds = worldMedians(curFull, { nCreditUsd: 0, hasCover: false }, worlds);
  const opts = [];
  const removed = [];
  const seen = new Set();
  let optRuns = 0;
  for (const cand of pool) {
    const res = optimizeOption(ctx, cand.spec, curSearch, { start: startChoices });
    if (!res) continue;
    optRuns += res.runs;
    const sig = JSON.stringify([res.mat.plan.sequence, res.mat.contractManagement]);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const { m: mf } = runPlan(ctx, res.mat.plan, { keepSummary: false });
    const scen = runClimate(res.mat.plan);
    const st = structureOf(res.mat.plan, lib);
    const fit = {
      water: waterCheck(mf, curFull, field),
      disease: diseaseCheck(st, mf.meanPestLoss, scen.length ? mean(scen.map((x) => x.meanPestLoss)) : mf.meanPestLoss),
      market: marketCheck(st.cash, field, ctx),
      season: seasonCheck(mf, scen),
    };
    const failed = Object.entries(fit).filter(([, v]) => v.status === 'fail').map(([k]) => k);
    if (process.env.V2_DEBUG) console.log('cand', cand.spec.mains.map((q) => q.crop).join('>'), cand.spec.covers.filter(Boolean).join('+'), Object.entries(fit).map(([k, v]) => k[0] + ':' + v.evidence.key.split('.').pop() + JSON.stringify(v.evidence.params)).join(' '));
    if (failed.length) { removed.push({ name: nameOf(cand.spec, res.mat.applied), failed }); continue; }
    opts.push({ cand, res, mf, scen, st, fit });
  }
  t = lap('optimize', t);

  const nCredit = (mat, mf, st) => {
    if (!st.usesLegume) return 0;
    const seq = mat.plan.sequence, n = seq.length;
    let full = 0;
    for (const y of seq) for (const c of y.crops) if (c.role === 'cash') full += lib[c.crop].defaults.nRateLbPerAcre ?? 0;
    return Math.max(0, (full / n) * nPrice - mf.nFertilizerLbPerYear * nPrice);
  };
  const cashPerYear = (plan) => plan.sequence.reduce((a, y) => a + y.crops.filter((c) => c.role === 'cash').length, 0) / plan.sequence.length;
  const newCropsOf = (st) => st.cash.filter((c) => !histCrops.has(c));

  // ---- build the contract options ------------------------------------------------------------------------------------------
  const build = (o, id, kind) => {
    const { plan, mf, scen, st, fit, mgmt, spec } = o;
    const credit = nCredit({ plan }, mf, st);
    const scores = scoreOption(mf, curFull, { familyRepeatShare: st.familyRepeatShare, greenBridge: st.greenBridge, nCreditUsd: credit });
    const total = weightedTotal(scores, weights);
    const vals = worldMedians(mf, { nCreditUsd: credit, hasCover: st.hasCover }, worlds);
    const q = (p) => quantile(Array.from(vals), p);
    let beats = 0;
    if (kind === 'generated') for (let i = 0; i < vals.length; i++) if (vals[i] > curWorlds[i]) beats++;
    const beatsShare = kind === 'generated' ? beats / vals.length : 0.5;
    const agree = kind === 'generated' ? scen.filter((x, i) => x.medianReturn > curClimate[i].medianReturn).length : CLIMATE_SCENARIOS.length;
    const warnCount = Object.values(fit).filter((f) => f.status === 'warn').length;
    const conf = confidenceOf({ beatsShare, climateAgree: agree, climateOf: CLIMATE_SCENARIOS.length, warnCount, placeholderSlots, isCurrent: kind === 'current', currentKnownYears: cur.knownYears });
    const cp = cashPerYear(plan);
    const fixed = FIXED_COSTS_USD_PER_ACRE.rent + FIXED_COSTS_USD_PER_ACRE.ownership;
    const v = violation(mf, curFull);
    const range = (shift) => ({ low: r1(q(0.1) - shift), typical: r1(q(0.5) - shift), high: r1(q(0.9) - shift), unit: 'usd/acre/year' });
    const nbr = cfg.neighborsFor ? cfg.neighborsFor(st.cash) : null;
    return {
      id, kind, name: kind === 'current' ? { key: 'v2.option.current', params: { crops: st.cash } } : nameOf(spec, o.applied),
      sequence: plan.sequence,
      management: { ...mgmt, nitrogenLbPerAcre: cp ? Math.round(mf.nFertilizerLbPerYear / cp) : 0 },
      scores, weightedTotal: total, grade: gradeOf(total, scoresConfig),
      fitChecks: fit,
      profit: {
        returnAboveVariable: range(0), netAfterFixed: range(fixed),
        chanceBeatsCurrent: kind === 'generated' ? r2(beatsShare) : null,
        nitrogenCreditUsd: r1(credit), costShareUsdShown: 0,
        medianAtBaseAssumptionsUsd: r1(mf.medianReturn), fixedCostsUsd: fixed, fixedCostsVerified: false,
      },
      riskDetail: { worst10Usd: r1(mf.p10Return), currentWorst10Usd: r1(curFull.p10Return) },
      limits: { soilMet: v.soilMet, riskMet: v.riskMet },
      soilSaved: {
        erosionTonsPerAcreYear: r2(mf.erosionTonsPerAcreYear), toleranceT: mf.toleranceT, bareDaysPerYear: Math.round(mf.bareDaysPerYear), somTrendPctPerDecade: r2(mf.somTrendPctPerDecade),
        savedVsCurrentTonsPerAcreYear: kind === 'current' ? null : r2(curFull.erosionTonsPerAcreYear - mf.erosionTonsPerAcreYear),
      },
      nitrogenSaved: {
        balanceLbPerAcreYear: Math.round(mf.nBalanceLbPerYear), fertilizerBoughtLbPerAcreYear: Math.round(mf.nFertilizerLbPerYear),
        savedVsCurrentLb: kind === 'current' ? null : Math.round(curFull.nFertilizerLbPerYear - mf.nFertilizerLbPerYear),
        savedVsCurrentUsd: kind === 'current' ? null : Math.round((curFull.nFertilizerLbPerYear - mf.nFertilizerLbPerYear) * nPrice),
      },
      confidence: { level: conf.level, whatIfRuns: WHAT_IF_RUNS, beatsCurrentShare: r2(beatsShare), climateModels: { agree, of: CLIMATE_SCENARIOS.length, kind: 'warming-offsets' }, reasons: conf.reasons },
      checkLocally: checkLocally(st, mgmt, ctx, newCropsOf(st)),
      placeholderSlots,
      neighbors: nbr && nbr.count > 0 ? { count: nbr.count, radiusMiles: NEIGHBOR_RADIUS_MILES } : null,
      _rank: total,
    };
  };

  const built = opts.map((x) => build({ plan: x.res.mat.plan, mf: x.mf, scen: x.scen, st: x.st, fit: x.fit, mgmt: x.res.mat.contractManagement, spec: x.cand.spec, applied: x.res.mat.applied }, 'tmp', 'generated'));
  built.sort((a, b) => b._rank - a._rank);
  const options = built.slice(0, MAX_OPTIONS);
  options.forEach((o, i) => { o.id = `opt-${String(i + 1).padStart(2, '0')}`; delete o._rank; });

  // the current rotation, as an option (same checks)
  const stCur = structureOf(cur.plan, lib);
  const curFit = {
    water: waterCheck(curFull, curFull, field),
    disease: diseaseCheck(stCur, curFull.meanPestLoss, mean(curClimate.map((x) => x.meanPestLoss))),
    market: marketCheck(stCur.cash, field, ctx),
    season: seasonCheck(curFull, curClimate),
  };
  const curMgmt = { plantingDate: 'normal', nitrogenLbPerAcre: 0, maturity: 'full', coverTermination: 'none', doubleCrop: false, tillage: ctx.constraints.currentTillage, irrigation: 'none' };
  const currentOpt = build({ plan: cur.plan, mf: curFull, scen: curClimate, st: stCur, fit: curFit, mgmt: curMgmt, spec: null }, 'current', 'current');
  delete currentOpt._rank;
  currentOpt.basisYears = cur.basisYears;
  currentOpt.knownCropYears = cur.knownYears;
  t = lap('final', t);

  // ---- best plans (default priorities) and per priority ---------------------------------------------------------------------
  const bestPlans = pickBestPlans(options, currentOpt, weights, scoresConfig);
  const bestBalanceByPriority = {};
  for (const p of Object.keys(scoresConfig.priorities ?? {}).filter((k) => !k.startsWith('_'))) bestBalanceByPriority[p] = pickBestPlans(options, currentOpt, weightsFor([p], scoresConfig), scoresConfig).bestBalance.optionId;

  // ---- field risks and validation --------------------------------------------------------------------------------------------
  const erosionByMonth = Array(12).fill(0);
  const sy = curSum.yearly.filter((y) => y.days >= 365).length || 1;
  runPlan(ctx, cur.plan, { startYear: SEARCH_START_YEAR, years: SEARCH_YEARS, onDay: (r) => { erosionByMonth[Number(r.date.slice(5, 7)) - 1] += r.erosionTonsPerAcre / SEARCH_YEARS; } });
  const fieldRisks = buildFieldRisks(ctx, { erosionByMonth, erosionPerYear: curFull.erosionTonsPerAcreYear, todayISO: now });
  const val = validateField(ctx);
  t = lap('risks', t);

  const sources = [
    ...(field.sources ?? []).map((s) => ({ id: s.id, name: fixMojibake(s.dataset ?? s.name), resolution: fixMojibake(s.resolution), scale: s.scale === 'field' || s.scale === 'patch' ? 'field' : 'regional' })),
    { id: 'simulator', name: 'Field Shift v2 daily simulator (published agronomy, not a trained model)', resolution: 'daily, this field', scale: 'field' },
    { id: 'crop-library', name: 'Crop library (FAO-56, FAO-33, ECOCROP, extension guides; not verified)', resolution: 'per crop', scale: 'regional' },
    ...(placeholderSlots.length ? [{ id: 'placeholder', name: 'Fixed placeholder values (content/model-placeholders.json)', resolution: 'none', scale: 'placeholder' }] : []),
  ];

  const out = {
    schemaVersion: 1, isSampleData: false,
    generatedAt: now, engineVersion: V2_ENGINE_VERSION,
    field: field.field,
    slots: { sources: slots.sources, placeholderSlots, modelVersions: slots.modelVersions ?? {} },
    priorities: { selected, weights },
    simulation: { startYear: SIM_START_YEAR, years: SIM_YEARS, weather: 'monthly totals 2008-2025, field average before; days are generated inside real month totals', currentTillageAssumed: ctx.constraints.currentTillage, climateScenarios: CLIMATE_SCENARIOS, whatIfRuns: WHAT_IF_RUNS },
    cropScreen: { kept: screen.kept, dropped: screen.dropped, flaggedBy2040: screen.flaggedBy2040 },
    current: currentOpt,
    options,
    removedOptions: removed.slice(0, 12),
    bestPlans, bestBalanceByPriority,
    fieldRisks,
    validation: { reportFile: 'shared/v2/validation.json', bareDays: val.bareDays, cropDates: val.cropDates },
    sources,
  };
  const bareAlt = {};
  if (cfg.validationExtra) for (const tl of ['conventional', 'reduced', 'no-till']) if (tl !== ctx.constraints.currentTillage) bareAlt[tl] = validateField(ctx, { tillage: tl }).bareDays;
  const meta = { ms: Date.now() - t0, timing, specs: specs.length, screened: screened.length, pool: pool.length, optimizerRuns: optRuns, kept: options.length, removed: removed.length, validationRaw: { yields: val.yields, dateErrors: val.dateErrors, bare: { default: val.bareDays, ...bareAlt } } };
  return { out, meta };
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
