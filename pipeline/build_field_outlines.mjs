// Builds shared/field-outlines.json: the 300 Ellis County study field outlines for the app's map.
// Source: pipeline/fieldshift/data/fields.geojson (USDA NASS Crop Sequence Boundaries, public data).
// Run from the repo root: node pipeline/build_field_outlines.mjs
// Points are rounded to 5 decimals (~1 m). These are public USDA outlines, never a farmer's position.
import { readFileSync, writeFileSync } from 'node:fs';

const src = JSON.parse(readFileSync(new URL('./fieldshift/data/fields.geojson', import.meta.url)));
const r5 = (x) => Math.round(x * 1e5) / 1e5;
const fields = src.features.map((f) => {
  if (f.geometry.type !== 'Polygon') throw new Error(`field ${f.properties.field_id}: expected a Polygon`);
  return {
    id: `ec-${String(f.properties.field_id).padStart(3, '0')}`,
    acres: Math.round(f.properties.acres * 10) / 10,
    // Leaflet order: [lat, lon]. First ring is the outline; any others are holes.
    rings: f.geometry.coordinates.map((ring) => ring.map(([lon, lat]) => [r5(lat), r5(lon)])),
  };
}).sort((a, b) => a.id.localeCompare(b.id));

const out = { schemaVersion: 1, source: 'USDA NASS Crop Sequence Boundaries', fields };
writeFileSync(new URL('../shared/field-outlines.json', import.meta.url), JSON.stringify(out));
console.log(`wrote ${fields.length} outlines, ${fields.reduce((n, f) => n + f.rings.reduce((m, r) => m + r.length, 0), 0)} points`);
