// Checks a v2 field output file (shared/v2/fields/<id>.json, shared/v2-sample/sample-field.json)
// against docs/v2-data-contract.md section 2. Returns a list of problems (empty = follows the contract).
// Pure JS. Used by scoring/selftest-v2contract.js and by the precompute script (step B3).

export const OUTPUT_SCHEMA_VERSION = 1;
export const SCORE_IDS = ['profit', 'risk', 'soil', 'water', 'nutrients', 'pests']; // decided (Nov 14 2026): content/v2-scores.json is the master
export const FIT_CHECK_IDS = ['water', 'disease', 'market', 'season'];
export const FIT_STATUSES = ['pass', 'warn', 'fail'];
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];
export const CHECK_LOCALLY_IDS = ['legumeNitrogenCredit', 'coverEstablishment', 'seedPriceAvailability', 'buyersLocalPrice', 'equipment', 'localPests', 'waterRights', 'fieldQuirks', 'costShareEligibility'];
export const SLOT_KEYS = ['modelA', 'modelB', 'modelC', 'modelD', 'calibrationE'];
export const TONES = ['up', 'down', 'note'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, a, b) => isNum(v) && v >= a && v <= b;

function reasons(p, where, arr, { needTone = false } = {}) {
  if (!Array.isArray(arr)) return p.push(`${where} must be an array of {key, params}`);
  arr.forEach((r, i) => {
    if (!isObj(r) || typeof r.key !== 'string' || !isObj(r.params ?? {})) p.push(`${where}[${i}] needs a string key and a params object`);
    else if (needTone && !TONES.includes(r.tone)) p.push(`${where}[${i}].tone must be one of ${TONES.join('/')}`);
  });
}

function range(p, where, r) {
  if (!isObj(r) || !isNum(r.low) || !isNum(r.typical) || !isNum(r.high) || !(r.low <= r.typical && r.typical <= r.high)) p.push(`${where} needs numbers low <= typical <= high`);
}

