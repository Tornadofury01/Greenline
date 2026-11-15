// Model slots: the ONE place the engine gets field-specific model values.
//
// Five slots (docs/v2-data-contract.md, docs/v2-model-plugin.md):
//   modelA       field history   crop per year, crop dates, bare windows
//   modelB       field response  drought / heat sensitivity per crop, stress outlook
//   modelC       year types      past year types + 2040 frequencies
//   modelD       soil moisture   starting root-zone moisture
//   calibrationE yields          typical yield + yield settings per crop
//
// Each slot function returns the model's values when the model file has a valid section for that slot,
// otherwise the fixed PLACEHOLDER from content/model-placeholders.json. Every result carries
//   source: "model" | "placeholder"   (and `problems: []` when a model section was rejected and replaced).
//
// Pure: no fs, no fetch, no React. The caller passes in the model file (or null) and the placeholders.
// Node loader: scoring/modelSlots.node.js. App: import the JSON and pass it in.
// Never reads earlier model outputs (shared/si, pipeline/fieldshift/models, year types in field files).

export const SCHEMA_VERSION = 1;
export const SLOT_NAMES = ['modelA', 'modelB', 'modelC', 'modelD', 'calibrationE'];
export const YEAR_TYPES = ['drought', 'hot', 'wet', 'normal'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isDoy = (v) => Number.isInteger(v) && v >= 1 && v <= 366;
const isIso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// ---- day helpers (UTC, so no time-zone drift) -------------------------------------------------
const DAY_MS = 86400000;
const dayNum = (year, doy) => Math.floor(Date.UTC(year, 0, doy) / DAY_MS);
const isoOfDayNum = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const daysInYear = (y) => (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY_MS;
const yearOfDayNum = (n) => new Date(n * DAY_MS).getUTCFullYear();

// ---- which source is the model file for this field? -------------------------------------------
// Returns { section, problems }. section is the model's object for the slot, or null.
function pick(modelFile, fieldId, slot, validate) {
  if (!modelFile) return { section: null, problems: [] };
  if (!isObj(modelFile)) return { section: null, problems: ['model file is not a JSON object'] };
  if (modelFile.schemaVersion !== SCHEMA_VERSION) {
    return { section: null, problems: [`schemaVersion must be ${SCHEMA_VERSION}, got ${modelFile.schemaVersion}`] };
  }
  if (fieldId && modelFile.fieldId !== fieldId) {
    return { section: null, problems: [`fieldId mismatch: file says ${modelFile.fieldId}, field is ${fieldId}`] };
  }
  const section = modelFile[slot];
  if (section === undefined || section === null) return { section: null, problems: [] }; // not delivered yet: placeholder, no complaint
  const problems = validate(section);
  return problems.length ? { section: null, problems } : { section, problems: [] };
}

// =================================================================================================
// Model A: field history
// =================================================================================================
function validateA(a) {
  const p = [];
  if (!isObj(a)) return ['modelA must be an object'];
  if (!Array.isArray(a.cropByYear) || !a.cropByYear.length) p.push('modelA.cropByYear must be a non-empty array');
  else a.cropByYear.forEach((r, i) => {
    if (!isObj(r) || !Number.isInteger(r.year) || typeof r.crop !== 'string') p.push(`modelA.cropByYear[${i}] needs integer year and string crop`);
    else if (r.confidence != null && !(isNum(r.confidence) && r.confidence >= 0 && r.confidence <= 1)) p.push(`modelA.cropByYear[${i}].confidence must be 0..1 or null`);
  });
  if (!isObj(a.cropDates)) p.push('modelA.cropDates must be an object keyed by crop id');
  else for (const [crop, d] of Object.entries(a.cropDates)) {
    if (!isObj(d) || !isDoy(d.plantDoy) || !isDoy(d.endDoy) || ![0, -1].includes(d.plantYearOffset)) p.push(`modelA.cropDates.${crop} needs plantDoy, endDoy (1-366) and plantYearOffset 0 or -1`);
  }
  if (a.bareWindows !== undefined) {
    if (!Array.isArray(a.bareWindows)) p.push('modelA.bareWindows must be an array');
    else a.bareWindows.forEach((w, i) => { if (!isObj(w) || !isIso(w.start) || !isIso(w.end) || w.end < w.start) p.push(`modelA.bareWindows[${i}] needs ISO start <= end`); });
  }
  return p;
}

// Bare windows from a crop sequence + calendars: a day is "growing" between planting and end date
// (perennials: all year); in years whose crop is known, every other day is bare. Fallow = all bare.
// Years with an unknown crop ("other") are skipped, never guessed. Returns windows across year ends.
export function bareWindowsFrom(cropByYear, calendars) {
  const known = new Map(); // year -> crop id
  for (const r of cropByYear) if (calendars[r.crop] || r.crop === 'fallow') known.set(r.year, r.crop);
  const growing = new Set();
  for (const [year, crop] of known) {
    const c = calendars[crop];
    if (!c) continue;
    const from = dayNum(year + c.plantYearOffset, c.plantDoy);
    const to = dayNum(year, c.endDoy);
    if (c.perennial) { for (let d = dayNum(year, 1); d < dayNum(year + 1, 1); d++) growing.add(d); continue; }
    for (let d = from; d <= to; d++) growing.add(d);
  }
  const bare = [];
  for (const year of [...known.keys()].sort((a, b) => a - b)) {
    for (let d = dayNum(year, 1); d < dayNum(year + 1, 1); d++) if (!growing.has(d)) bare.push(d);
  }
  const windows = [];
  for (const d of bare) {
    const last = windows[windows.length - 1];
    if (last && d === last.endN + 1) last.endN = d; else windows.push({ startN: d, endN: d });
  }
  return windows.map((w) => ({ start: isoOfDayNum(w.startN), end: isoOfDayNum(w.endN), days: w.endN - w.startN + 1 }));
}

export function bareDaysByYear(windows) {
  const out = {};
  for (const w of windows) {
    const a = Math.floor(Date.parse(w.start) / DAY_MS), b = Math.floor(Date.parse(w.end) / DAY_MS);
    for (let d = a; d <= b; d++) { const y = yearOfDayNum(d); out[y] = (out[y] || 0) + 1; }
  }
  return out;
}

/** Slot A. field = the field file (only cropHistory is read, for the placeholder). */
export function slotModelA(field, modelFile, placeholders) {
  const fieldId = field?.field?.id;
  const { section, problems } = pick(modelFile, fieldId, 'modelA', validateA);
  const ph = placeholders.modelA;
  if (section) {
    const windows = (section.bareWindows ?? bareWindowsFrom(section.cropByYear, section.cropDates))
      .map((w) => ({ ...w, days: w.days ?? Math.round((Date.parse(w.end) - Date.parse(w.start)) / DAY_MS) + 1 }));
    return {
      source: 'model', problems: [],
      cropByYear: section.cropByYear.map((r) => ({ year: r.year, crop: r.crop, confidence: r.confidence ?? null, labelSource: r.labelSource ?? 'model' })),
      cropDates: section.cropDates,
      bareWindows: windows, bareDaysByYear: bareDaysByYear(windows),
    };
  }
  // Placeholder: crop per year straight from the USDA crop map in the field file; fixed typical calendar per crop.
  const cropByYear = (field?.cropHistory ?? []).map((r) => ({ year: r.year, crop: r.crop, confidence: ph.cropConfidence, labelSource: ph.cropYearSource }));
  const windows = bareWindowsFrom(cropByYear, ph.calendars);
  return { source: 'placeholder', problems, cropByYear, cropDates: ph.calendars, bareWindows: windows, bareDaysByYear: bareDaysByYear(windows) };
}

// =================================================================================================
// Model B: field response
// =================================================================================================
function validateB(b) {
  const p = [];
  if (!isObj(b)) return ['modelB must be an object'];
  if (!isObj(b.crops)) p.push('modelB.crops must be an object keyed by crop id');
  else for (const [crop, s] of Object.entries(b.crops)) {
    if (!isObj(s) || !isNum(s.droughtKy) || s.droughtKy < 0 || !isNum(s.heatLossPerDay) || s.heatLossPerDay < 0 || s.heatLossPerDay > 1 || !isNum(s.heatThresholdC)) {
      p.push(`modelB.crops.${crop} needs droughtKy >= 0, heatLossPerDay 0..1, heatThresholdC (deg C)`);
    }
  }
  const o = b.stressOutlook;
  if (o !== undefined) {
    if (!isObj(o) || !isIso(o.asOf) || !Array.isArray(o.months) || !o.months.length) p.push('modelB.stressOutlook needs asOf (ISO date) and a non-empty months array');
    else o.months.forEach((m, i) => {
      if (!isObj(m) || !/^\d{4}-\d{2}$/.test(m.month) || ![m.chance, m.low, m.high].every((x) => isNum(x) && x >= 0 && x <= 1) || m.low > m.chance || m.chance > m.high) {
        p.push(`modelB.stressOutlook.months[${i}] needs month YYYY-MM and low <= chance <= high (each 0..1)`);
      }
    });
  }
  return p;
}

/** Slot B. */
export function slotModelB(field, modelFile, placeholders) {
  const { section, problems } = pick(modelFile, field?.field?.id, 'modelB', validateB);
  const ph = placeholders.modelB;
  if (section) {
    return {
      source: 'model', problems: [], crops: section.crops, defaultCrop: ph.defaultCrop,
      stressOutlook: section.stressOutlook
        ? { kind: 'forecast', asOf: section.stressOutlook.asOf, months: section.stressOutlook.months }
        : { kind: 'calendar-default', byMonth: ph.stressOutlook.monthlyChance, range90: ph.stressOutlook.range90, reasonKey: ph.stressOutlook.reasonKey },
    };
  }
  return {
    source: 'placeholder', problems, crops: ph.crops, defaultCrop: ph.defaultCrop,
    stressOutlook: { kind: 'calendar-default', byMonth: ph.stressOutlook.monthlyChance, range90: ph.stressOutlook.range90, reasonKey: ph.stressOutlook.reasonKey },
  };
}

/** Sensitivity of one crop (falls back to the slot's default crop for crops it does not list). */
export function sensitivityFor(slotB, crop) {
  return slotB.crops[crop] ?? slotB.defaultCrop;
}

/** Next `n` months of stress outlook from an ISO date, as [{month:'YYYY-MM', chance, low, high, reasons}]. */
export function stressOutlookFrom(slotB, dateISO, n = 3) {
  const o = slotB.stressOutlook;
  if (o.kind === 'forecast') return o.months.slice(0, n).map((m) => ({ ...m, reasons: m.reasons ?? [] }));
  const d = new Date(dateISO);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1));
    const chance = o.byMonth[m.getUTCMonth()];
    out.push({
      month: m.toISOString().slice(0, 7), chance,
      low: Math.max(0, chance + o.range90[0]), high: Math.min(1, chance + o.range90[1]),
      reasons: [{ key: o.reasonKey, params: {} }],
    });
  }
  return out;
}

