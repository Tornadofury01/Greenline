// Pest and disease risk counters. Weather risk builds up on the days a host crop is in the field; a carry-over "pressure" (0-1)
// persists between seasons and is pushed up by host crops and down by crops that break the cycle (rotation, green bridges).
// Season loss = sum over pests the crop hosts of maxLoss x pressure x seasonal risk index (capped).
//
// The rules are deliberately simple weather proxies, each with a plain-words condition. They are modelling estimates to confirm with
// an AgriLife extension agent (the plan says "which pests the county actually has" is a local check).
import { PEST_PRESSURE_START, PEST_PRESSURE_HOST_GAIN, PEST_PRESSURE_BREAK_MULT, PEST_PRESSURE_OTHER_MULT, PEST_LOSS_CAP } from './constants.js';

// favorable(ctx) -> 0..1 weight for the day. scale = counter value that means "full seasonal risk".
export const PEST_TABLE = {
  'cereal-rust':          { maxLoss: 0.15, scale: 20, favorable: (c) => (c.tmean >= 10 && c.tmean <= 22 && c.rain >= 1 ? 1 : 0) },                    // cool and wet leaves
  'grass-foliar-disease': { maxLoss: 0.12, scale: 25, favorable: (c) => (c.tmean >= 22 && c.tmean <= 32 && c.rain >= 2 ? 1 : 0) },                    // warm and humid
  'cotton-root-rot':      { maxLoss: 0.35, scale: 60, favorable: (c) => (c.tmax >= 28 && c.topWetness >= 0.5 ? 1 : 0) },                              // hot soil that stays moist (Blackland clays)
  'root-knot-nematode':   { maxLoss: 0.12, scale: 90, favorable: (c) => (c.tmean >= 20 ? (c.clayPct > 35 ? 0.6 : 1) : 0) },                            // warm soil; heavy clay slows it
  'charcoal-rot':         { maxLoss: 0.15, scale: 30, favorable: (c) => (c.tmax >= 34 && c.ks < 0.8 ? 1 : 0) },                                      // hot and water-stressed
  'sugarcane-aphid':      { maxLoss: 0.20, scale: 50, favorable: (c) => (c.tmin >= 15 && c.tmax <= 35 && c.rain < 5 ? 1 : 0) },                       // warm nights, no washing rain
};
export const PEST_IDS = Object.keys(PEST_TABLE);

export function makePests() {
  const p = {};
  for (const id of PEST_IDS) p[id] = { counter: 0, pressure: PEST_PRESSURE_START };
  return p;
}

/** Add one day of weather risk for every pest the active crop hosts. ctx = { tmin, tmax, tmean, rain, topWetness, ks, clayPct } */
export function pestDaily(pests, def, ctx) {
  for (const id of def.pests?.hosts ?? []) {
    const t = PEST_TABLE[id];
    if (t) pests[id].counter += t.favorable(ctx);
  }
}

/** Seasonal risk index 0-1 for the pests the crop hosts (for the daily record). */
export function pestRiskNow(pests, def) {
  const out = {};
  for (const id of def.pests?.hosts ?? []) if (PEST_TABLE[id]) out[id] = Math.min(1, pests[id].counter / PEST_TABLE[id].scale);
  return out;
}

/** Close a season: returns { loss, byPest } and updates carry-over pressure for every pest. */
export function pestSeasonEnd(pests, def) {
  const byPest = {};
  let loss = 0;
  const hosts = new Set(def.pests?.hosts ?? []), breaks = new Set(def.pests?.breaks ?? []);
  for (const id of PEST_IDS) {
    const t = PEST_TABLE[id], p = pests[id];
    if (hosts.has(id)) {
      const l = t.maxLoss * p.pressure * Math.min(1, p.counter / t.scale);
      byPest[id] = l; loss += l;
      p.pressure += (1 - p.pressure) * PEST_PRESSURE_HOST_GAIN;
    } else if (breaks.has(id)) p.pressure *= PEST_PRESSURE_BREAK_MULT;
    else p.pressure *= PEST_PRESSURE_OTHER_MULT;
    p.counter = 0;
  }
  return { loss: Math.min(PEST_LOSS_CAP, loss), byPest };
}