function option(p, where, o, scoreIds) {
  if (!isObj(o)) return p.push(`${where} must be an object`);
  if (typeof o.id !== 'string') p.push(`${where}.id must be a string`);
  if (!['current', 'generated'].includes(o.kind)) p.push(`${where}.kind must be current or generated`);
  if (!isObj(o.name) || typeof o.name.key !== 'string') p.push(`${where}.name needs {key, params}`);
  if (!Array.isArray(o.sequence) || !o.sequence.length) p.push(`${where}.sequence must be a non-empty array`);
  else o.sequence.forEach((y, i) => {
    if (!isObj(y) || !Array.isArray(y.crops) || !y.crops.length) return p.push(`${where}.sequence[${i}] needs crops[]`);
    y.crops.forEach((c, j) => { if (typeof c.crop !== 'string' || !['cash', 'cover', 'fallow'].includes(c.role)) p.push(`${where}.sequence[${i}].crops[${j}] needs crop and role cash/cover/fallow`); });
  });
  const m = o.management;
  if (!isObj(m) || !['early', 'normal', 'late'].includes(m.plantingDate) || !isNum(m.nitrogenLbPerAcre) || !['short', 'full'].includes(m.maturity)
    || !['early', 'at-planting', 'none'].includes(m.coverTermination) || typeof m.doubleCrop !== 'boolean'
    || !['conventional', 'reduced', 'no-till'].includes(m.tillage) || !['none', 'limited', 'full'].includes(m.irrigation)) p.push(`${where}.management is missing or has a value outside the allowed list`);
  if (!isObj(o.scores)) p.push(`${where}.scores must be an object`);
  else for (const id of scoreIds) {
    const s = o.scores[id];
    if (!isObj(s) || !inRange(s.value, 0, 100)) p.push(`${where}.scores.${id}.value must be 0-100`);
    else reasons(p, `${where}.scores.${id}.reasons`, s.reasons, { needTone: true });
  }
  if (!inRange(o.weightedTotal, 0, 100)) p.push(`${where}.weightedTotal must be 0-100`);
  if (!['A', 'B', 'C', 'D', 'F'].includes(o.grade)) p.push(`${where}.grade must be A, B, C, D or F`);
  if (!isObj(o.fitChecks)) p.push(`${where}.fitChecks must be an object`);
  else for (const id of FIT_CHECK_IDS) {
    const f = o.fitChecks[id];
    if (!isObj(f) || !FIT_STATUSES.includes(f.status) || !isObj(f.evidence) || typeof f.evidence.key !== 'string') p.push(`${where}.fitChecks.${id} needs status pass/warn/fail and evidence {key, params}`);
  }
  const pr = o.profit;
  if (!isObj(pr)) p.push(`${where}.profit must be an object`);
  else {
    range(p, `${where}.profit.returnAboveVariable`, pr.returnAboveVariable);
    range(p, `${where}.profit.netAfterFixed`, pr.netAfterFixed);
    if (o.kind === 'current' ? pr.chanceBeatsCurrent !== null : !inRange(pr.chanceBeatsCurrent, 0, 1)) p.push(`${where}.profit.chanceBeatsCurrent must be 0-1 (null for the current rotation)`);
    if (!isNum(pr.nitrogenCreditUsd) || !isNum(pr.costShareUsdShown)) p.push(`${where}.profit needs nitrogenCreditUsd and costShareUsdShown (shown, never scored)`);
  }
  const s = o.soilSaved;
  if (!isObj(s) || !isNum(s.erosionTonsPerAcreYear) || !isNum(s.toleranceT) || !isNum(s.bareDaysPerYear) || !isNum(s.somTrendPctPerDecade)) p.push(`${where}.soilSaved needs erosionTonsPerAcreYear, toleranceT, bareDaysPerYear, somTrendPctPerDecade`);
  else if (o.kind === 'current' ? s.savedVsCurrentTonsPerAcreYear !== null : !isNum(s.savedVsCurrentTonsPerAcreYear)) p.push(`${where}.soilSaved.savedVsCurrentTonsPerAcreYear must be a number (null for the current rotation)`);
  const n = o.nitrogenSaved;
  if (!isObj(n) || !isNum(n.balanceLbPerAcreYear) || !isNum(n.fertilizerBoughtLbPerAcreYear)) p.push(`${where}.nitrogenSaved needs balanceLbPerAcreYear and fertilizerBoughtLbPerAcreYear`);
  else if (o.kind === 'current' ? n.savedVsCurrentLb !== null || n.savedVsCurrentUsd !== null : !isNum(n.savedVsCurrentLb) || !isNum(n.savedVsCurrentUsd)) p.push(`${where}.nitrogenSaved.savedVsCurrentLb / savedVsCurrentUsd must be numbers (null for the current rotation)`);
  const c = o.confidence;
  if (!isObj(c) || !CONFIDENCE_LEVELS.includes(c.level) || !isNum(c.whatIfRuns) || !inRange(c.beatsCurrentShare, 0, 1) || !isObj(c.climateModels)) p.push(`${where}.confidence needs level, whatIfRuns, beatsCurrentShare 0-1, climateModels {agree, of}`);
  else reasons(p, `${where}.confidence.reasons`, c.reasons);
  if (!Array.isArray(o.checkLocally) || o.checkLocally.some((x) => !CHECK_LOCALLY_IDS.includes(x))) p.push(`${where}.checkLocally must be a list of ids from: ${CHECK_LOCALLY_IDS.join(', ')}`);
  if (!Array.isArray(o.placeholderSlots) || o.placeholderSlots.some((x) => !SLOT_KEYS.includes(x))) p.push(`${where}.placeholderSlots must list slot names that were placeholders for this option`);
  if (o.neighbors !== null && !(isObj(o.neighbors) && Number.isInteger(o.neighbors.count) && isNum(o.neighbors.radiusMiles))) p.push(`${where}.neighbors must be null or {count, radiusMiles}`);
}