// =================================================================================================
// Model C: year types
// =================================================================================================
const freqOf = (yearTypes) => {
  const f = Object.fromEntries(YEAR_TYPES.map((t) => [t, 0]));
  for (const r of yearTypes) f[r.type] += 1;
  for (const t of YEAR_TYPES) f[t] = yearTypes.length ? f[t] / yearTypes.length : 0;
  return f;
};

function validateC(c) {
  const p = [];
  if (!isObj(c)) return ['modelC must be an object'];
  if (!Array.isArray(c.yearTypes) || !c.yearTypes.length) p.push('modelC.yearTypes must be a non-empty array');
  else c.yearTypes.forEach((r, i) => {
    if (!isObj(r) || !Number.isInteger(r.year) || !YEAR_TYPES.includes(r.type) || !(isNum(r.probability) && r.probability >= 0 && r.probability <= 1)) {
      p.push(`modelC.yearTypes[${i}] needs integer year, type in ${YEAR_TYPES.join('/')}, probability 0..1`);
    }
  });
  if (!isObj(c.frequencies2040)) p.push('modelC.frequencies2040 must have ssp245 and ssp585');
  else for (const s of ['ssp245', 'ssp585']) {
    const f = c.frequencies2040[s];
    if (!isObj(f) || !YEAR_TYPES.every((t) => isNum(f[t]) && f[t] >= 0 && f[t] <= 1)) p.push(`modelC.frequencies2040.${s} needs ${YEAR_TYPES.join(', ')} (each 0..1)`);
    else if (Math.abs(YEAR_TYPES.reduce((a, t) => a + f[t], 0) - 1) > 0.02) p.push(`modelC.frequencies2040.${s} must add up to 1 (within 0.02)`);
  }
  return p;
}

