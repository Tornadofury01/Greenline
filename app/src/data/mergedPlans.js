// Decision view over existing v2 output. No model or precompute changes.
import scoresConfig from '@content/v2-scores.json';
import { pickBestPlans } from '@scoring/v2/analyzeField.js';
import { weightsFor, weightedTotal, gradeOf } from '@scoring/v2/scores.js';
import { buildBestPlans } from './v2Plans.js';
import { buildCardFor, buildOptionCards } from './v2Options.js';

const PRIORITY = { water: 'saveWater', erosion: 'soil', soil: 'soil', income: 'income', lowRisk: 'lowRisk', saveWater: 'saveWater' };
export const mappedPriorities = (goals = []) => [...new Set(goals.map((g) => PRIORITY[g]).filter(Boolean))];

// Cyclic shifts and repeated copies of the same crop cycle are not distinct rotations.
export function rotationKey(option) {
  let years = (option.sequence || []).map((y) => y.crops.map((c) => `${c.crop}:${c.role}`).join('+'));
  for (let n = 1; n <= years.length; n++) {
    if (years.length % n === 0 && years.every((y, i) => y === years[i % n])) { years = years.slice(0, n); break; }
  }
  return years.map((_, i) => [...years.slice(i), ...years.slice(0, i)].join('|')).sort()[0] || '';
}
export const eligibleAlternative = (o, farm = null) => o.limits?.soilMet === true && o.limits?.riskMet === true
  && Object.values(o.fitChecks || {}).every((c) => c.status !== 'fail')
  && !(farm?.waterMode === 'dryland' && o.management?.irrigation && o.management.irrigation !== 'none');

export function supportedReturn(option) {
  const v = option.profit?.returnAboveVariable;
  if (v?.unit !== 'usd/acre/year' || !Number.isFinite(v.typical)) return null;
  const range = Number.isFinite(v.low) && Number.isFinite(v.high) && v.low <= v.typical && v.typical <= v.high;
  return { typical: v.typical, low: range ? v.low : null, high: range ? v.high : null };
}

export function alternativeDistinction(option, best) {
  const a = supportedReturn(option), b = supportedReturn(best);
  if (a && b && a.typical > b.typical + 1) return { label: 'higherReturn', reason: { key: 'rotationPlans.moreReturnReason', params: { usd: a.typical - b.typical } } };
  const aw = option.riskDetail?.worst10Usd, bw = best.riskDetail?.worst10Usd;
  if (Number.isFinite(aw) && Number.isFinite(bw) && aw > bw + 1) return { label: 'badYears', reason: { key: 'rotationPlans.badYearsReason', params: { usd: aw - bw } } };
  const ad = option.soilSaved?.bareDaysPerYear, bd = best.soilSaved?.bareDaysPerYear;
  if (Number.isFinite(ad) && Number.isFinite(bd) && ad < bd - 1) return { label: 'moreCover', reason: { key: 'rotationPlans.moreCoverReason', params: { days: Math.round(bd - ad) } } };
  const as = option.fitChecks?.water?.evidence?.params?.shortYears, bs = best.fitChecks?.water?.evidence?.params?.shortYears;
  if (Number.isFinite(as) && Number.isFinite(bs) && as < bs - .01) return { label: 'lessStress', reason: { key: 'rotationPlans.lessStressReason', params: { points: Math.round((bs - as) * 100) } } };
  return { label: 'alternative', reason: null };
}

export function buildMergedPlans(data, farm = null) {
  const goals = farm ? mappedPriorities(farm.priorities) : data.priorities.selected || [];
  const weights = weightsFor(goals, scoresConfig);
  const options = data.options.filter((o) => eligibleAlternative(o, farm) && rotationKey(o) !== rotationKey(data.current));
  const recommended = options.length ? pickBestPlans(options, data.current, weights, scoresConfig) : null;
  // A precomputed single-priority answer wins ties when it remains eligible.
  const storedId = goals.length === 1 ? data.bestBalanceByPriority?.[goals[0]] : !goals.length ? data.bestPlans.bestBalance.optionId : null;
  const stored = options.find((o) => o.id === storedId);
  if (stored && recommended) recommended.bestBalance.optionId = stored.id;
  const best = options.find((o) => o.id === recommended?.bestBalance.optionId);
  const decorate = (kind, option, card) => {
    const total = weightedTotal(option.scores, weights);
    return { kind, option, card: { ...card, total, grade: gradeOf(total, scoresConfig) }, returns: supportedReturn(option) };
  };
  const current = decorate('current', data.current, buildOptionCards(data).current);
  if (!best) return { best: null, strategies: [current], plans: [], limits: data.bestPlans.limits, priorities: goals, weights };
  const built = buildBestPlans({ ...data, bestPlans: recommended });
  const bestPlan = built.plans.find((p) => p.kind === 'bestBalance');
  const bestStrategy = decorate('best', best, bestPlan.card);
  const candidates = options.filter((o) => rotationKey(o) !== rotationKey(best));
  const named = [recommended.mostProfitable.optionId, recommended.safest.optionId];
  const byRank = (a, b) => weightedTotal(b.scores, weights) - weightedTotal(a.scores, weights) || a.id.localeCompare(b.id);
  const namedOptions = candidates.filter((o) => named.includes(o.id));
  const alt = [...(namedOptions.length ? namedOptions : candidates)].sort(byRank)[0];
  const alternative = alt && { ...decorate('alternative', alt, buildCardFor(data, alt.id)), ...alternativeDistinction(alt, best) };
  return { ...built, best: bestStrategy, bestPlan, priorities: goals, weights,
    alternativeFromOverlap: !!alternative && !namedOptions.length,
    strategies: [current, bestStrategy, ...(alternative ? [alternative] : [])] };
}

export function fitReason(option, priorities = [], current = null) {
  const scores = { water: 'water', saveWater: 'water', erosion: 'soil', soil: 'soil', income: 'profit', lowRisk: 'risk' };
  for (const goal of priorities) {
    const positive = option.scores?.[scores[goal]]?.reasons?.filter((r) => r.tone === 'up') || [];
    const base = current?.scores?.[scores[goal]]?.reasons || [];
    const reason = positive.find((r) => base.find((b) => b.key === r.key)?.tone === 'down') || positive[0];
    if (reason) return { goal, reason };
  }
  const check = ['season', 'water', 'market'].map((k) => option.fitChecks?.[k]).find((c) => c?.status === 'pass');
  return { goal: null, reason: check?.evidence };
}
