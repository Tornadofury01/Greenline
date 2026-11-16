// The Rotations page's data: every rotation the engine scored for this field, ranked by the FARMER'S priorities.
// Pure, no React. Reuses Nikki's merge rules (data/mergedPlans.js): priorities map to score weights the same way, cyclic
// copies of one crop cycle count once, and a rotation that fails a fit check or the soil / risk limits is never in the
// top 3 (it stays in the full list, flagged). Score names, weights and grades come only from content/v2-scores.json.
import scoresConfig from '@content/v2-scores.json';
import { weightsFor, weightedTotal } from '@scoring/v2/scores.js';
import { buildOptionCards } from './v2Options.js';
import { mappedPriorities, rotationKey, eligibleAlternative, supportedReturn } from './mergedPlans.js';

export const TOP_COUNT = 3;

/**
 * data: the v2 field file (loadV2). priorities: the farmer's choices (AppContext farm.priorities: water, erosion, soil,
 * income, cattle). farm: the farm answers (for the dryland rule in eligibleAlternative).
 * Returns { goals, weights, current, top: [entry x<=3], all: [entry], removed: [{ id, crops, covers, failed }] }
 * entry = { option, card, rank, eligible, returns } with card.total / grade / deltaTotal re-weighted for these priorities.
 */
export function buildRotations(data, priorities = [], farm = null) {
  const goals = mappedPriorities(priorities);
  const weights = weightsFor(goals, scoresConfig);
  const reweighted = (o) => ({ ...o, weightedTotal: weightedTotal(o.scores, weights) });
  const currentKey = rotationKey(data.current);
  // One entry per distinct crop cycle (the first, i.e. best scored, copy wins), today's rotation left out.
  const seen = new Set([currentKey]);
  const distinct = [...data.options].map(reweighted).sort((a, b) => b.weightedTotal - a.weightedTotal || a.id.localeCompare(b.id))
    .filter((o) => { const k = rotationKey(o); if (seen.has(k)) return false; seen.add(k); return true; });
  const view = { ...data, priorities: { ...data.priorities, weights, selected: goals }, current: reweighted(data.current), options: distinct };
  const cards = buildOptionCards(view, Infinity);
  const byId = new Map(cards.options.map((c) => [c.id, c]));
  const all = distinct.map((option, i) => ({
    option, card: { ...byId.get(option.id), best: false }, rank: i + 1,
    eligible: eligibleAlternative(option, farm), returns: supportedReturn(option),
  }));
  const top = all.filter((e) => e.eligible).slice(0, TOP_COUNT);
  // "Best match" only when the top rotation beats what is grown now for these priorities.
  if (top[0] && top[0].card.total > cards.current.total) top[0].card.best = true;
  const removed = (data.removedOptions || []).map((r, i) => ({
    id: `removed-${i}`, crops: r.name?.params?.cashAll ?? r.name?.params?.crops ?? [], covers: r.name?.params?.covers ?? [], failed: r.failed ?? [],
  }));
  return { goals, weights, current: { option: data.current, card: cards.current, returns: supportedReturn(data.current) }, top, all, removed };
}

// The crops a rotation grows (cash and cover), for filters.
export const cropsOf = (option) => [...new Set((option.sequence || []).flatMap((y) => y.crops.map((c) => c.crop)))];
