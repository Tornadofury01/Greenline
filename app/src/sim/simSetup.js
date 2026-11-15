// Farm simulator setup: turns the screen's choices into engine inputs. Pure JavaScript (no React, no DOM, no node-only files),
// so the web worker and the screen use the same code. The engine itself is /scoring/engine, run unchanged in the browser.
import library from '@content/crop-library.json';
import placeholders from '@content/model-placeholders.json';
import economics from '@content/economics.json';
import { makeSlots } from '@scoring/modelSlots.js';
import { DEFAULT_MANAGEMENT, PEST_IDS, pricesFromField, makeWeather, yearsOfType, hargreavesET0, extraterrestrialMm } from '@scoring/engine/index.js';

export const START_YEAR = 2027;            // first full year after "today" (Nov 2026)
export const MAX_YEARS = 30;
export const COLS = ['rain', 'tmax', 'tmin', 'irr', 'rz', 'rzCap', 'stress', 'canopy', 'ground', 'residue', 'biomass', 'stage', 'eros', 'minN', 'som', 'profit', 'nFix', 'drain', 'runoff', ...PEST_IDS];
export const COVERS = ['cereal_rye', 'crimson_clover', 'hairy_vetch'];
export const libById = Object.fromEntries(library.crops.map((c) => [c.id, c]));
export const CASH_CROPS = library.crops.filter((c) => c.kind === 'cash' || c.kind === 'fallow').map((c) => c.id);
/** Model slots for a field. modelFile = shared/v2/models/<id>.json (data/loadModels.js) or null (all placeholders). */
export const slotsFor = (field, modelFile = null) => makeSlots({ field, modelFile, placeholders });

// Seeded random (mulberry32) so two plans and a re-run see the same weather.
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const pastYears = (field) => [...new Set((field.climateMonthly ?? []).map((r) => r.year))].filter((y) => field.climateMonthly.filter((r) => r.year === y).length === 12).sort();

/** "Your farm today": the last three crop years from the field's crop history (model slot A), as [{ main, cover }]. */
export function todayCrops(field, slots) {
  const known = (slots.slots.A.cropByYear ?? []).slice(-3);
  const list = known.map((r) => ({ main: libById[r.crop] && libById[r.crop].kind !== 'cover' ? r.crop : 'fallow', cover: null }));
  return list.length ? list : [{ main: 'fallow', cover: null }];
}

export const defaultControls = () => ({ tillage: DEFAULT_MANAGEMENT.tillage, nitrogen: 'default', irrigation: 'none', shiftDays: 0, maturity: 'full', termination: 'at-planting' });

/** The engine's plan object from a crop list + controls. Calendars come from slot A (placeholder or model). */
export function buildPlan(slots, crops, controls, id) {
  const cal = slots.slots.A.cropDates;
  const clamp = (d) => Math.min(365, Math.max(1, d));
  const entry = (cropId, role) => {
    const c = cal[cropId];
    const shift = role === 'cash' ? controls.shiftDays : 0;
    return { crop: cropId, role, plantDoy: clamp(c.plantDoy + shift), endDoy: clamp(c.endDoy + shift), plantYearOffset: c.plantYearOffset };
  };
  const sequence = crops.map((y, i) => {
    const list = [];
    if (y.main === 'fallow' || !cal[y.main]) list.push({ crop: 'fallow', role: 'fallow', plantDoy: 1, endDoy: 365, plantYearOffset: 0 });
    else list.push(entry(y.main, libById[y.main].kind));
    if (y.cover && cal[y.cover]) list.push(entry(y.cover, 'cover'));
    return { year: i + 1, crops: list };
  });
  const management = {
    ...DEFAULT_MANAGEMENT, tillage: controls.tillage, irrigation: controls.irrigation, maturity: controls.maturity, coverTermination: controls.termination,
    nitrogenLbPerAcre: controls.nitrogen === 'default' ? 'default' : Number(controls.nitrogen),
  };
  return { id, startYear: START_YEAR, sequence, management };
}

/** Weather for one run: { provider, weatherYears, yearsUsed[] }. kind: typical | past | random | ssp245 | ssp585. Sliders on top of any of them. */
export function buildWeather(field, slots, scen, years) {
  const base = makeWeather(field, { seed: scen.seed ?? 1 });
  const avail = pastYears(field);
  const r = rng((scen.seed ?? 1) * 7919 + 13);
  const draw = (list) => list[Math.floor(r() * list.length)];
  let weatherYears = null;
  if (scen.kind === 'past') weatherYears = Array.from({ length: years }, (_, i) => (i === 0 ? scen.year : draw(avail)));
  else if (scen.kind === 'random') weatherYears = Array.from({ length: years }, () => draw(avail));
  else if (scen.kind === 'ssp245' || scen.kind === 'ssp585') {
    const freq = slots.slots.C.frequencies2040[scen.kind];
    weatherYears = Array.from({ length: years }, () => {
      let x = r(), type = 'normal';
      for (const t of ['drought', 'hot', 'wet', 'normal']) { x -= freq[t]; if (x <= 0) { type = t; break; } }
      const pool = yearsOfType(slots.slots.C, type).filter((y) => avail.includes(y));
      return draw(pool.length ? pool : avail);
    });
  }
  const rainK = 1 + (scen.rainPct ?? 0) / 100, dT = scen.tempC ?? 0, lat = field.field.lat;
  if (rainK === 1 && dT === 0) return { provider: base, weatherYears };
  const cache = new Map();
  const provider = {
    ...base,
    year(y) {
      let w = cache.get(y);
      if (!w) {
        const b = base.year(y), n = b.days;
        const rain = Float64Array.from(b.rain, (x) => x * rainK), tmin = Float64Array.from(b.tmin, (x) => x + dT), tmax = Float64Array.from(b.tmax, (x) => x + dT);
        const et0 = new Float64Array(n);
        for (let i = 0; i < n; i++) et0[i] = hargreavesET0(tmin[i], tmax[i], extraterrestrialMm(lat, i + 1));
        w = { year: y, days: n, rain, tmin, tmax, et0 }; cache.set(y, w);
      }
      return w;
    },
    sourceOf: (y) => base.sourceOf(y),
  };
  return { provider, weatherYears };
}

/** Engine config for one plan. */
export function engineConfig({ field, slots, plan, years, scen, money }) {
  const { provider, weatherYears } = buildWeather(field, slots, scen, years);
  const base = pricesFromField(field, library);
  const k = 1 + (money.pricePct ?? 0) / 100;
  const prices = Object.fromEntries(Object.entries(base).map(([id, p]) => [id, { ...p, usdPerUnit: p.usdPerUnit * k }]));
  return { field, slots, library, plan, years, startYear: START_YEAR, weather: provider, weatherYears, prices, economics: { ...economics, nPricePerLb: money.nPrice ?? economics.nPricePerLb } };
}
