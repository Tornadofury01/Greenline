// Address and town search for the map.
//
// Towns: matched against the bundled town labels (shared/map-layers.json), so this works offline.
// Addresses and roads: the free US Census Geocoder (geocoding.geo.census.gov, "onelineaddress", no key), only when online.
// The service sends no CORS headers but supports JSONP, so the lookup is a one-off <script> request.
//
// Privacy (same rule as GPS): the typed text and the coordinates that come back are used only to move the map and find
// the nearest study field. They are never put in saved state, localStorage, the page URL or logs. The only place the
// text goes is the Census lookup itself, which the farmer asked for by searching.
import { mapLayers } from './loadField.js';

const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const TIMEOUT_MS = 10000;
const MAX_MATCHES = 3;

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Towns whose name starts with (then contains) the text. [{ kind: 'town', label, lat, lon }]
export function matchTowns(text) {
  const q = fold(text);
  if (q.length < 2) return [];
  const starts = mapLayers.towns.filter((t) => fold(t.name).startsWith(q));
  const contains = mapLayers.towns.filter((t) => !starts.includes(t) && fold(t.name).includes(q));
  return [...starts, ...contains].slice(0, MAX_MATCHES).map((t) => ({ kind: 'town', label: t.name, lat: t.lat, lon: t.lon }));
}

// Add ", TX" when the text doesn't already end with a state (two letters or a state name we expect here).
const STATE_AT_END = /(,|\s)\s*(tx|texas|ok|oklahoma|[a-z]{2})\s*(\d{5}(-\d{4})?)?\s*$/i;
export const withState = (text) => (STATE_AT_END.test(text.trim()) ? text.trim() : `${text.trim()}, TX`);

let seq = 0;
// Census lookup. Resolves to up to 3 matches [{ kind: 'address', label, lat, lon }]; rejects on network error / timeout.
export function geocodeAddress(text) {
  return new Promise((resolve, reject) => {
    const cb = `__greenlineGeo${Date.now()}${seq++}`;
    const script = document.createElement('script');
    let timer;
    const done = () => {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    };
    window[cb] = (data) => {
      done();
      const matches = data?.result?.addressMatches || [];
      resolve(matches.slice(0, MAX_MATCHES).map((m) => ({
        kind: 'address', label: m.matchedAddress, lat: m.coordinates.y, lon: m.coordinates.x,
      })));
    };
    script.onerror = () => { done(); reject(new Error('network')); };
    timer = setTimeout(() => { done(); reject(new Error('timeout')); }, TIMEOUT_MS);
    const params = new URLSearchParams({ address: withState(text), benchmark: 'Public_AR_Current', format: 'jsonp', callback: cb });
    script.src = `${CENSUS}?${params}`;
    script.referrerPolicy = 'no-referrer';
    document.head.appendChild(script);
  });
}

// The bundled town nearest a point (for "near Bardwell").
export function nearestTownTo(lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const t of mapLayers.towns) {
    const d = (t.lat - lat) ** 2 + ((t.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) { best = t; bestD = d; }
  }
  return best?.name ?? mapLayers.nearestTown;
}
