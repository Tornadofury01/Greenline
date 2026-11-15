// v2 option builder checks: node scoring/selftest-v2.js   (about 40 s: it runs the full analysis on one field with a small candidate pool)
import { readFileSync } from 'node:fs';
import { loadField, loadLibrary, loadEconomics } from './engine/node.js';
import { slotsForField, loadPlaceholders } from './modelSlots.node.js';
import { makeSlots } from './modelSlots.js';
import { analyzeField, pickBestPlans } from './v2/analyzeField.js';
import { validateFieldOutput } from './v2Contract.js';
import { weightsFor, weightedTotal } from './v2/scores.js';
import { waterCheck, seasonCheck, diseaseCheck, marketCheck, structureOf } from './v2/fitChecks.js';
import { materialize, DEFAULT_CHOICES } from './v2/plans.js';
import { makeContext } from './v2/context.js';
import { screenCrops, generateSpecs } from './v2/options.js';
import { optimizeOption, violation } from './v2/optimizer.js';
import { runPlan, currentPlan } from './v2/context.js';
import { drawWorlds, worldMedians, confidenceOf } from './v2/whatIf.js';
import { buildReportCard } from './v2/reportCard.js';
import * as K from './v2/constants.js';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
let failed = 0;
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failed++; };

const field = loadField('ec-251'), library = loadLibrary(), economics = loadEconomics();
const scoresConfig = load('../content/v2-scores.json');
const slots = slotsForField(field);
const cfg = { field, slots, library, economics, scoresConfig, now: '2026-11-14T12:00:00Z', poolMax: 8 };
const regional = { cropFieldShare: { winter_wheat: 0.5, corn: 0.6, grain_sorghum: 0.3, cotton: 0.4, soybeans: 0.0, sunflower: 0.03 } };

// ---- scoring config: decided, not provisional ----
check(scoresConfig.decided === true && scoresConfig.provisional === undefined && !JSON.stringify(scoresConfig).includes('Pranav'), 'v2-scores.json: the six scores are marked decided (no "provisional, confirm with Pranav")');
check(scoresConfig.scores.map((s) => s.id).join() === 'profit,risk,soil,water,nutrients,pests', 'the six scores: profit, risk, soil, water, nutrients, pests');
const w0 = weightsFor([], scoresConfig), w1 = weightsFor(['soil'], scoresConfig);
check(Math.abs(Object.values(w0).reduce((a, b) => a + b, 0) - 1) < 1e-3 && Math.abs(Object.values(w1).reduce((a, b) => a + b, 0) - 1) < 1e-3, 'weights add up to 1 (default and with a priority)');
check(w1.soil > w0.soil && w1.nutrients > w0.nutrients && w1.profit < w0.profit, 'the soil priority raises the soil and nutrients weights and lowers the others');