/** Slot C. */
export function slotModelC(field, modelFile, placeholders) {
  const { section, problems } = pick(modelFile, field?.field?.id, 'modelC', validateC);
  if (section) {
    const yearTypes = [...section.yearTypes].sort((a, b) => a.year - b.year);
    return { source: 'model', problems: [], yearTypes, todayFrequencies: freqOf(yearTypes), frequencies2040: section.frequencies2040 };
  }
  const ph = placeholders.modelC;
  const yearTypes = [];
  for (let y = ph.firstYear; y <= ph.lastYear; y++) {
    const o = ph.yearTypeOverrides[String(y)];
    yearTypes.push({ year: y, type: o ?? ph.defaultType, probability: o ? ph.probabilityForOverride : ph.probabilityForDefault });
  }
  const today = freqOf(yearTypes);
  return { source: 'placeholder', problems, yearTypes, todayFrequencies: today, frequencies2040: { ssp245: { ...today }, ssp585: { ...today } } };
}

export const yearTypeOf = (slotC, year) => slotC.yearTypes.find((r) => r.year === year)?.type ?? null;

// =================================================================================================
// Model D: field soil moisture
// =================================================================================================
function validateD(d) {
  const p = [];
  if (!isObj(d)) return ['modelD must be an object'];
  if (!(isNum(d.rootZoneFraction) && d.rootZoneFraction >= 0 && d.rootZoneFraction <= 1)) p.push('modelD.rootZoneFraction must be 0..1 (share of plant-available water)');
  if (d.asOf != null && !isIso(d.asOf)) p.push('modelD.asOf must be an ISO date or null');
  if (d.daily !== undefined) {
    if (!Array.isArray(d.daily)) p.push('modelD.daily must be an array');
    else d.daily.forEach((r, i) => { if (!isObj(r) || !isIso(r.date) || !(isNum(r.fraction) && r.fraction >= 0 && r.fraction <= 1)) p.push(`modelD.daily[${i}] needs ISO date and fraction 0..1`); });
  }
  return p;
}

