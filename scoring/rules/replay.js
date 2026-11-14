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

// Field averages the hazards are measured against.
function fieldNormals(field) {
  const rows = field.climateYearly;
  return { avgRain: mean(rows, 'precipMm'), avgHeat: mean(rows, 'heatStressDays'), avgStorms: mean(rows, 'heavyStormDays') };
}

// How far one weather row was from this field's normal, as 0-1 severities plus the raw numbers for the reasons.
// The row can be a real year (bad-year replay) or a pretend one (what-if sliders): the same math scores both.
export function hazardsFromRow(field, row) {
  const { avgRain, avgHeat, avgStorms } = fieldNormals(field);
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

// A real past year from the field's record.
export function yearHazards(field, year) {
  const row = field.climateYearly.find((y) => y.year === year);
  return row ? hazardsFromRow(field, row) : null;
}

export const DROUGHT_LIKE = 0.5; // a pretend year this dry counts as a drought year (cover crops half established)

// WHAT-IF: a pretend year built from this field's own averages. Hypothetical, not a forecast.
//   rainPct  -0.5 .. +0.5: rain x (1 + rainPct). Heavy-storm days scale with rain.
//   heatDays 0 .. 40: extra days at 95 °F or hotter, added straight to the field's average (no °F conversion).
//   SMAP soil moisture is left out (null), so drought comes from rain alone.
export function whatIfHazards(field, { rainPct = 0, heatDays = 0 } = {}) {
  const { avgRain, avgHeat, avgStorms } = fieldNormals(field);
  const row = {
    year: null,
    precipMm: avgRain * (1 + rainPct),
    heatStressDays: avgHeat + heatDays,
    heavyStormDays: Number.isFinite(avgStorms) && avgStorms > 0 ? avgStorms * (1 + rainPct) : null,
    soilMoistureAnomaly: null,
  };
  const h = hazardsFromRow(field, row);
  row.yearType = h.drought >= DROUGHT_LIKE ? 'drought' : null;
  return { ...h, hypothetical: true, rainPctInput: rainPct, heatDaysInput: heatDays };
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

// hazards: from yearHazards (a real year) or whatIfHazards (pretend). What-if reasons use whatIf.* text keys.
export function replayRule(crops, field, hazards) {
  const h = hazards;
  if (!h) return null;
  const stress = crops.map((c) => {
    const e = cropExposure(c);
    return { c, e, s: clamp(e.drought * h.drought + e.heat * h.heat + e.wet * h.wet, 0, 1) };
  });
  const score = clamp((1 - avg(stress.map((x) => x.s))) * 10);
  const verdict = score >= REPLAY_HOLDS ? 'holds' : score >= REPLAY_STRAINED ? 'strained' : 'struggles';

  const reasons = [];
  if (h.hypothetical) {
    // What the pretend year looks like, in the slider's own terms.
    const pct = Math.round(Math.abs(h.rainPctInput) * 100);
    if (h.rainPctInput < 0) reasons.push(reason('whatIf.drier', { pct }, ['NASA POWER']));
    if (h.rainPctInput > 0) reasons.push(reason('whatIf.wetter', { pct }, ['NASA POWER', 'GPM IMERG']));
    if (h.heatDaysInput > 0) {
      reasons.push(reason('whatIf.hotter', { extra: h.heatDaysInput, days: Math.round(h.row.heatStressDays), avg: Math.round(h.avgHeat) }, ['NASA POWER']));
    }
    if (!reasons.length) reasons.push(reason('whatIf.normal', {}, ['NASA POWER']));
  } else {
    const p = { year: h.row.year };
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
  }

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
  return { score, verdict, reasons, year: h.row.year, yearType: h.row.yearType, hypothetical: !!h.hypothetical };
}