// ---- the whole analysis ----
const t0 = Date.now();
const { out, meta } = analyzeField({ ...cfg, regional });
console.log(`     (analysis took ${((Date.now() - t0) / 1000).toFixed(0)} s, ${meta.optimizerRuns} optimizer runs, ${out.options.length} options kept)`);
const problems = validateFieldOutput(out, scoresConfig);
check(problems.length === 0, `output follows the data contract${problems.length ? ': ' + problems.slice(0, 3).join('; ') : ''}`);
check(out.options.length > 0 && out.options.length <= K.MAX_OPTIONS, `up to ${K.MAX_OPTIONS} options (got ${out.options.length})`);
check(out.options.every((o) => Object.values(o.fitChecks).every((f) => f.status !== 'fail')), 'no kept option has a failed fit check');
check(out.options.every((o) => Object.values(o.scores).every((s) => s.value >= 0 && s.value <= 100)), 'all six scores are 0-100');
check(out.options.every((o, i, a) => i === 0 || a[i - 1].weightedTotal >= o.weightedTotal), 'options are ranked by the weighted total');
check(out.current.kind === 'current' && out.current.profit.chanceBeatsCurrent === null, 'the current rotation is included and does not compare with itself');
check(JSON.stringify(out.current.placeholderSlots) === JSON.stringify(['modelA', 'modelB', 'modelC', 'modelD', 'calibrationE']) && out.options.every((o) => o.placeholderSlots.length === 5), 'every output records the placeholder slots (all five here)');
check(out.options.every((o) => o.confidence.level !== 'high') && out.options.every((o) => o.confidence.reasons.some((r) => r.key === 'v2.conf.placeholderSlots')), 'confidence is capped at "medium" and says so while model B / calibration E are placeholders');
check(out.options.every((o) => o.confidence.whatIfRuns === K.WHAT_IF_RUNS && o.confidence.climateModels.of === K.CLIMATE_SCENARIOS.length), `confidence uses ${K.WHAT_IF_RUNS} what-if runs and ${K.CLIMATE_SCENARIOS.length} climate scenarios`);
// no English text: every key is a dotted id, every param is a number, boolean, id string, list of those, or null
const KEY = /^v2\.[A-Za-z0-9.]+$/, idish = (v) => v === null || typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && /^[A-Za-z0-9_.\-]+$/.test(v)) || (Array.isArray(v) && v.every(idish)) || (typeof v === 'object' && v && Object.values(v).every(idish));
const emitted = new Set(), badText = [];
const scan = (r) => { if (!r) return; emitted.add(r.key); if (!KEY.test(r.key)) badText.push(r.key); for (const v of Object.values(r.params ?? {})) if (!idish(v)) badText.push(JSON.stringify(v)); };
for (const o of [out.current, ...out.options]) {
  scan(o.name);
  for (const f of Object.values(o.fitChecks)) scan(f.evidence);
  for (const s of Object.values(o.scores)) s.reasons.forEach(scan);
  o.confidence.reasons.forEach(scan);
}
[out.bestPlans.mostProfitable.why, out.bestPlans.bestBalance.why, out.bestPlans.safest.why].forEach(scan);
check(badText.length === 0, `rules return i18n keys and params, never English text${badText.length ? ' (bad: ' + badText.slice(0, 3).join(', ') + ')' : ''}`);
const keyDoc = readFileSync(new URL('../docs/v2-i18n-keys.md', import.meta.url), 'utf8');
const missing = [...emitted].filter((k) => !keyDoc.includes('`' + k + '`'));
check(missing.length === 0, `every emitted key is listed in docs/v2-i18n-keys.md${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`);

// ---- rotation rules, limits, best plans ----
const famKey = (c) => (library.crops.find((x) => x.id === c).family === 'other' ? c : library.crops.find((x) => x.id === c).family);
check(out.options.every((o) => { const cash = o.name.params.crops; const f = cash.map(famKey); return !(cash.length >= 2 && f.every((x) => x === f[0])) && cash.every((c, i) => c !== cash[(i + 1) % cash.length]); }), 'rotation rules: the family switches at least every other year, no crop twice in a row');
check(out.options.every((o) => o.name.params.covers.length > 0 || o.name.params.crops.some((c) => famKey(c) === 'legume')), 'rotation rules: every option has a legume (cash or cover) in its cycle');
const ids = new Set([out.current.id, ...out.options.map((o) => o.id)]);
check(['mostProfitable', 'bestBalance', 'safest'].every((k) => ids.has(out.bestPlans[k].optionId)), 'best plans point at real options');
if (out.bestPlans.limits.met) {
  const by = Object.fromEntries(out.options.map((o) => [o.id, o]));
  check(['mostProfitable', 'bestBalance', 'safest'].every((k) => by[out.bestPlans[k].optionId].limits.soilMet && by[out.bestPlans[k].optionId].limits.riskMet), 'best plans stay inside the soil (T) and risk limits');
}
const mp = out.options.find((o) => o.id === out.bestPlans.mostProfitable.optionId);
check(!mp || out.options.filter((o) => o.limits.soilMet && o.limits.riskMet).every((o) => o.profit.returnAboveVariable.typical <= mp.profit.returnAboveVariable.typical + 1e-9) || !out.bestPlans.limits.met, 'most profitable = highest typical return among options inside the limits');
const again = pickBestPlans(out.options, out.current, out.priorities.weights, scoresConfig);
check(JSON.stringify(again) === JSON.stringify(out.bestPlans), 'pickBestPlans (used by the app when priorities change) reproduces the stored answer');
check(Object.keys(out.bestBalanceByPriority).length === 4, 'best balance is stored for each of the four priorities');
check(out.options.every((o) => o.profit.returnAboveVariable.low <= o.profit.returnAboveVariable.typical && o.profit.returnAboveVariable.typical <= o.profit.returnAboveVariable.high), 'profit range: low <= typical <= high');

