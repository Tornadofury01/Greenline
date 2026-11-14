// scoreRotation: one transparent, rule-based scorer used for the CURRENT,
// SUGGESTED and CUSTOM rotations alike.
//
// rotation:    { id?, crops: ['winter_wheat', 'cowpea', ...], equipment?: [...] }
// field:       object following /shared/data-format.md
// priorities:  any subset of PRIORITIES the farmer picked
// constraints: { water: 'dryland'|'irrigated', equipment: [...], budget: 'low'|'medium'|'high', market: ... }
// cropLibrary: the parsed /content/crops.json
//
// Returns { total (0-100), breakdown, reasons, benefits, gaps, risks, tags, confidence, evidence }.
// All text comes back as i18n keys + params, never as English strings.
import { waterRule } from './rules/water.js';
import { erosionRule } from './rules/erosion.js';
import { soilRule } from './rules/soil.js';
import { incomeRule } from './rules/income.js';
import { cattleRule } from './rules/cattle.js';
import { constraintRule } from './rules/constraints.js';
import { confidenceFor } from './confidence.js';
import { reason } from './rules/helpers.js';

export const PRIORITIES = ['water', 'erosion', 'soil', 'income', 'cattle'];
const RULES = { water: waterRule, erosion: erosionRule, soil: soilRule, income: incomeRule, cattle: cattleRule };

// Which datasets back each priority (shown as "Evidence").
const EVIDENCE = {
  water: ['NASA POWER', 'GPM IMERG', 'SMAP L4'],
  erosion: ['SRTM', 'GPM IMERG', 'Landsat 8/9 (HLS)'],
  soil: ['USDA SSURGO', 'USDA Cropland Data Layer'],
  income: ['USDA Cropland Data Layer'],
  cattle: ['Landsat 8/9 (HLS)'],
};

const SELECTED_WEIGHT = 2; // priorities the farmer picked count double
const OTHER_WEIGHT = 1;

export function scoreRotation(rotation, field, priorities = [], constraints = {}, cropLibrary) {
  const byId = Object.fromEntries(cropLibrary.crops.map((c) => [c.id, c]));
  const crops = rotation.crops.map((id) => byId[id]).filter(Boolean);
  if (!crops.length) throw new Error('scoreRotation: rotation has no known crops');

  // 1. Run each priority rule.
  const breakdown = {};
  let weighted = 0;
  let weights = 0;
  for (const p of PRIORITIES) {
    const result = RULES[p](crops, field, constraints);
    const weight = priorities.includes(p) ? SELECTED_WEIGHT : OTHER_WEIGHT;
    breakdown[p] = { score: Math.round(result.score * 10) / 10, weight, selected: weight === SELECTED_WEIGHT, reasons: result.reasons };
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
  const hotYears = field.climateYearly.filter((y) => y.yearType === 'heat' || y.yearType === 'drought').length;
  const heatSensitive = crops.filter((c) => c.heatTolerance <= 2 && c.season === 'warm');
  if (heatSensitive.length && hotYears >= 4) risks.push(reason('risks.heat', { crops: [...new Set(heatSensitive.map((c) => c.id))], count: hotYears }));
  if (crops.some((c) => c.id === 'fallow')) risks.push(reason('risks.bare'));

  // 5. Soil-health tags for the card.
  const tags = [];
  if (crops.some((c) => c.nitrogenFixing)) tags.push('nitrogen');
  if (crops.some((c) => c.coverCrop)) tags.push('cover');
  if (crops.filter((c) => c.rootDepth === 'deep').length >= 2) tags.push('deepRoots');
  if (new Set(crops.map((c) => c.id)).size >= 3) tags.push('diverse');

  // 6. "Why" = reasons from the farmer's priorities (or all, if none picked).
  const focus = priorities.length ? priorities : PRIORITIES;
  const reasons = focus.flatMap((p) => breakdown[p]?.reasons || []);
  const evidence = [...new Set(focus.flatMap((p) => EVIDENCE[p] || []))];

  return {
    rotationId: rotation.id,
    crops: rotation.crops,
    total, breakdown, reasons, benefits, gaps, risks, tags, evidence,
    confidence: confidenceFor(crops, field, cropLibrary.verified),
  };
}

// Score all candidates and return the best N that differ from the current rotation.
export function suggestRotations(candidates, current, field, priorities, constraints, cropLibrary, n = 2) {
  const key = (crops) => [...crops].sort().join(',');
  const currentKey = key(current.crops);
  return candidates
    .filter((r) => key(r.crops) !== currentKey)
    .map((r) => scoreRotation(r, field, priorities, constraints, cropLibrary))
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}
