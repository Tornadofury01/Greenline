// Builds shared/map-layers.json: the small, bundled map context layers (work offline, no per-field loading).
//   county     Ellis County boundary, simplified (US Census TIGER, public domain, via the TIGERweb REST service)
//   towns      nearby town points (Census incorporated places, internal point), with a size tier for label zoom
//   dallas     a direction marker towards Dallas, placed on the county's north edge
//   studyHull  a padded convex hull around the 300 study field outlines (shared/field-outlines.json)
//   frame      the map's opening view: the study area plus its nearest towns
// Run from the repo root (needs internet once): node pipeline/build_map_layers.mjs
// Run pipeline/build_field_outlines.mjs first. No farmer data is involved: only public boundaries and points.
import { readFileSync, writeFileSync } from 'node:fs';

const TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';
const COUNTY_GEOID = '48139'; // Ellis County, TX
const TOWNS = ['Waxahachie', 'Ennis', 'Midlothian', 'Red Oak', 'Ferris', 'Palmer', 'Bardwell', 'Italy', 'Maypearl'];
const SIMPLIFY_DEG = 0.002;   // ~200 m: plenty for a thin county line
const HULL_PAD_M = 450;       // padding around the fields' convex hull
const FRAME_TOWNS = 3;        // the opening view includes the study area and its 3 nearest towns
// Label tiers by land area (a size proxy that needs no population table): bigger towns show at lower zoom.
const tierFor = (areaKm2) => (areaKm2 >= 50 ? 1 : areaKm2 >= 5 ? 2 : 3);

const r5 = (x) => Math.round(x * 1e5) / 1e5;
const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

// Douglas-Peucker on [lat, lon] points (planar, fine at county scale).
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ay, ax] = pts[a]; const [by, bx] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-12;
    let max = 0; let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][0]) - (ax - pts[i][1]) * (by - ay)) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Convex hull (monotone chain) on [lat, lon] points.
function hull(points) {
  const p = [...points].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const cross = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const lower = []; const upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

// 1. County boundary
const countyFc = await get(`${TIGER}/State_County/MapServer/1/query?where=GEOID%3D%27${COUNTY_GEOID}%27&outFields=NAME&outSR=4326&f=geojson`);
const geom = countyFc.features[0].geometry;
const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
// A closed ring starts and ends on the same point, which Douglas-Peucker can't use as a baseline:
// split it at the point farthest from the start and simplify the two halves.
function simplifyRing(ring, tol) {
  const far = ring.reduce((best, p, i) => (Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]) > Math.hypot(ring[best][0] - ring[0][0], ring[best][1] - ring[0][1]) ? i : best), 0);
  return [...simplify(ring.slice(0, far + 1), tol).slice(0, -1), ...simplify(ring.slice(far), tol)];
}
const county = polys.map((poly) => simplifyRing(poly[0].map(([lon, lat]) => [lat, lon]), SIMPLIFY_DEG).map(([la, lo]) => [r5(la), r5(lo)]));

// 2. Towns (and Dallas, for the direction marker)
const names = [...TOWNS, 'Dallas'].map((n) => `%27${encodeURIComponent(n).replace(/%20/g, '+')}%27`).join(',');
const places = await get(`${TIGER}/Places_CouSub_ConCity_SubMCD/MapServer/4/query?where=STATE%3D%2748%27+AND+BASENAME+IN+(${names})&outFields=BASENAME,GEOID,INTPTLAT,INTPTLON,AREALAND&returnGeometry=false&f=json`);
const byName = Object.fromEntries(places.features.map(({ attributes: a }) => [a.BASENAME, a]));
const towns = TOWNS.map((name) => {
  const a = byName[name];
  if (!a) throw new Error(`town not found: ${name}`);
  return { name, geoid: a.GEOID, lat: r5(Number(a.INTPTLAT)), lon: r5(Number(a.INTPTLON)), tier: tierFor(a.AREALAND / 1e6) };
});

// 3. Study hull, padded
const outlines = JSON.parse(readFileSync(new URL('../shared/field-outlines.json', import.meta.url))).fields;
const pts = outlines.flatMap((f) => f.rings[0]);
const base = hull(pts);
const lat0 = base.reduce((s, p) => s + p[0], 0) / base.length;
const dLat = HULL_PAD_M / 111320;
const dLon = dLat / Math.cos((lat0 * Math.PI) / 180);
const padded = hull(base.flatMap(([la, lo]) => Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * 2 * Math.PI;
  return [la + dLat * Math.sin(a), lo + dLon * Math.cos(a)];
}))).map(([la, lo]) => [r5(la), r5(lo)]);
const center = [r5(pts.reduce((s, p) => s + p[0], 0) / pts.length), r5(pts.reduce((s, p) => s + p[1], 0) / pts.length)];
const top = padded.reduce((a, b) => (b[0] > a[0] ? b : a));

// 4. Opening frame and nearest town
const nearest = [...towns].sort((a, b) => km(center, [a.lat, a.lon]) - km(center, [b.lat, b.lon]));
const frameTowns = nearest.slice(0, FRAME_TOWNS);
const all = [...padded, ...frameTowns.map((t) => [t.lat, t.lon])];
const frame = [[Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1]))], [Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))]];

// 5. Dallas direction marker: on the county's north edge, straight between the study area and Dallas.
const dallas = byName.Dallas;
const north = Math.max(...county.flat().map((p) => p[0]));
const dallasMarker = { lat: r5(north - 0.012), lon: r5(center[1] + (Number(dallas.INTPTLON) - center[1]) * ((north - center[0]) / (Number(dallas.INTPTLAT) - center[0]))), km: Math.round(km(center, [Number(dallas.INTPTLAT), Number(dallas.INTPTLON)])) };

const out = {
  schemaVersion: 1,
  source: 'US Census TIGER (TIGERweb): Ellis County boundary and incorporated places; study hull from USDA field outlines',
  county,
  towns,
  dallas: dallasMarker,
  studyHull: padded,
  studyCenter: center,
  studyLabel: top,
  nearestTown: nearest[0].name,
  frame: frame.map((p) => p.map(r5)),
};
writeFileSync(new URL('../shared/map-layers.json', import.meta.url), JSON.stringify(out));
console.log(`county ${county.map((r) => r.length).join('+')} pts, ${towns.length} towns, hull ${padded.length} pts, nearest town ${out.nearestTown}, Dallas ${dallasMarker.km} km`);