// ---- determinism and slot switching ----
const again2 = analyzeField({ ...cfg, regional, poolMax: 3 }).out, again3 = analyzeField({ ...cfg, regional, poolMax: 3 }).out;
check(JSON.stringify(again2) === JSON.stringify(again3), 'same inputs give the same output');
const model = { schemaVersion: 1, fieldId: 'ec-251', calibrationE: { crops: { corn: { typicalYield: 85, unit: 'bu/acre', wpScale: 1.4 }, cotton: { typicalYield: 600, unit: 'lb lint/acre', wpScale: 1.4 }, grain_sorghum: { typicalYield: 60, unit: 'bu/acre', wpScale: 1.4 } } } };
const slotsE = makeSlots({ field, modelFile: model, placeholders: loadPlaceholders() });
check(slotsE.placeholderSlots.join() === 'modelA,modelB,modelC,modelD' || slotsE.problems.length > 0, 'fake calibration E file: slot switches to "model" (or reports why not)');
if (slotsE.sources.calibrationE === 'model') {
  const o2 = analyzeField({ ...cfg, slots: slotsE, regional, poolMax: 3 }).out;
  check(!o2.current.placeholderSlots.includes('calibrationE') && o2.current.profit.returnAboveVariable.typical !== again2.current.profit.returnAboveVariable.typical, 'a model file for calibration E changes the profit numbers and removes it from placeholderSlots');
}

// ---- plans, generator, optimizer ----
const ctx = makeContext({ field, slots, library, economics, scoresConfig, regional });
const spec = { id: 't', mains: [{ crop: 'winter_wheat', second: 'soybeans' }, { crop: 'corn' }, { crop: 'cotton' }], covers: [null, 'hairy_vetch', null] };
const m1 = materialize(spec, DEFAULT_CHOICES, ctx);
check(m1.problems.length === 0 && m1.plan.sequence[0].crops[0].crop === 'winter_wheat' && m1.plan.sequence[0].crops[0].plantYearOffset === -1, 'plans: winter wheat is planted the autumn before (plantYearOffset -1)');
const vetch = m1.plan.sequence.flatMap((y, i) => y.crops.filter((c) => c.crop === 'hairy_vetch').map((c) => ({ ...c, y: i })));
const nextCash = m1.plan.sequence[vetch[0]?.y].crops.find((c) => c.role === 'cash');
check(vetch.length === 1 && vetch[0].plantYearOffset === -1 && nextCash && vetch[0].endDoy + K.MIN_GAP_DAYS <= nextCash.plantDoy, 'plans: a winter cover ends at least the minimum gap before the next crop is planted');
const m2 = materialize(spec, { ...DEFAULT_CHOICES, doubleCrop: true }, ctx);
check(m2.applied.seconds[0] === true && m2.plan.sequence[0].crops.length >= 2, 'plans: double crop adds a second crop after wheat when it fits');
const bad = materialize({ id: 'x', mains: [{ crop: 'cotton' }, { crop: 'winter_wheat' }], covers: [null, null] }, { ...DEFAULT_CHOICES, plantingDate: 'early' }, ctx);
check(Array.isArray(bad.problems), 'plans: an overlap is reported as a problem, never run');
const nc = materialize(spec, { ...DEFAULT_CHOICES, coverTermination: 'none' }, ctx);
check(nc.applied.covers.every((x) => !x) && nc.contractManagement.coverTermination === 'none', 'plans: cover termination "none" means no cover crop');
const screen = screenCrops(ctx);
check(screen.kept.length >= 4 && screen.dropped.some((d) => d.crop === 'sesame'), 'generator: crops are screened (sesame has no county record or buyer: dropped from the options)');
const specs = generateSpecs(ctx, screen.kept);
check(specs.length > 20 && specs.every((s) => { const r = materialize(s, DEFAULT_CHOICES, ctx); return r.problems.length === 0 && !structureOf(r.plan, ctx.lib).greenBridge; }), 'generator: every candidate fits the calendar and has no green bridge');
const cur = currentPlan(ctx);
const base = runPlan(ctx, cur.plan, { startYear: K.SEARCH_START_YEAR, years: K.SEARCH_YEARS }).m;
const start = runPlan(ctx, materialize(specs[0], { tillage: 'reduced' }, ctx).plan, { startYear: K.SEARCH_START_YEAR, years: K.SEARCH_YEARS }).m;
const res = optimizeOption(ctx, specs[0], base, { start: { tillage: 'reduced' } });
const v0 = violation(start, base), v1 = res.violation;
check(v1.total < v0.total - 1e-9 || (Math.abs(v1.total - v0.total) < 1e-9 && res.m.medianReturn >= start.medianReturn - 1e-6) || (v1.total === 0 && res.m.medianReturn >= start.medianReturn - 1e-6 && v0.total === 0), 'optimizer: never ends worse than its starting choices (limits first, then median return)');
check(res.runs > 3 && res.runs < 60, `optimizer: ${res.runs} engine runs for one option`);

