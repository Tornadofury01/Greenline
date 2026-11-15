// The ONE place the app gets field data.
//
// Real data: /shared/fields/<id>.json (built by pipeline/build_fields.py, format in /shared/data-format.md v2),
// one file per study field (300 Ellis County USDA field outlines, ec-000 ... ec-299), loaded on demand. If a file can't be loaded, the result is
// { error: 'network' | 'missing' } and the app says so. The fake /shared/sample-field.json is only used in development
// (npm run dev), never in a production build: a farmer must never see fake data in place of their field.
//
// Privacy: a map tap or GPS point is only used here, in the browser, to find the nearest sampled field and look it up
// in the cropland mask. It is never stored or sent.
import cropLibrary from '@content/crops.json';
import rotationLibrary from '@content/rotations.json';
import outlineFile from '@shared/field-outlines.json';
import mapLayerFile from '@shared/map-layers.json';
import placeholderSlots from '@content/model-placeholders.json';
import { slotModelC } from '@scoring/modelSlots.js';
import { DEMO_FIELD_ID } from '../config.js';

// Lazy: each field file becomes its own small chunk, fetched only when needed.
const FIELD_FILES = import.meta.glob(['../../../shared/fields/*.json', '!../../../shared/fields/index.json']);
// The index (id, county, lat, lon for 300 fields, ~20 kB) is bundled so map taps work offline.
const INDEX_FILE = import.meta.glob('../../../shared/fields/index.json', { eager: true, import: 'default' });
const pathFor = (id) => `../../../shared/fields/${id}.json`;

export const crops = cropLibrary;
export const candidateRotations = rotationLibrary.rotations;

// Cover thresholds for the app's monthly cover (same as pipeline/build_fields.py).
export const BARE_NDVI = 0.25;
export const GREEN_NDVI = 0.40;

const coverState = (v) => (v == null ? null : v >= GREEN_NDVI ? 'green' : v < BARE_NDVI ? 'bare' : 'residue');

// Monthly NDVI rows -> [{ year, months[12], cloudyMonths }]
const coverFromNdvi = (rows) => {
  const byYear = {};
  for (const n of rows) (byYear[n.year] ||= Array(12).fill(null))[n.month - 1] = coverState(n.ndvi);
  return Object.entries(byYear).map(([year, months]) => ({ year: Number(year), months, cloudyMonths: months.filter((m) => !m).length }));
};

// v2: nothing in the app may use the earlier model outputs (crop classifier, weather stress signal, year-type model,
// their accuracy numbers). They are removed here, the ONE place field data enters, so every screen that checks
// `field.si` simply hides that part, and the year types come from the Model C PLACEHOLDER slot
// (content/model-placeholders.json: 2000 and 2011 drought, 2015 wet, the rest normal) until the real model is plugged in.
// Crops per year stay the USDA Cropland Data Layer labels (the Model A placeholder), with no confidence number.
function withPlaceholderModels(field) {
  const c = slotModelC(field, null, placeholderSlots);
  const typeOf = new Map(c.yearTypes.map((r) => [r.year, r.type === 'hot' ? 'heat' : r.type])); // app colors say "heat"
  return {
    ...field,
    si: null,
    sources: field.sources?.filter((x) => x.id !== 'si'), // the earlier models are not a data source any more
    quality: field.quality ? { ...field.quality, modelAgreesWithCdlPct: undefined } : field.quality,
    climateYearly: field.climateYearly.map((y) => ({ ...y, yearType: typeOf.get(y.year) ?? 'normal' })),
    yearTypesPlaceholder: true,
  };
}

// v1 files (the fake sample) lack the v2/v3 extras. Derive what we can so every screen works the same way.
function withDerived(field) {
  return withPlaceholderModels(addDerived(field));
}
function addDerived(field) {
  if (field.coverYearly) return field;
  return {
    ...field,
    coverYearly: coverFromNdvi(field.ndviMonthly),
    coverYearlyL89: field.ndviMonthlyL89 ? coverFromNdvi(field.ndviMonthlyL89) : undefined,
    bareDaysPerYear: field.bareDaysPerYear.map((b) => ({ ...b, score: Math.round(100 * (1 - b.days / 365)) })),
    bareDaysPerYearL89: field.bareDaysPerYearL89?.map((b) => ({ ...b, score: b.score ?? Math.round(100 * (1 - b.days / 365)) })),
    quality: null,
    si: null,
  };
}

// Development only: the fake sample, so the screens still work while a field file is being rebuilt.
async function fallback(reason, id) {
  if (!import.meta.env.DEV) return { error: reason, id };
  const sample = (await import('@shared/sample-field.json')).default;
  return { ...withDerived(sample), fallbackReason: reason };
}

