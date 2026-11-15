// Report card check 7 (neighbor backtest): does each field's recommended plan ("best balance") use only cash crops that
// neighboring fields on the same soil texture actually grew in the last crop-map years (2020-2025)?
// Pure JS: the caller passes the fields' outputs (recommended cash crops) and the input index rows (location + crops).
import { NEIGHBOR_RADIUS_MILES } from './constants.js';

export const NEIGHBOR_BACKTEST_SHARE = 0.85;   // pass: on at least this share of fields, every recommended cash crop was grown nearby
const MILES_PER_KM = 0.621371;
const hav = (a, b) => {
  const R = 6371, d2r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d2r, dLon = (b.lon - a.lon) * d2r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x)) * MILES_PER_KM;
};

/**
 * @param fields [{ id, lat, lon, texture, crops: [recent crop ids], recommended: [cash crop ids] }]
 * @returns { status, share, fields, matched, byCrop: {crop: {recommended, grownNearby}}, radiusMiles }
 */
export function neighborBacktest(fields, { countIds = null } = {}) {
  const byCrop = {};
  let n = 0, matched = 0;
  for (const f of fields) {
    if (countIds && !countIds.has(f.id)) continue;   // neighbors come from every field; only these are counted
    if (!f.recommended?.length) continue;
    const near = fields.filter((g) => g.id !== f.id && (f.texture == null || g.texture === f.texture) && hav(f, g) <= NEIGHBOR_RADIUS_MILES);
    const grown = new Set(near.flatMap((g) => g.crops));
    n++;
    const ok = f.recommended.every((c) => grown.has(c));
    if (ok) matched++;
    for (const c of f.recommended) {
      const b = (byCrop[c] ??= { recommended: 0, grownNearby: 0 });
      b.recommended++; if (grown.has(c)) b.grownNearby++;
    }
  }
  const share = n ? matched / n : null;
  return { status: !n ? 'not-run' : share >= NEIGHBOR_BACKTEST_SHARE ? 'pass' : 'fail', share: share == null ? null : Math.round(share * 100) / 100, fields: n, matched, byCrop, radiusMiles: NEIGHBOR_RADIUS_MILES, minShare: NEIGHBOR_BACKTEST_SHARE };
}