/** Slot D. */
export function slotModelD(field, modelFile, placeholders) {
  const { section, problems } = pick(modelFile, field?.field?.id, 'modelD', validateD);
  if (section) return { source: 'model', problems: [], rootZoneFraction: section.rootZoneFraction, asOf: section.asOf ?? null, daily: section.daily ?? null };
  const ph = placeholders.modelD;
  return { source: 'placeholder', problems, rootZoneFraction: ph.rootZoneFraction, asOf: ph.asOf, daily: null };
}

// =================================================================================================
// Calibration E: yield settings
// =================================================================================================
function validateE(e) {
  const p = [];
  if (!isObj(e)) return ['calibrationE must be an object'];
  if (!isObj(e.crops)) p.push('calibrationE.crops must be an object keyed by crop id');
  else for (const [crop, c] of Object.entries(e.crops)) {
    if (!isObj(c) || !isNum(c.typicalYield) || c.typicalYield < 0 || typeof c.unit !== 'string') p.push(`calibrationE.crops.${crop} needs typicalYield >= 0 and a unit string`);
    else if ((c.wpScale !== undefined && !(isNum(c.wpScale) && c.wpScale > 0)) || (c.heatThresholdOffsetC !== undefined && !isNum(c.heatThresholdOffsetC))) p.push(`calibrationE.crops.${crop}: wpScale must be > 0 and heatThresholdOffsetC a number`);
  }
  return p;
}

/** Slot E. Each crop comes back with wpScale and heatThresholdOffsetC filled in. */
export function slotCalibrationE(field, modelFile, placeholders) {
  const { section, problems } = pick(modelFile, field?.field?.id, 'calibrationE', validateE);
  const ph = placeholders.calibrationE;
  const src = section ?? ph;
  const defWp = section?.wpScale ?? ph.wpScale, defHeat = section?.heatThresholdOffsetC ?? ph.heatThresholdOffsetC;
  const crops = {};
  for (const [crop, c] of Object.entries(src.crops)) {
    crops[crop] = { typicalYield: c.typicalYield, unit: c.unit, wpScale: c.wpScale ?? defWp, heatThresholdOffsetC: c.heatThresholdOffsetC ?? defHeat };
  }
  return { source: section ? 'model' : 'placeholder', problems: section ? [] : problems, crops, regionId: section?.regionId ?? null };
}

// =================================================================================================
// All five at once
// =================================================================================================
/**
 * @param {{field: object, modelFile?: object|null, placeholders: object}} args
 * @returns {{fieldId, slots:{A,B,C,D,E}, sources:{modelA,modelB,modelC,modelD,calibrationE}, placeholderSlots:string[], problems:string[]}}
 * `placeholderSlots` is what the app tags "default value, field model coming".
 */
export function makeSlots({ field, modelFile = null, placeholders }) {
  const A = slotModelA(field, modelFile, placeholders);
  const B = slotModelB(field, modelFile, placeholders);
  const C = slotModelC(field, modelFile, placeholders);
  const D = slotModelD(field, modelFile, placeholders);
  const E = slotCalibrationE(field, modelFile, placeholders);
  const sources = { modelA: A.source, modelB: B.source, modelC: C.source, modelD: D.source, calibrationE: E.source };
  const fileProblems = modelFile && !isObj(modelFile) ? ['model file is not a JSON object'] : [];
  const problems = [...fileProblems, ...A.problems, ...B.problems, ...C.problems, ...D.problems, ...E.problems];
  return {
    fieldId: field?.field?.id ?? null,
    slots: { A, B, C, D, E }, sources,
    placeholderSlots: SLOT_NAMES.filter((s) => sources[s] === 'placeholder'),
    problems: [...new Set(problems)],
  };
}
