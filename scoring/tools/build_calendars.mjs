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
//    "other small grains" months Nov-May (Landsat 8/9) as a proxy for its growing window.
// 3. Landsat 8/9 level for the estimates. The sunflower, sesame, alfalfa and fallow calendars were written by hand
//    next to the OLD measured calendars (2013-2025, mixed Landsat 7/8/9), which read too bare. We move them to the
//    Landsat 8/9 level with a power curve  new = old ^ GAMMA, fitted (least squares) on the 48 month pairs
//    (old mixed vs Landsat 8/9) of the four measured crops: GAMMA = 1.6, error ~0.04 per month.
//    Why a curve and not one flat ratio (0.63, about the same fit error): Landsat 7's lower NDVI only flips months
//    that sit near the 0.25 "bare" line. A month that is always bare (1) or never bare (0) shouldn't move, and a
//    curve through 0 and 1 does exactly that. Check: it puts the measured crops within ~10 bare days a year of their
//    Landsat 8/9 numbers (corn 88 vs 95, cotton 56 vs 55, sorghum 69 vs 60, wheat 49 vs 60).
//    Cover crops are NOT rescaled: their numbers multiply the cash crop's month (bare only if both are bare) and the
//    cash crop calendars are already Landsat 8/9, so rescaling the cover too would count the sensor shift twice.
//    The results stay estimates (crops.json `estimates`).
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const DATA_CROPS = { corn: 'corn', cotton: 'cotton', grain_sorghum: 'grain_sorghum', winter_wheat: 'winter_wheat' };
const r2 = (x) => Math.round(x * 100) / 100;

// ---- 1. measured: Landsat 8/9 + CDL calendars for the 200 sampled fields
const cal = JSON.parse(readFileSync(new URL('shared/crop-calendars-l89.json', root)));
const [FROM, TO] = cal.years;
const measured = (cls) => cal.crops[cls].bareShare.map((p) => (p == null ? null : r2(p)));
const nYears = (cls) => cal.crops[cls].clearFieldYears[5]; // field-years with a clear June image

// ---- 3. old mixed-sensor measured calendars (Landsat 7/8/9, 2013-2025), as they were in crops.json before the
//         Landsat 8/9 switch (git be65363~1). Only used to fit GAMMA.
const OLD_MIXED = {
  corn:          [0.61, 0.56, 0.47, 0.07, 0.01, 0.01, 0.12, 0.41, 0.52, 0.63, 0.49, 0.48],
  cotton:        [0.61, 0.54, 0.51, 0.31, 0.25, 0.04, 0, 0, 0.03, 0.2, 0.28, 0.36],
  grain_sorghum: [0.58, 0.57, 0.48, 0.25, 0.04, 0.01, 0.01, 0.1, 0.37, 0.47, 0.45, 0.41],
  winter_wheat:  [0.06, 0.05, 0.02, 0.01, 0.05, 0.21, 0.31, 0.48, 0.47, 0.55, 0.33, 0.35],
};
const pairs = Object.keys(OLD_MIXED)
  .flatMap((id) => OLD_MIXED[id].map((p, m) => [p, measured(DATA_CROPS[id])[m]]))
  .filter(([, q]) => q != null);
let GAMMA = 1;
let bestErr = Infinity;
for (let g = 1; g <= 3.0001; g += 0.01) {
  const err = pairs.reduce((s, [p, q]) => s + (p ** g - q) ** 2, 0);
  if (err < bestErr) { bestErr = err; GAMMA = Math.round(g * 100) / 100; }
}
const toL89 = (share) => share.map((p) => r2(p ** GAMMA));

