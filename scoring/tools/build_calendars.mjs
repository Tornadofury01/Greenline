// Builds the per-crop `bareShare` calendars in content/crops.json.  Run from the repo root:
//   node scoring/tools/build_calendars.mjs
//
// bareShare[m] (m = Jan..Dec) = the chance the ground is BARE (satellite NDVI < 0.25) in that month, in a
// calendar year where this crop is the main crop.  For cover crops it is the chance of bare ground WITH the cover
// crop in place; 1 means "the cover crop adds nothing that month".
//
// 1. Data-driven (basis "data"): corn, cotton, grain sorghum and winter wheat, from /shared/crop-calendars-l89.json
//    (built by pipeline/build_fields.py): how often each month was "bare" in the Landsat 8/9-only cover data
//    (coverYearlyL89) for field-years where the Cropland Data Layer says that crop, 2014-2025. Landsat 7 is left out
//    because it reads NDVI ~0.05 lower and was mixed into the older record until ~2023 (docs/landsat89-cover-results.md).
// 2. Estimates: everything the CDL history can't tell us (cover crops, sunflower, sesame, alfalfa, bare fallow).
//    Marked in crops.json as `estimates`, with the reference that backs the timing. Cereal rye uses the CDL
//    "other small grains" months Nov-May as a proxy for its growing window.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const DATA_CROPS = { corn: 'corn', cotton: 'cotton', grain_sorghum: 'grain_sorghum', winter_wheat: 'winter_wheat' };
const r2 = (x) => Math.round(x * 100) / 100;

// ---- 1. measured: Landsat 8/9 + CDL calendars for the 200 sampled fields
const cal = JSON.parse(readFileSync(new URL('shared/crop-calendars-l89.json', root)));
const [FROM, TO] = cal.years;
const measured = (cls) => cal.crops[cls].bareShare.map((p) => (p == null ? null : r2(p)));
const nYears = (cls) => cal.crops[cls].clearFieldYears[5]; // field-years with a clear June image

// ---- 2. estimates (Jan..Dec)
const ESTIMATES = {
  // Warm oilseeds: planted late spring, harvested Aug-Oct. Shaped like cotton / sorghum.
  sunflower: { share: [0.6, 0.55, 0.5, 0.35, 0.15, 0.05, 0.05, 0.2, 0.45, 0.6, 0.5, 0.5], refs: ['fao-cwn'] },
  sesame:    { share: [0.6, 0.55, 0.5, 0.45, 0.35, 0.25, 0.05, 0.02, 0.1, 0.45, 0.55, 0.55], refs: ['agrilife-sesame'] },
  // Perennial: green most of the year, thinner in winter dormancy.
  alfalfa:   { share: [0.3, 0.25, 0.1, 0.05, 0.03, 0.03, 0.03, 0.05, 0.05, 0.08, 0.15, 0.3], refs: [] },
  // Clean (tilled) fallow: bare most of the year. CDL "fallow/idle" fields are NOT used: idle land grows weeds
  // and showed only ~75 bare days, which doesn't describe a bare-fallow season.
  fallow:    { share: [0.85, 0.85, 0.8, 0.8, 0.75, 0.65, 0.65, 0.7, 0.75, 0.8, 0.85, 0.85], refs: [] },
  // Cover crops: only the months the cover is actually growing (or lying as mulch) help; 1 elsewhere.
  cereal_rye:         { share: [0.01, 0.04, 0.01, 0.03, 0.1, 0.4, 0.7, 1, 1, 0.8, 0.25, 0.14], refs: ['sare-rye'], proxy: 'small_grain' },
  hairy_vetch:        { share: [0.2, 0.2, 0.15, 0.1, 0.2, 0.5, 0.8, 1, 1, 0.8, 0.4, 0.25], refs: ['sare-vetch'] },
  cowpea:             { share: [1, 1, 1, 1, 1, 0.6, 0.15, 0.05, 0.1, 0.3, 0.6, 1], refs: ['nrcs-cowpea'] },
  sorghum_sudangrass: { share: [1, 1, 1, 1, 1, 0.7, 0.2, 0.1, 0.2, 0.5, 0.8, 1], refs: ['sare-sudan'] },
};

// ---- write into crops.json (same layout as before: one line per crop)
const path = new URL('content/crops.json', root);
const lib = JSON.parse(readFileSync(path, 'utf8'));
lib.sourceRefs['gl-landsat-cdl'] = `Greenline: monthly Landsat 8/9 cover (NDVI < 0.25 = bare, no Landsat 7) for 200 North Texas fields joined to USDA CDL crop history, ${FROM}-${TO}. From shared/crop-calendars-l89.json. Built by scoring/tools/build_calendars.mjs.`;
lib._fields.bareShare = '12 numbers Jan-Dec: chance the ground is bare that month when this crop is the main crop (cover crops: with the cover in place, 1 = adds nothing). Basis: measured from satellite (see sources) or an estimate (see estimates).';
for (const c of lib.crops) {
  const est = ESTIMATES[c.id];
  if (DATA_CROPS[c.id]) {
    c.bareShare = measured(DATA_CROPS[c.id]);
    c.sources = { ...c.sources, bareShare: ['gl-landsat-cdl'] };
    c.bareShareYears = nYears(DATA_CROPS[c.id]);
  } else if (est) {
    c.bareShare = est.share;
    c.estimates = [...new Set([...(c.estimates || []), 'bareShare'])];
    c.estimateNotes = { ...(c.estimateNotes || {}), bareShare: est.refs.length ? est.refs : ['agronomic timing'] };
    if (est.proxy) c.proxies = { ...(c.proxies || {}), bareShare: `Nov-May from CDL "${est.proxy}" months (proxy); summer mulch is an estimate` };
  }
}
const head = JSON.stringify(Object.fromEntries(Object.entries(lib).filter(([k]) => k !== 'crops')), null, 2).slice(0, -2);
writeFileSync(path, `${head},\n  "crops": [\n${lib.crops.map((c) => '    ' + JSON.stringify(c)).join(',\n')}\n  ]\n}\n`);
for (const c of lib.crops) console.log(c.id.padEnd(20), c.bareShare.join(' '));
