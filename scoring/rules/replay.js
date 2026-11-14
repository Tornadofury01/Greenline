// BAD-YEAR REPLAY: how would this rotation's crops have held up in a real past year?
// This is NOT a yield forecast. It is a transparent stress-exposure rule:
//   1. Measure how far that year's real weather was from THIS field's own average (drought, heat, wet).
//   2. Each crop has an exposure to each hazard, from its traits in crops.json.
//   3. crop stress = sum of exposure x severity (capped at 1). Rotation score = 10 x (1 - average stress).
// We use the real numbers for that year, not only the year-type label, so a hot drought counts twice.
import { avg, clamp, reason } from './helpers.js';
import { waterNeed } from './helpers.js';

export const REPLAY_HOLDS = 7;     // score >= 7: holds up
export const REPLAY_STRAINED = 4.5; // score >= 4.5: under strain; below that: struggles

const mean = (rows, key) => avg(rows.map((y) => y[key]).filter((x) => x != null));

// How far the year was from this field's normal, as 0-1 severities plus the raw numbers for the reasons.
export function yearHazards(field, year) {
  const rows = field.climateYearly;
  const row = rows.find((y) => y.year === year);
  if (!row) return null;
  const avgRain = mean(rows, 'precipMm');
  const avgHeat = mean(rows, 'heatStressDays');
  const avgStorms = mean(rows, 'heavyStormDays');
  const rainPct = avgRain ? (row.precipMm - avgRain) / avgRain : 0;
  const heatExtra = row.heatStressDays - avgHeat;
  const sm = row.soilMoistureAnomaly; // null before 2015
  const stormsExtra = row.heavyStormDays != null ? row.heavyStormDays - avgStorms : null;
  return {
    row, rainPct, heatExtra, sm, stormsExtra, avgHeat, avgStorms,
    drought: clamp(Math.max(-rainPct / 0.3, sm != null ? -sm / 0.3 : 0), 0, 1),
    heat: clamp(heatExtra / 30, 0, 1),
    wet: clamp(Math.max(rainPct / 0.3, stormsExtra != null ? stormsExtra / Math.max(3, avgStorms) : 0), 0, 1),
  };
}

// How exposed one crop is to each hazard (0-1), from crops.json traits.
export function cropExposure(c) {
  if (c.id === 'fallow') return { drought: 0, heat: 0, wet: 1 }; // nothing to lose to drought, nothing holds the soil in a storm
  const warm = c.season === 'warm';
  return {
    drought: (c.droughtSensitivity / 5) * 0.6 + (waterNeed(c) / 5) * 0.4,
    heat: warm ? (5 - c.heatTolerance) / 4 : 0.25, // cool-season crops are mostly done before peak heat
    wet: (5 - c.erosionProtection) / 5,
  };
}

const ids = (cs) => [...new Set(cs.map((c) => c.id))];

export function replayRule(crops, field, year) {
  const h = yearHazards(field, year);
  if (!h) return null;
  const stress = crops.map((c) => {
    const e = cropExposure(c);
    return { c, e, s: clamp(e.drought * h.drought + e.heat * h.heat + e.wet * h.wet, 0, 1) };
  });
  const score = clamp((1 - avg(stress.map((x) => x.s))) * 10);
  const verdict = score >= REPLAY_HOLDS ? 'holds' : score >= REPLAY_STRAINED ? 'strained' : 'struggles';

  const p = { year };
  const reasons = [];
  // What the weather did that year (real numbers, with their datasets).
  if (h.drought >= 0.25) {
    reasons.push(reason('replay.dry', { ...p, pct: Math.round(Math.abs(h.rainPct) * 100) }, ['NASA POWER']));
    if (h.sm != null) reasons.push(reason('replay.drySoil', { ...p, pct: Math.round(Math.abs(h.sm) * 100) }, ['SMAP L4']));
  }
  if (h.heat >= 0.25) reasons.push(reason('replay.hot', { ...p, days: h.row.heatStressDays, avg: Math.round(h.avgHeat) }, ['NASA POWER']));
  if (h.wet >= 0.25) {
    reasons.push(reason('replay.wetYear', { ...p, pct: Math.round(Math.abs(h.rainPct) * 100) }, ['NASA POWER']));
  }
  if (!reasons.length) reasons.push(reason('replay.mild', p, ['NASA POWER']));

  // Which crops took the hit for each hazard, and which carried the rotation.
  const hit = (key, min = 0.5) => ids(stress.filter((x) => x.e[key] >= min && h[key] >= 0.25).map((x) => x.c));
  const dry = hit('drought');
  const hot = hit('heat');
  const wetHit = hit('wet', 0.6);
  if (dry.length) reasons.push(reason('replay.cropsDry', { crops: dry }));
  if (hot.length) reasons.push(reason('replay.cropsHeat', { crops: hot }));
  if (wetHit.length) reasons.push(reason('replay.cropsWet', { crops: wetHit }));
  const sturdy = ids(stress.filter((x) => x.s <= 0.25).map((x) => x.c));
  if (sturdy.length && sturdy.length < ids(crops).length) reasons.push(reason('replay.cropsHold', { crops: sturdy }));
  return { score, verdict, reasons, year, yearType: h.row.yearType };
}