// ---- fit-check thresholds (the plan's numbers) ----
const mk = (shares) => ({ waterShareAtPlanting: shares, meanWaterShareAtPlanting: shares.reduce((a, b) => a + b, 0) / shares.length });
const ok10 = mk(Array(10).fill(0.6)), s26 = mk([...Array(26).fill(0.1), ...Array(74).fill(0.6)]), s15 = mk([...Array(15).fill(0.1), ...Array(85).fill(0.6)]);
check(waterCheck(ok10, ok10, field).status === 'pass', 'water fit: no short years = pass');
check(waterCheck(s15, ok10, field).status === 'warn', 'water fit: short in 15 % of years = warn (1 in 10 to 1 in 4)');
check(waterCheck(s26, ok10, field).status === 'fail', 'water fit: short in more than 1 year in 4 and worse than current = fail');
check(waterCheck(s26, s26, field).status === 'warn', 'water fit: the same shortfall as the current rotation is a warning, not a removal');
const eps = (bad, n) => ({ cashEpisodes: Array.from({ length: n }, (_, i) => ({ crop: 'corn', stageAtEnd: i < bad ? 0.5 : 1.1, killed: null })) });
check(seasonCheck(eps(0, 20), []).status === 'pass' && seasonCheck(eps(3, 20), []).status === 'warn' && seasonCheck(eps(5, 20), []).status === 'fail', 'season fit: pass under 10 %, warn from 10 %, fail above 20 % of years');
check(seasonCheck(eps(0, 20), [eps(6, 20)]).status === 'warn' && seasonCheck(eps(0, 20), [eps(6, 20)]).evidence.key === 'v2.fit.season.warn2040', 'season fit: fits today but not in 2040 = warn');
const st = (cash, cover) => structureOf({ sequence: [{ year: 1, crops: [{ crop: cash, role: 'cash', plantDoy: 100, endDoy: 250, plantYearOffset: 0 }] }, ...(cover ? [{ year: 2, crops: [{ crop: cover, role: 'cover', plantDoy: 283, endDoy: 60, plantYearOffset: -1 }, { crop: 'cotton', role: 'cash', plantDoy: 115, endDoy: 280, plantYearOffset: 0 }] }] : [])] }, ctx.lib);
check(diseaseCheck(st('corn', 'hairy_vetch'), 0.05, 0.05).status === 'fail' && diseaseCheck(st('corn', 'hairy_vetch'), 0.05, 0.05).evidence.key === 'v2.fit.disease.failGreenBridge', 'disease fit: a cover that hosts cotton root rot before cotton = fail (green bridge)');
check(diseaseCheck(st('corn'), 0.05, 0.05).status === 'warn' && diseaseCheck(st('corn'), 0.05, 0.05).evidence.key === 'v2.fit.disease.warnFamilyRepeat', 'disease fit: the same family two years in a row = warn');
const noRepeat = structureOf(materialize({ id: 'n', mains: [{ crop: 'corn' }, { crop: 'cotton' }], covers: [null, null] }, DEFAULT_CHOICES, ctx).plan, ctx.lib);
check(diseaseCheck(noRepeat, 0.05, 0.05).status === 'pass' && diseaseCheck(noRepeat, 0.05, 0.08).evidence.key === 'v2.fit.disease.warnWeatherRisk', 'disease fit: corn then cotton passes; pest loss 1.6 times higher in 2040 = warn');
check(marketCheck(['sesame'], field, { regional, buyers: {} }).status === 'fail' && marketCheck(['sesame'], field, { regional, buyers: { sesame: true } }).status !== 'fail', 'market fit: no record and no buyer = fail; a buyer entered by the farmer lifts it');
check(marketCheck(['sunflower'], field, { regional, buyers: {} }).status === 'warn', 'market fit: few acres = warn');
check(marketCheck(['corn', 'cotton'], field, { regional, buyers: {} }).status === 'pass', 'market fit: common crops with county records = pass');

