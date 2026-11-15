// Model slot checks: node scoring/selftest-modelslots.js
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeSlots, bareWindowsFrom, bareDaysByYear, stressOutlookFrom, sensitivityFor } from './modelSlots.js';
import { loadPlaceholders, loadModelFile, slotsForField } from './modelSlots.node.js';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
let failed = 0;
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failed++; };

const ph = loadPlaceholders();
const f1 = load('../shared/fields/ec-251.json');
const f2 = load('../shared/fields/ec-000.json');
const dir = mkdtempSync(join(tmpdir(), 'slots-'));
const none = { modelsDir: dir };

// ---- placeholders (no model file) ----
const p1 = slotsForField(f1, none), p2 = slotsForField(f2, none);
check(p1.placeholderSlots.length === 5 && Object.values(p1.sources).every((s) => s === 'placeholder'), 'no file: all five slots are placeholder');
check(p1.problems.length === 0, 'no file: no problems reported');
check(p1.slots.A.cropByYear.length === f1.cropHistory.length && p1.slots.A.cropByYear.every((r, i) => r.crop === f1.cropHistory[i].crop), 'A placeholder: crop per year = USDA crop map in the field file');
check(p1.slots.A.cropByYear.every((r) => r.confidence === null), 'A placeholder: confidence is null, not a made-up number');
check(JSON.stringify(p1.slots.A.cropDates) === JSON.stringify(p2.slots.A.cropDates), 'A placeholder: same calendar for every field');
for (const k of ['B', 'C', 'D', 'E']) check(JSON.stringify(p1.slots[k]) === JSON.stringify(p2.slots[k]), `${k} placeholder: identical for two different fields`);
const c = p1.slots.C;
const type = (y) => c.yearTypes.find((r) => r.year === y).type;
check(type(2011) === 'drought' && type(2000) === 'drought' && type(2015) === 'wet' && type(2012) === 'normal', 'C placeholder: 2000 and 2011 drought, 2015 wet, rest normal');
check(c.yearTypes.length === 41 && Math.abs(Object.values(c.todayFrequencies).reduce((a, b) => a + b, 0) - 1) < 1e-9, 'C placeholder: 41 years, frequencies add to 1');
check(JSON.stringify(c.frequencies2040.ssp245) === JSON.stringify(c.todayFrequencies) && JSON.stringify(c.frequencies2040.ssp585) === JSON.stringify(c.todayFrequencies), 'C placeholder: 2040 same as today');
check(p1.slots.D.rootZoneFraction === ph.modelD.rootZoneFraction, 'D placeholder: one fixed value');
check(p1.slots.E.crops.winter_wheat.typicalYield === 45 && p1.slots.E.crops.winter_wheat.wpScale === 1, 'E placeholder: fixed typical yield, wpScale 1');
check(sensitivityFor(p1.slots.B, 'nonsense').droughtKy === ph.modelB.defaultCrop.droughtKy, 'B: unknown crop falls back to the default crop');
const out = stressOutlookFrom(p1.slots.B, '2026-11-14', 3);
check(out.length === 3 && out[0].month === '2026-12' && out[2].month === '2027-02' && out.every((m) => m.low <= m.chance && m.chance <= m.high), 'B placeholder: 3-month outlook, month names roll over the year');

// ---- bare windows ----
const wheatOnly = bareWindowsFrom([{ year: 2020, crop: 'winter_wheat' }, { year: 2021, crop: 'winter_wheat' }], ph.modelA.calendars);
check(wheatOnly.length > 0 && wheatOnly.every((w) => w.days > 0), 'bare windows: wheat-wheat has windows');
const fal = bareDaysByYear(bareWindowsFrom([{ year: 2020, crop: 'fallow' }], ph.modelA.calendars));
check(fal[2020] === 366, 'bare windows: a fallow year is fully bare (2020 leap = 366)');
const unk = bareWindowsFrom([{ year: 2020, crop: 'other' }], ph.modelA.calendars);
check(unk.length === 0, 'bare windows: unknown crop ("other") is skipped, never guessed');
const alf = bareDaysByYear(bareWindowsFrom([{ year: 2020, crop: 'alfalfa' }], ph.modelA.calendars));
check(!alf[2020], 'bare windows: perennial alfalfa has no bare days');