// A failed import usually means this tab runs an older build whose field files were replaced by a new deploy.
// Reload once (per tab session) to get the current build; after that, report the error.
const RELOAD_FLAG = 'greenline:reloaded';
function reloadOnce() {
  try {
    if (import.meta.env.DEV || !navigator.onLine || sessionStorage.getItem(RELOAD_FLAG)) return false;
    sessionStorage.setItem(RELOAD_FLAG, '1');
  } catch { return false; }
  window.location.reload();
  return true;
}

export async function loadFieldById(id) {
  const load = FIELD_FILES[pathFor(id)];
  if (!load) return fallback('missing', id);
  try {
    const f = (await load()).default;
    if (!f?.field || !Array.isArray(f.climateYearly)) return fallback('missing', id);
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }
    return withDerived(f);
  } catch {
    if (reloadOnce()) return new Promise(() => {}); // the page is reloading
    return fallback('network', id);
  }
}

export const loadDemoField = () => loadFieldById(DEMO_FIELD_ID);

function loadIndex() {
  return INDEX_FILE['../../../shared/fields/index.json']?.fields || [];
}
// The sampled fields (id, county, lat, lon).
export const fieldIndex = loadIndex;

// The 300 USDA field outlines for the map (shared/field-outlines.json, built by pipeline/build_field_outlines.mjs):
// [{ id, acres, rings: [[[lat, lon], ...], ...holes] }]. Bundled, so the outlines draw offline.
export const fieldOutlines = () => outlineFile.fields;
const OUTLINE_BY_ID = new Map(outlineFile.fields.map((f) => [f.id, f]));
export const outlineFor = (id) => OUTLINE_BY_ID.get(id) || null;

// Map context (shared/map-layers.json, built by pipeline/build_map_layers.mjs): county line, town labels, the padded
// outline around the 300 fields and the opening view. Bundled, so it works offline.
export const mapLayers = mapLayerFile;
// Is this point inside the area that holds our 300 fields? (ray casting on the padded study hull)
export function insideStudyArea(lat, lon) {
  const r = mapLayerFile.studyHull;
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [yi, xi] = r[i]; const [yj, xj] = r[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---- Cropland mask (shared/cropland-mask.json, built by pipeline/build_cropland_mask.py): ~400 m cells over North
// Texas, 1 = USDA CDL cropland. Lazy chunk (precached by the service worker, so it works offline).
let maskPromise = null;
async function loadMask() {
  maskPromise ||= import('@shared/cropland-mask.json').then((m) => {
    const mask = m.default;
    const bin = atob(mask.bits);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { ...mask, bytes };
  }).catch(() => null);
  return maskPromise;
}

// Is this point cropland? true / false, or null when we can't tell (outside the mask box or mask not loaded).
// A cropland cell next to the point also counts, so a tap a little off the field edge isn't flagged.
export async function croplandAt(lat, lon) {
  const m = await loadMask();
  if (!m) return null;
  const [west, south, east, north] = m.bbox;
  if (lat < south || lat > north || lon < west || lon > east) return null;
  const row = Math.floor((north - lat) / m.cellDeg);
  const col = Math.floor((lon - west) / m.cellDeg);
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = col - 1; c <= col + 1; c++) {
      if (r < 0 || c < 0 || r >= m.rows || c >= m.cols) continue;
      const i = r * m.cols + c;
      if (m.bytes[i >> 3] & (0x80 >> (i & 7))) return true; // numpy packbits: most significant bit first
    }
  }
  return false;
}

// Distance in km between two points (haversine).
function km(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2
    + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Point -> { id, nearestKm, notCropland } for the nearest sampled field. Only this summary is kept, never the point.
export async function nearestTo(lat, lon) {
  const idx = loadIndex();
  if (!idx.length) return null;
  let best = idx[0];
  let bestKm = Infinity;
  for (const f of idx) {
    const d = km(lat, lon, f.lat, f.lon);
    if (d < bestKm) { best = f; bestKm = d; }
  }
  const cropland = await croplandAt(lat, lon);
  // Within 500 m of a sampled field counts as cropland (small fields can fall under the mask's 25 % cell rule).
  return { id: best.id, nearestKm: Math.round(bestKm * 10) / 10, notCropland: cropland === false && bestKm > 0.5 };
}

// Load the field found by nearestTo(), with its distance and cropland warning.
export async function loadNearest(info) {
  if (!info) return fallback('missing');
  const field = await loadFieldById(info.id);
  if (field.error || field.fallbackReason) return field;
  return { ...field, nearestKm: info.nearestKm, notCropland: info.notCropland };
}

// Tap -> the nearest sampled field. Real per-cell data for every 30 m cell is on the roadmap.
export async function loadFieldAt(lat, lon) {
  return loadNearest(await nearestTo(lat, lon));
}

// Default "current rotation" guess: distinct library crops from the last 4 years, oldest first.
export function guessCurrentRotation(field) {
  const ids = new Set(cropLibrary.crops.map((c) => c.id));
  const recent = field.cropHistory.slice(-4).map((h) => h.crop).filter((c) => ids.has(c));
  return [...new Set(recent)];
}