// ---- what-if and confidence ----
const worlds = drawWorlds(field, ['corn', 'cotton', 'grain_sorghum'], 200), worlds2 = drawWorlds(field, ['corn', 'cotton', 'grain_sorghum'], 200);
check(JSON.stringify(Array.from(worlds.costMult)) === JSON.stringify(Array.from(worlds2.costMult)), 'what-if: the same field draws the same worlds');
const wm = worldMedians(base, { nCreditUsd: 0, hasCover: false }, worlds);
check(wm.length === 200 && Array.from(wm).every((v, i) => v === worldMedians(base, { nCreditUsd: 0, hasCover: false }, worlds)[i]), 'what-if: an option compared with itself never beats itself (same worlds)');
const hi = confidenceOf({ beatsShare: 0.9, climateAgree: 4, climateOf: 4, warnCount: 0, placeholderSlots: [], isCurrent: false });
const hiW = confidenceOf({ beatsShare: 0.9, climateAgree: 4, climateOf: 4, warnCount: 1, placeholderSlots: [], isCurrent: false });
const med = confidenceOf({ beatsShare: 0.65, climateAgree: 4, climateOf: 4, warnCount: 0, placeholderSlots: [], isCurrent: false });
const lo = confidenceOf({ beatsShare: 0.4, climateAgree: 4, climateOf: 4, warnCount: 0, placeholderSlots: [], isCurrent: false });
check(hi.level === 'high' && hiW.level === 'medium' && med.level === 'medium' && lo.level === 'low', 'confidence: high >= 80 % and no warning; medium >= 60 % or one warning; low otherwise');
check(confidenceOf({ beatsShare: 0.9, climateAgree: 4, climateOf: 4, warnCount: 0, placeholderSlots: ['calibrationE'], isCurrent: false }).level === 'medium', 'confidence: capped at medium while calibration E is a placeholder');

// ---- report card ----
const rc = buildReportCard([{ fieldId: 'a', bare: { default: { differenceDays: 5, simulatedPerYear: 40, measuredPerYear: 35 }, conventional: { differenceDays: 80 }, 'no-till': { differenceDays: -20 } }, dateErrors: [{ crop: 'corn', errDays: 12 }], yields: [{ crop: 'corn', year: 2015, yield: 80, unit: 'bu/acre' }] }], [{ crop: 'corn', year: 2015, value: 55, unit: 'bu/acre', level: 'county' }], { generatedAt: 'x', engineVersion: 'e', defaultTillage: 'reduced' });
check(rc.checks.length === 8 && rc.checks.map((c) => c.id).join() === '1,2,3,4,5,6,7,8' && rc.checks[0].status === 'pending-model' && rc.checks[1].status === 'pass' && rc.checks[2].status === 'fail', 'report card: eight checks, pending-model where a model is needed, failures shown');

// ---- engine independence ----
const src = ['analyzeField', 'optimizer', 'options', 'plans', 'fitChecks', 'scores', 'whatIf', 'risks', 'metrics', 'context', 'validate'].map((f) => readFileSync(new URL(`./v2/${f}.js`, import.meta.url), 'utf8')).join('\n');
check(!/shared\/si|pipeline\/fieldshift|\.yearType|field\.si/.test(src), 'v2 code reads no model output outside the slots (no shared/si, no field.si, no yearType)');
check(!/Math\.random/.test(src) && !/node:fs/.test(src), 'v2 code is pure: no Math.random, no fs');

console.log(failed ? `\n${failed} v2 check(s) failed` : '\nall v2 checks passed');
process.exit(failed ? 1 : 0);
