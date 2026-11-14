// The ONE place the app gets field data.
//
// Real data: /shared/fields/<id>.json (built by pipeline/build_fields.py, format in /shared/data-format.md v2),
// one file per sampled North Texas field, loaded on demand. If a file is missing or broken, the app falls back
// to the fake /shared/sample-field.json and shows the "Sample data" badge.
//
// Privacy: a map tap is only used here, in the browser, to find the nearest sampled field. It is never stored or sent.
import sampleField from '@shared/sample-field.json';
import cropLibrary from '@content/crops.json';
import rotationLibrary from '@content/rotations.json';
import { DEMO_FIELD_ID } from '../config.js';

// Lazy: each field file becomes its own small chunk, fetched only when needed.
const FIELD_FILES = import.meta.glob(['../../../shared/fields/*.json', '!../../../shared/fields/index.json']);
// The index (id, county, lat, lon for 201 fields, ~14 kB) is bundled so map taps work offline.
const INDEX_FILE = import.meta.glob('../../../shared/fields/index.json', { eager: true, import: 'default' });
const pathFor = (id) => `../../../shared/fields/${id}.json`;

export const crops = cropLibrary;
export const candidateRotations = rotationLibrary.rotations;

// Cover thresholds (same as pipeline/models/season_crop.py).
export const BARE_NDVI = 0.25;
export const GREEN_NDVI = 0.40;

const coverState = (v) => (v == null ? null : v >= GREEN_NDVI ? 'green' : v < BARE_NDVI ? 'bare' : 'residue');

// Monthly NDVI rows -> [{ year, months[12], cloudyMonths }]
const coverFromNdvi = (rows) => {
  const byYear = {};
  for (const n of rows) (byYear[n.year] ||= Array(12).fill(null))[n.month - 1] = coverState(n.ndvi);
  return Object.entries(byYear).map(([year, months]) => ({ year: Number(year), months, cloudyMonths: months.filter((m) => !m).length }));
};

// v1 files (the fake sample) lack the v2/v3 extras. Derive what we can so every screen works the same way.
function withDerived(field) {
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

function fallback(reason) {
  return { ...withDerived(sampleField), fallbackReason: reason };
}

export async function loadFieldById(id) {
  const load = FIELD_FILES[pathFor(id)];
  if (!load) return fallback('missing');
  try {
    const f = (await load()).default;
    if (!f?.field || !Array.isArray(f.climateYearly)) return fallback('broken');
    return withDerived(f);
  } catch {
    return fallback('broken');
  }
}

export const loadDemoField = () => loadFieldById(DEMO_FIELD_ID);

function loadIndex() {
  return INDEX_FILE['../../../shared/fields/index.json']?.fields || [];
}

// Distance in km between two points (haversine).
function km(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2
    + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Tap -> the nearest sampled field. Real per-cell data for every 30 m cell is on the roadmap.
export async function loadFieldAt(lat, lon) {
  const idx = loadIndex();
  if (!idx.length) return fallback('missing');
  let best = idx[0];
  let bestKm = Infinity;
  for (const f of idx) {
    const d = km(lat, lon, f.lat, f.lon);
    if (d < bestKm) { best = f; bestKm = d; }
  }
  const field = await loadFieldById(best.id);
  return field.fallbackReason ? field : { ...field, nearestKm: Math.round(bestKm * 10) / 10 };
}

// Default "current rotation" guess: distinct library crops from the last 4 years, oldest first.
export function guessCurrentRotation(field) {
  const ids = new Set(cropLibrary.crops.map((c) => c.id));
  const recent = field.cropHistory.slice(-4).map((h) => h.crop).filter((c) => ids.has(c));
  return [...new Set(recent)];
}
