// Field Shift v2, Model A crop dates, step 1: how the ENGINE's canopy relates to its planting and harvest days.
// For each cash crop, the engine is run on the textbook calendar (content/model-placeholders.json) over 1999-2013 on a
// sample of fields; per season we record
//   riseLag = (first day canopy >= half its season peak) - planting day
//   fallLag = harvest day - (last day canopy >= half its season peak)
// write_model_slots.py then sets a field's planting day = its observed half-green day - riseLag, and its harvest
// day = its observed half-brown day + fallLag, so the simulated canopy turns green and brown when the field did.
//   node pipeline/v2/engine_lags.mjs        -> pipeline/v2/engine_lags.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { slotsForField } from '../../scoring/modelSlots.node.js';
import { loadField, loadLibrary, loadEconomics } from '../../scoring/engine/node.js';
import { makeContext, runPlan } from '../../scoring/v2/context.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const CROPS = ['corn', 'grain_sorghum', 'cotton', 'winter_wheat', 'soybeans', 'sunflower'];
const FIRST = 1999, YEARS = 15;
const index = readJson('shared/v2/input-index.json').fields;
// 3 fields per county, spread through the list
const sample = Object.values(index.reduce((a, r) => ((a[r.countyFips] ??= []).push(r.id), a), {})).flatMap((ids) => [ids[10], ids[100], ids[200]].filter(Boolean));
const ph = readJson('content/model-placeholders.json').modelA.calendars;
const library = loadLibrary(), economics = loadEconomics(), scoresConfig = readJson('content/v2-scores.json');
const lib = Object.fromEntries(library.crops.map((c) => [c.id, c]));
const DAY = 365.25;

const out = {};
for (const crop of CROPS) {
  const cal = ph[crop];
  const rise = [], fall = [];
  for (const id of sample) {
    const field = loadField(id);
    const slots = slotsForField(field);
    const ctx = makeContext({ field, slots, library, economics, scoresConfig, regional: { cropFieldShare: {} }, now: new Date().toISOString() });
    const plan = { id: 'lag', startYear: FIRST, management: {},
      sequence: Array.from({ length: YEARS }, (_, i) => ({ year: i + 1, crops: [{ crop, role: lib[crop].kind, plantDoy: cal.plantDoy, endDoy: cal.endDoy, plantYearOffset: cal.plantYearOffset }] })) };
    const seasons = new Map(); // harvest year -> [{t, cc}]
    runPlan(ctx, plan, { startYear: FIRST, years: YEARS, onDay: (r) => {
      if (r.crop !== crop) return;
      const t = r.year * DAY + r.doy;
      const hy = cal.plantYearOffset === -1 && r.doy > 200 ? r.year + 1 : r.year;
      if (!seasons.has(hy)) seasons.set(hy, []);
      seasons.get(hy).push({ t, cc: r.canopyCover ?? 0 });
    } });
    for (const [hy, days] of seasons) {
      const peak = Math.max(...days.map((d) => d.cc));
      if (!(peak > 0.05)) continue;
      const up = days.find((d) => d.cc >= peak / 2), down = [...days].reverse().find((d) => d.cc >= peak / 2);
      const plantT = (hy + cal.plantYearOffset) * DAY + cal.plantDoy, endT = hy * DAY + cal.endDoy;
      rise.push(up.t - plantT); fall.push(endT - down.t);
    }
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  out[crop] = { riseLag: Math.round(med(rise)), fallLag: Math.round(med(fall)), seasons: rise.length };
  console.log(crop, out[crop]);
}
writeFileSync(resolve(root, 'pipeline/v2/engine_lags.json'), JSON.stringify({ _note: 'Engine canopy lags on the textbook calendars, 1999-2013, 18 sample fields (pipeline/v2/engine_lags.mjs)', crops: out }, null, 1));
