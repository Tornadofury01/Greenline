// scoreRotation: one transparent, rule-based scorer used for the CURRENT,
// SUGGESTED and CUSTOM rotations alike.
//
// rotation:    { id?, crops: ['winter_wheat', 'cowpea', ...], equipment?: [...] }
// field:       object following /shared/data-format.md
// priorities:  any subset of PRIORITIES the farmer picked
// constraints: { water: 'dryland'|'irrigated', equipment: [...], budget: 'low'|'medium'|'high', market: ... }
// cropLibrary: the parsed /content/crops.json
//
// options:     { replayYear?: number }  re-run under that past year's real weather (bad-year replay)
//              { whatIf?: { rainPct, heatDays } }  re-run under a pretend year (what-if sliders). Same path as replayYear;
//                                                  if both are given, replayYear wins. replay.hypothetical = true.
//              { economics?: object }  parsed /content/economics.json. Adds `dollars` (display only, never in the score).
//
// Returns { total (0-100), breakdown, reasons, benefits, gaps, risks, tags, confidence, evidence, bareDays, replay, replayTotal, dollars }.
// dollars = estimateDollars() (scoring/economics.js) or null. It is computed after the score and never feeds it.
// bareDays = { bareDays (per year), bareMonths[12], calibrated[] }: see scoring/bareDays.js.
// All text comes back as i18n keys + params, never as English strings.
import { waterRule } from './rules/water.js';
import { erosionRule } from './rules/erosion.js';
import { soilRule } from './rules/soil.js';
import { incomeRule } from './rules/income.js';
import { cattleRule } from './rules/cattle.js';
import { constraintRule } from './rules/constraints.js';
import { confidenceFor } from './confidence.js';
import { reason } from './rules/helpers.js';
import { replayRule, yearHazards, whatIfHazards } from './rules/replay.js';
import { estimateDollars } from './economics.js';
import { estimateBareDays } from './bareDays.js';

export const PRIORITIES = ['water', 'erosion', 'soil', 'income', 'cattle'];
const RULES = { water: waterRule, erosion: erosionRule, soil: soilRule, income: incomeRule, cattle: cattleRule };

// Which datasets back each priority (shown as "Evidence").
// Names match field.sources[].dataset so the app can show each one's resolution and dates.
const EVIDENCE = {
  water: ['NASA POWER', 'GPM IMERG', 'PRISM', 'SMAP L4', 'USDA SSURGO'],
  erosion: ['SRTM', 'USDA SSURGO', 'GPM IMERG', 'Landsat 8/9'],
  soil: ['USDA SSURGO', 'USDA Cropland Data Layer'],
  income: ['USDA Cropland Data Layer', 'NASS Quick Stats'],
  cattle: ['Landsat 5/7/8/9'],
};

const COVER_ESTABLISHED_IN_DROUGHT = 0.5; // drought replay: cover crops count as half established (a dry fall can stop them)
const REPLAY_WEIGHT = 3; // when replaying a year, how it held up counts like a priority the farmer picked, plus one (sets how much a bad year pulls the score down)
const SELECTED_WEIGHT = 2; // the farmer's 1st priority counts double
const OTHER_WEIGHT = 1;
// The farmer ranks their priorities (priorities[0] = most important). Rank r adds (SELECTED_WEIGHT - 1) x RANK_STRENGTH[r]
// on top of OTHER_WEIGHT: 1st x2, 2nd x1.6, 3rd x1.35, 4th x1.2, 5th x1.1. Same strengths as content/v2-scores.json rankStrength.
export const RANK_STRENGTH = [1, 0.6, 0.35, 0.2, 0.1];
export const priorityWeight = (priorities, p) => {
  const r = priorities.indexOf(p);
  return r < 0 ? OTHER_WEIGHT : OTHER_WEIGHT + (SELECTED_WEIGHT - OTHER_WEIGHT) * RANK_STRENGTH[Math.min(r, RANK_STRENGTH.length - 1)];
};