// ---- 2. estimates (Jan..Dec). `share` is the hand-written shape (old mixed-sensor level); `l89: true` moves it to
//         the Landsat 8/9 level with toL89() (step 3). Cover crops keep their numbers (see step 3).
const ESTIMATES = {
  // Warm oilseeds: planted late spring, harvested Aug-Oct. Shaped like cotton / sorghum.
  sunflower: { share: [0.6, 0.55, 0.5, 0.35, 0.15, 0.05, 0.05, 0.2, 0.45, 0.6, 0.5, 0.5], refs: ['fao-cwn'], l89: true },
  sesame:    { share: [0.6, 0.55, 0.5, 0.45, 0.35, 0.25, 0.05, 0.02, 0.1, 0.45, 0.55, 0.55], refs: ['agrilife-sesame'], l89: true },
  // Perennial: green most of the year, thinner in winter dormancy.
  alfalfa:   { share: [0.3, 0.25, 0.1, 0.05, 0.03, 0.03, 0.03, 0.05, 0.05, 0.08, 0.15, 0.3], refs: [], l89: true },
  // Clean (tilled) fallow: bare most of the year. CDL "fallow/idle" fields are NOT used: idle land grows weeds
  // and showed only ~75 bare days, which doesn't describe a bare-fallow season.
  fallow:    { share: [0.85, 0.85, 0.8, 0.8, 0.75, 0.65, 0.65, 0.7, 0.75, 0.8, 0.85, 0.85], refs: [], l89: true },
  // Cover crops: only the months the cover is actually growing (or lying as mulch) help; 1 elsewhere.
  // Cereal rye: Nov-May (null) come from the Landsat 8/9 CDL "small grain" calendar (proxy); Jun-Oct (summer mulch)
  // are estimates.
  cereal_rye:         { share: [null, null, null, null, null, 0.4, 0.7, 1, 1, 0.8, null, null], refs: ['sare-rye'], proxy: 'small_grain' },
  hairy_vetch:        { share: [0.2, 0.2, 0.15, 0.1, 0.2, 0.5, 0.8, 1, 1, 0.8, 0.4, 0.25], refs: ['sare-vetch'] },
  cowpea:             { share: [1, 1, 1, 1, 1, 0.6, 0.15, 0.05, 0.1, 0.3, 0.6, 1], refs: ['nrcs-cowpea'] },
  sorghum_sudangrass: { share: [1, 1, 1, 1, 1, 0.7, 0.2, 0.1, 0.2, 0.5, 0.8, 1], refs: ['sare-sudan'] },
};

// ---- write into crops.json (same layout as before: one line per crop)
const path = new URL('content/crops.json', root);
const lib = JSON.parse(readFileSync(path, 'utf8'));
lib.sourceRefs['gl-landsat-cdl'] = `Greenline: monthly Landsat 8/9 cover (NDVI < 0.25 = bare, no Landsat 7) for 200 North Texas fields joined to USDA CDL crop history, ${FROM}-${TO}. From shared/crop-calendars-l89.json. Built by scoring/tools/build_calendars.mjs.`;
lib._fields.bareShare = `12 numbers Jan-Dec: chance the ground is bare that month when this crop is the main crop (cover crops: with the cover in place, 1 = adds nothing). Basis: measured from satellite (see sources) or an estimate (see estimates). Estimated main-crop calendars (sunflower, sesame, alfalfa, fallow) are put on the Landsat 8/9 level with new = old ^ ${GAMMA}, fitted on the measured crops (scoring/tools/build_calendars.mjs).`;
for (const c of lib.crops) {
  const est = ESTIMATES[c.id];
  if (DATA_CROPS[c.id]) {
    c.bareShare = measured(DATA_CROPS[c.id]);
    c.sources = { ...c.sources, bareShare: ['gl-landsat-cdl'] };
    c.bareShareYears = nYears(DATA_CROPS[c.id]);
  } else if (est) {
    const proxy = est.proxy ? measured(est.proxy) : null;
    const share = est.share.map((p, m) => (p == null ? proxy[m] : p));
    c.bareShare = est.l89 ? toL89(share) : share;
    c.estimates = [...new Set([...(c.estimates || []), 'bareShare'])];
    c.estimateNotes = { ...(c.estimateNotes || {}), bareShare: est.refs.length ? est.refs : ['agronomic timing'] };
    if (est.proxy) c.proxies = { ...(c.proxies || {}), bareShare: `Nov-May from Landsat 8/9 + CDL "${est.proxy}" months (proxy); summer mulch is an estimate` };
  }
}
const head = JSON.stringify(Object.fromEntries(Object.entries(lib).filter(([k]) => k !== 'crops')), null, 2).slice(0, -2);
writeFileSync(path, `${head},\n  "crops": [\n${lib.crops.map((c) => '    ' + JSON.stringify(c)).join(',\n')}\n  ]\n}\n`);
console.log(`GAMMA ${GAMMA} (fit error ${Math.sqrt(bestErr / pairs.length).toFixed(3)} per month, ${pairs.length} pairs)`);
for (const c of lib.crops) console.log(c.id.padEnd(20), c.bareShare.join(' '));