/** @param {object} out the field output file; @param {object} scoresConfig content/v2-scores.json */
export function validateFieldOutput(out, scoresConfig) {
  const p = [];
  const scoreIds = scoresConfig?.scores?.map((s) => s.id) ?? SCORE_IDS;
  if (!isObj(out)) return ['file is not a JSON object'];
  if (out.schemaVersion !== OUTPUT_SCHEMA_VERSION) p.push(`schemaVersion must be ${OUTPUT_SCHEMA_VERSION}`);
  if (typeof out.isSampleData !== 'boolean') p.push('isSampleData must be true or false');
  if (!isObj(out.field) || typeof out.field.id !== 'string' || !isNum(out.field.lat) || !isNum(out.field.lon)) p.push('field needs id, county, state, lat, lon');
  if (typeof out.generatedAt !== 'string') p.push('generatedAt must be an ISO timestamp string');

  const s = out.slots;
  if (!isObj(s) || !isObj(s.sources) || !SLOT_KEYS.every((k) => ['model', 'placeholder'].includes(s.sources[k]))) p.push('slots.sources needs modelA..calibrationE each "model" or "placeholder"');
  else if (!Array.isArray(s.placeholderSlots) || s.placeholderSlots.join() !== SLOT_KEYS.filter((k) => s.sources[k] === 'placeholder').join()) p.push('slots.placeholderSlots must list exactly the slots whose source is placeholder, in order');

  if (!isObj(out.priorities) || !isObj(out.priorities.weights) || !scoreIds.every((id) => isNum(out.priorities.weights[id]))) p.push('priorities.weights needs one number per score id');
  else if (Math.abs(scoreIds.reduce((a, id) => a + out.priorities.weights[id], 0) - 1) > 0.01) p.push('priorities.weights must add up to 1');

  option(p, 'current', out.current, scoreIds);
  if (!Array.isArray(out.options) || out.options.length > 30) p.push('options must be an array of at most 30 options');
  else out.options.forEach((o, i) => { option(p, `options[${i}]`, o, scoreIds); if (isObj(o) && o.kind !== 'generated') p.push(`options[${i}].kind must be generated`); });

  const ids = new Set([out.current?.id, ...(out.options ?? []).map((o) => o?.id)]);
  if (isObj(out.bestPlans)) {
    for (const k of ['mostProfitable', 'bestBalance', 'safest']) {
      const b = out.bestPlans[k];
      if (!isObj(b) || !ids.has(b.optionId) || !isObj(b.why) || typeof b.why.key !== 'string') p.push(`bestPlans.${k} needs an optionId from options and why {key, params}`);
    }
    if (!isObj(out.bestPlans.limits)) p.push('bestPlans.limits must describe the limits used (risk, soil T, fit checks)');
  } else p.push('bestPlans must be an object');

  const r = out.fieldRisks;
  if (!isObj(r)) p.push('fieldRisks must be an object');
  else {
    if (!Array.isArray(r.stressCalendar) || r.stressCalendar.length !== 12 || r.stressCalendar.some((m, i) => m.month !== i + 1 || !inRange(m.risk, 0, 1))) p.push('fieldRisks.stressCalendar needs 12 months (1-12) each with risk 0-1');
    if (!Array.isArray(r.nextMonths)) p.push('fieldRisks.nextMonths must be an array');
    else r.nextMonths.forEach((m, i) => { if (!/^\d{4}-\d{2}$/.test(m.month) || !inRange(m.low, 0, 1) || !inRange(m.chance, 0, 1) || !inRange(m.high, 0, 1)) p.push(`fieldRisks.nextMonths[${i}] needs month YYYY-MM and low/chance/high 0-1`); });
    if (!Array.isArray(r.erosionHotspots)) p.push('fieldRisks.erosionHotspots must be an array');
    if (!isObj(r.water) || !isObj(r.water.groundwaterTrend) || !['falling', 'steady', 'rising', 'unknown', 'not-applicable'].includes(r.water.groundwaterTrend.status)) p.push('fieldRisks.water.groundwaterTrend.status must be falling/steady/rising/unknown/not-applicable');
    const c = r.climateNowVs2040;
    if (!isObj(c) || !['frostFreeDays', 'heatDays', 'rainVariability'].every((k) => isObj(c[k]) && isNum(c[k].today) && isNum(c[k].y2040))) p.push('fieldRisks.climateNowVs2040 needs frostFreeDays, heatDays, rainVariability each {today, y2040}');
  }

  const v = out.validation;
  if (!isObj(v) || typeof v.reportFile !== 'string') p.push('validation needs reportFile (path to shared/v2/validation.json) and field-level checks');
  if (!Array.isArray(out.sources) || out.sources.some((x) => typeof x.id !== 'string')) p.push('sources must be an array of {id, name, resolution, scale}');
  return p;
}

/** shared/v2/validation.json */
export function validateReportCard(rc) {
  const p = [];
  if (!isObj(rc) || rc.schemaVersion !== OUTPUT_SCHEMA_VERSION || typeof rc.generatedAt !== 'string') return ['report card needs schemaVersion 1 and generatedAt'];
  if (!Array.isArray(rc.checks) || rc.checks.length !== 8) return ['report card needs exactly 8 checks (ids 1-8)'];
  rc.checks.forEach((c, i) => {
    if (c.id !== i + 1 || typeof c.nameKey !== 'string' || !['pass', 'fail', 'partial', 'pending-model', 'not-run'].includes(c.status)) p.push(`checks[${i}] needs id ${i + 1}, nameKey and status pass/fail/partial/pending-model/not-run`);
  });
  return p;
}