// Pest-cycle break: crops of one plant family share pests and diseases, so a different family between them interrupts the cycle.
// True when the rotation has a grass crop AND a non-grass crop, and no crop is followed (looping back to the start) by one
// of its own family. Fallow and cover crops are skipped: they are terminated early, so they count neither as hosts nor as breaks.
export function breaksPestCycle(crops) {
  const fam = crops.filter((c) => c.id !== 'fallow' && !c.coverCrop).map((c) => c.family);
  if (fam.length < 2 || !fam.includes('grass') || fam.every((f) => f === 'grass')) return false;
  return fam.every((f, i) => f !== fam[(i + 1) % fam.length]);
}

export function scoreRotation(rotation, field, priorities = [], constraints = {}, cropLibrary, options = {}) {
  const byId = Object.fromEntries(cropLibrary.crops.map((c) => [c.id, c]));
  const crops = rotation.crops.map((id) => byId[id]).filter(Boolean);
  if (!crops.length) throw new Error('scoreRotation: rotation has no known crops');

  // 0. Days the soil sits bare under this rotation (feeds the erosion rule and is shown on the card).
  const bareDays = estimateBareDays(crops, field);

  // 1. Run each priority rule.
  const breakdown = {};
  let weighted = 0;
  let weights = 0;
  const raw = {}; // unrounded rule scores
  for (const p of PRIORITIES) {
    const result = RULES[p](crops, field, constraints, { bareDays });
    const weight = priorityWeight(priorities, p);
    raw[p] = result.score;
    breakdown[p] = { score: Math.round(result.score * 10) / 10, weight, selected: priorities.includes(p), rank: priorities.includes(p) ? priorities.indexOf(p) + 1 : null, reasons: result.reasons };
    weighted += result.score * weight;
    weights += weight;
  }

  // 2. Apply constraint penalties.
  const { penalty, gaps, risks } = constraintRule(rotation, crops, constraints);
  const total = Math.max(0, Math.min(100, Math.round((weighted / weights) * 10 - penalty)));

  // 3. Benefits = strong priorities; gaps = weak priorities the farmer picked.
  const benefits = PRIORITIES.filter((p) => breakdown[p].score >= 7).map((p) => reason(`benefits.${p}`));
  for (const p of priorities) if (breakdown[p]?.score < 4) gaps.push(reason('gaps.weak', { priority: p }));

  // 4. Risks from the field's climate history.
  // Hot or drought years in at least 20% of this field's record (k-means year types on real data).
  const nYears = field.climateYearly.length;
  const hotYears = field.climateYearly.filter((y) => y.yearType === 'heat' || y.yearType === 'drought').length;
  const heatSensitive = crops.filter((c) => c.heatTolerance <= 2 && c.season === 'warm');
  if (heatSensitive.length && hotYears >= Math.max(4, 0.2 * nYears)) {
    risks.push(reason('risks.heat', { crops: [...new Set(heatSensitive.map((c) => c.id))], count: hotYears, total: nYears },
      ['NASA POWER', 'Greenline SI models']));
  }
  // Contract-only or regionally uncommon crops (e.g. sesame in the Blackland Prairie, per AgriLife).
  const contract = crops.filter((c) => c.contractOnly || c.regionalFit === 'uncommon');
  if (contract.length) risks.push(reason('risks.contractCrop', { crops: [...new Set(contract.map((c) => c.id))] }, ['Texas A&M AgriLife']));
  // Cover crops killed late can use up the soil water the next crop needs (SARE, cereal rye).
  const lateKill = crops.filter((c) => c.lateKillRisk);
  if (lateKill.length) risks.push(reason('risks.lateKill', { crops: [...new Set(lateKill.map((c) => c.id))] }, ['SARE']));
  if (crops.some((c) => c.id === 'fallow')) risks.push(reason('risks.bare', {}, ['Landsat 8/9']));
  // The bare-day estimate assumes cover crops come up. They may not in a dry fall.
  const covers = crops.filter((c) => c.coverCrop);
  if (covers.length) risks.push(reason('risks.coverEstablish', { crops: [...new Set(covers.map((c) => c.id))] }, ['SARE']));
  // Bare-day numbers use Landsat 8/9 only, 2014 on: Landsat 7 reads NDVI ~0.05 lower (pipeline/MODELS.md #14).
  if (field.coverYearly) gaps.push(reason('gaps.sensorChange', {}, ['Landsat 8/9']));
  // CDL can mislabel crops, which affects crop history and the crop model. Shown as a gap so it isn't hidden.
  if (field.si) gaps.push(reason('gaps.cdlNoise', {}, ['USDA Cropland Data Layer']));

  // 5. Soil-health tags for the card.
  const tags = [];
  if (crops.some((c) => c.nitrogenFixing)) tags.push('nitrogen');
  if (crops.some((c) => c.coverCrop)) tags.push('cover');
  if (crops.filter((c) => c.rootDepth === 'deep').length >= 2) tags.push('deepRoots');
  if (new Set(crops.map((c) => c.id)).size >= 3) tags.push('diverse');
  // Drought-tolerant: every crop actually grown has low drought sensitivity in crops.json (FAO water-shortage class).
  const grown = crops.filter((c) => c.id !== 'fallow');
  if (grown.length && grown.every((c) => c.droughtSensitivity <= 2)) tags.push('droughtTolerant');
  if (breaksPestCycle(crops)) tags.push('pestBreak');

  // 6. "Why" = reasons from the farmer's priorities (or all, if none picked).
  const focus = priorities.length ? priorities : PRIORITIES;
  const reasons = focus.flatMap((p) => breakdown[p]?.reasons || []);
  // Field evidence: Texas Tech (Southern SARE GS15-152) found rye yielded steadily in a dry West Texas year
  // without reducing soil water for the next summer crop.
  if (crops.some((c) => c.dryYearEvidence)) reasons.push(reason('reasons.ryeDryYear', {}, ['Southern SARE / Texas Tech']));
  const evidence = [...new Set(focus.flatMap((p) => EVIDENCE[p] || []))];

  // 7. Bad-year replay or what-if (only when asked): same rules, blended with how the crops hold up in that year.
  //    A what-if is a pretend year built from the field's averages; it goes through exactly the same path.
  let replay = null;
  let replayTotal = null;
  const hazards = options.replayYear != null ? yearHazards(field, options.replayYear)
    : options.whatIf ? whatIfHazards(field, options.whatIf) : null;
  if (hazards) {
    replay = replayRule(crops, field, hazards);
    if (replay) {
      // Drought years only: cover crops count as partly established, so the replay doesn't oversell them.
      replay.bareDays = bareDays;
      replay.coverPartial = false;
      let weightedR = weighted;
      if (replay.yearType === 'drought' && covers.length) {
        replay.bareDays = estimateBareDays(crops, field, { coverEstablished: COVER_ESTABLISHED_IN_DROUGHT });
        replay.coverPartial = true;
        const eroR = erosionRule(crops, field, constraints, { bareDays: replay.bareDays }).score;
        weightedR += (eroR - raw.erosion) * breakdown.erosion.weight;
        replay.reasons.push(reason('replay.coverPartial', { crops: [...new Set(covers.map((c) => c.id))] }));
      }
      // The scenario can only pull the normal score down: we subtract how far the blend falls below the same blend
      // in a stress-free year (replay score 10). A what-if at 0 % rain / 0 extra hot days equals the normal total.
      // (Blending the 0-10 replay score in directly let a weak rotation score HIGHER in a drought than normally.)
      const blend = (w, s) => (w + s * REPLAY_WEIGHT) / (weights + REPLAY_WEIGHT);
      const drop = blend(weighted, 10) - blend(weightedR, replay.score);
      replayTotal = Math.max(0, Math.min(100, Math.round((weighted / weights - drop) * 10 - penalty)));
    }
  }

  return {
    rotationId: rotation.id,
    crops: rotation.crops,
    total, breakdown, reasons, benefits, gaps, risks, tags, evidence, bareDays, replay, replayTotal,
    confidence: confidenceFor(crops, field, cropLibrary.verified, bareDays),
    // 8. Dollars: display only, after the score is final.
    dollars: options.economics ? estimateDollars(crops, field, options.economics) : null,
  };
}

// Score all candidates and return the best N that differ from the current rotation.
export function suggestRotations(candidates, current, field, priorities, constraints, cropLibrary, n = 2, options = {}) {
  const key = (crops) => [...crops].sort().join(',');
  const currentKey = key(current.crops);
  return candidates
    .filter((r) => key(r.crops) !== currentKey)
    .map((r) => scoreRotation(r, field, priorities, constraints, cropLibrary, options))
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}