// ---- model file present (fake, in a temp dir) ----
const model = {
  schemaVersion: 1, fieldId: 'ec-251', generatedAt: '2026-11-14T00:00:00Z', modelVersions: { A: 'fake', B: 'fake', C: 'fake', D: 'fake', E: 'fake' },
  modelA: {
    cropByYear: [{ year: 2022, crop: 'winter_wheat', confidence: 0.9 }, { year: 2023, crop: 'corn', confidence: 0.8 }],
    cropDates: { winter_wheat: { plantYearOffset: -1, plantDoy: 300, greenUpDoy: 50, peakDoy: 110, endDoy: 150, endKind: 'harvest', rangeDays: 7 }, corn: { plantYearOffset: 0, plantDoy: 90, endDoy: 230, endKind: 'harvest', rangeDays: 7 } },
  },
  modelB: { crops: { corn: { droughtKy: 1.6, heatLossPerDay: 0.02, heatThresholdC: 34 } }, stressOutlook: { asOf: '2026-11-14', months: [{ month: '2026-12', chance: 0.3, low: 0.2, high: 0.5, reasons: [{ key: 'x', params: {} }] }] } },
  modelC: { yearTypes: [{ year: 2011, type: 'drought', probability: 0.9 }, { year: 2012, type: 'hot', probability: 0.6 }], frequencies2040: { ssp245: { drought: 0.3, hot: 0.2, wet: 0.1, normal: 0.4 }, ssp585: { drought: 0.4, hot: 0.3, wet: 0.1, normal: 0.2 } } },
  modelD: { rootZoneFraction: 0.2, asOf: '2026-11-13' },
  calibrationE: { regionId: 'tx-blackland', wpScale: 0.9, crops: { corn: { typicalYield: 120, unit: 'bu/acre' } } },
};
writeFileSync(join(dir, 'ec-251.json'), JSON.stringify(model));
const m1 = slotsForField(f1, none);
check(Object.values(m1.sources).every((s) => s === 'model') && m1.problems.length === 0, 'model file: all five slots read as source "model"');
check(m1.slots.A.cropByYear.length === 2 && m1.slots.A.cropByYear[0].confidence === 0.9, 'model file: A uses the file crops and confidence');
check(JSON.stringify(m1.slots.A.bareDaysByYear) !== JSON.stringify(p1.slots.A.bareDaysByYear), 'model file: A changes the bare days');
check(sensitivityFor(m1.slots.B, 'corn').droughtKy === 1.6, 'model file: B sensitivity replaced');
check(stressOutlookFrom(m1.slots.B, '2030-01-01', 1)[0].chance === 0.3, 'model file: B outlook is the file forecast');
check(m1.slots.C.yearTypes.length === 2 && m1.slots.C.frequencies2040.ssp585.drought === 0.4, 'model file: C year types and 2040');
check(m1.slots.D.rootZoneFraction === 0.2, 'model file: D value replaced');
check(m1.slots.E.crops.corn.typicalYield === 120 && m1.slots.E.crops.corn.wpScale === 0.9, 'model file: E yield replaced, wpScale default filled');
check(m1.slots.E.crops.winter_wheat === undefined, 'model file: E lists only the crops the file lists');

// ---- partial / bad / wrong-field files ----
const partial = makeSlots({ field: f1, modelFile: { schemaVersion: 1, fieldId: 'ec-251', modelC: model.modelC }, placeholders: ph });
check(partial.sources.modelC === 'model' && partial.placeholderSlots.join() === 'modelA,modelB,modelD,calibrationE', 'partial file: only the delivered slot switches to "model"');
const bad = makeSlots({ field: f1, modelFile: { schemaVersion: 1, fieldId: 'ec-251', modelD: { rootZoneFraction: 7 } }, placeholders: ph });
check(bad.sources.modelD === 'placeholder' && bad.problems.some((p) => p.includes('modelD.rootZoneFraction')), 'bad section: falls back to placeholder and says why');
const wrong = makeSlots({ field: f1, modelFile: { ...model, fieldId: 'ec-999' }, placeholders: ph });
check(wrong.placeholderSlots.length === 5 && wrong.problems.some((p) => p.includes('fieldId mismatch')), 'wrong fieldId: ignored with a message');
const oldv = makeSlots({ field: f1, modelFile: { ...model, schemaVersion: 2 }, placeholders: ph });
check(oldv.placeholderSlots.length === 5 && oldv.problems.some((p) => p.includes('schemaVersion')), 'wrong schemaVersion: ignored with a message');
check(loadModelFile('ec-251', dir) !== null && loadModelFile('ec-000', dir) === null, 'loader: returns null when the file does not exist');
let threw = false; try { loadModelFile('../x', dir); } catch { threw = true; }
check(threw, 'loader: rejects ids with path characters');

// ---- the example file for Pranav stays valid ----
const example = load('../shared/v2-sample/model-example.json');
const ex = makeSlots({ field: f1, modelFile: example, placeholders: ph });
check(ex.placeholderSlots.length === 0 && ex.problems.length === 0, 'shared/v2-sample/model-example.json is read by all five slots');

// ---- no earlier model outputs read ----
const strip = (s) => s.replace(/\/\/.*$/gm, '');
const src = strip(readFileSync(new URL('./modelSlots.js', import.meta.url), 'utf8')) + strip(readFileSync(new URL('./modelSlots.node.js', import.meta.url), 'utf8'));
check(!/shared\/si|fieldshift|year_types|MODELS\.md|climateYearly/.test(src), 'slots code never touches earlier model outputs');

process.exit(failed ? 1 : 0);
