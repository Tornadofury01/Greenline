// The six scores (Profit, Risk, Soil, Water, Nutrients, Pests; decided by the team on Nov 14 2026), each 0-100, higher is better,
// and the weighted total. Names, weights, priority boosts and grade cut-offs come ONLY from content/v2-scores.json; the maps from a
// measurement to 0-100 are the named constants in constants.js. Reasons carry i18n keys and params, never English text.
import {
  PROFIT_SCORE_ZERO_USD, PROFIT_SCORE_FULL_USD, RISK_SCALE_USD, SOIL_EROSION_FULL_T_SHARE, SOIL_EROSION_ZERO_T_SHARE, SOIL_BARE_FULL_DAYS,
  SOIL_BARE_ZERO_DAYS, SOIL_SOM_FULL_PCT_DECADE, SOIL_SOM_ZERO_PCT_DECADE, SOIL_WEIGHTS, WATER_PLANT_SHARE_ZERO, WATER_PLANT_SHARE_FULL,
  WATER_SUPPLY_ZERO, WATER_SUPPLY_FULL, NUTRIENT_BOUGHT_FULL_LB, NUTRIENT_BOUGHT_ZERO_LB, NUTRIENT_BALANCE_ZERO_LB, NUTRIENT_WEIGHTS,
  PEST_LOSS_ZERO, PEST_FAMILY_REPEAT_PENALTY, PEST_BRIDGE_PENALTY, REASON_MIN_DELTA,
} from './constants.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lin = (x, zero, full) => 100 * clamp01((x - zero) / (full - zero)); // 0 at `zero`, 100 at `full` (either direction)
const rnd = (x, d = 0) => { const m = 10 ** d; return Math.round(x * m) / m; };
const toneOf = (sub) => (sub >= 50 + REASON_MIN_DELTA ? 'up' : sub <= 50 - REASON_MIN_DELTA ? 'down' : 'note');

/**
 * Weights for the farmer's priorities, IN RANK ORDER (selected[0] = most important). A priority at rank r multiplies the
 * weights of the scores it lists by boost ** strength(r) (cfg.rankStrength.values: rank 1 = the full boost, later ranks less),
 * then the weights are re-scaled to add up to 1. One priority, or none, gives the same weights as before ranking existed.
 */
export const rankStrength = (rank, cfg) => {
  const v = cfg.rankStrength?.values ?? [1];
  return v[Math.min(rank, v.length - 1)] ?? 1;
};
export function weightsFor(selected, cfg) {
  const w = Object.fromEntries(cfg.scores.map((s) => [s.id, s.weight]));
  (selected ?? []).forEach((p, rank) => {
    const boost = cfg.priorities?.[p]?.boost;
    const k = rankStrength(rank, cfg);
    if (boost) for (const [id, m] of Object.entries(boost)) if (id in w) w[id] *= m ** k;
  });
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(w).map(([id, v]) => [id, Math.round((v / sum) * 10000) / 10000]));
}

export function weightedTotal(scores, weights) {
  let t = 0, ws = 0;
  for (const [id, w] of Object.entries(weights)) { t += (scores[id]?.value ?? 0) * w; ws += w; }
  return rnd(ws ? t / ws : 0, 1);
}

export function gradeOf(total, cfg) {
  const g = cfg.grades;
  for (const letter of ['A', 'B', 'C', 'D']) if (total >= g[letter]) return letter;
  return 'F';
}

/**
 * @param m     metrics of this option (metrics.js)
 * @param base  metrics of the current rotation
 * @param st    { familyRepeatShare, greenBridge: {cover, nextCrop, pest} | null, usesLegume, nCreditUsd }
 */
export function scoreOption(m, base, st = {}) {
  const S = {};
  const add = (id, value, reasons) => { S[id] = { value: Math.round(Math.min(100, Math.max(0, value))), reasons }; };

  // 1 Profit: median return above variable costs
  const pv = lin(m.medianReturn, PROFIT_SCORE_ZERO_USD, PROFIT_SCORE_FULL_USD);
  const dProfit = m.medianReturn - base.medianReturn;
  const pr = [{ key: 'v2.reason.profit.median', params: { usd: rnd(m.medianReturn) }, tone: toneOf(pv), src: ['simulator', 'nass'] }];
  if (Math.abs(dProfit) >= 10) pr.push({ key: 'v2.reason.profit.vsCurrent', params: { usd: rnd(dProfit) }, tone: dProfit > 0 ? 'up' : 'down', src: ['simulator'] });
  if (st.nCreditUsd >= 5) pr.push({ key: 'v2.reason.profit.nCredit', params: { usd: rnd(st.nCreditUsd) }, tone: 'up', src: ['crop-library'] });
  add('profit', pv, pr);

  // 2 Risk: worst 10% of seasons vs the current rotation
  const dRisk = m.p10Return - base.p10Return;
  const rv = 50 + (50 * dRisk) / RISK_SCALE_USD;
  add('risk', rv, [
    { key: 'v2.reason.risk.worst10', params: { usd: rnd(m.p10Return) }, tone: toneOf(rv), src: ['simulator'] },
    ...(Math.abs(dRisk) >= 10 ? [{ key: 'v2.reason.risk.vsCurrent', params: { usd: rnd(dRisk) }, tone: dRisk > 0 ? 'up' : 'down', src: ['simulator'] }] : []),
  ]);

  // 3 Soil: erosion vs T, bare days, organic matter trend
  const T = m.toleranceT || 5;
  const eroSub = lin(m.erosionTonsPerAcreYear / T, SOIL_EROSION_ZERO_T_SHARE, SOIL_EROSION_FULL_T_SHARE);
  const bareSub = lin(m.bareDaysPerYear, SOIL_BARE_ZERO_DAYS, SOIL_BARE_FULL_DAYS);
  const somSub = lin(m.somTrendPctPerDecade, SOIL_SOM_ZERO_PCT_DECADE, SOIL_SOM_FULL_PCT_DECADE);
  const sv = SOIL_WEIGHTS.erosion * eroSub + SOIL_WEIGHTS.bare * bareSub + SOIL_WEIGHTS.som * somSub;
  add('soil', sv, [
    { key: m.erosionTonsPerAcreYear > T ? 'v2.reason.soil.erosionOverT' : 'v2.reason.soil.erosionUnderT', params: { erosion: rnd(m.erosionTonsPerAcreYear, 1), t: T }, tone: m.erosionTonsPerAcreYear > T ? 'down' : toneOf(eroSub), src: ['ssurgo', 'simulator'] },
    { key: 'v2.reason.soil.bareDays', params: { days: rnd(m.bareDaysPerYear) }, tone: toneOf(bareSub), src: ['simulator'] },
    { key: m.somTrendPctPerDecade >= 0 ? 'v2.reason.soil.somUp' : 'v2.reason.soil.somDown', params: { pct: rnd(m.somTrendPctPerDecade, 2) }, tone: toneOf(somSub), src: ['simulator'] },
  ]);

  // 4 Water: water left for the next crop and water stress
  const wPlant = lin(m.meanWaterShareAtPlanting, WATER_PLANT_SHARE_ZERO, WATER_PLANT_SHARE_FULL);
  const wSupply = lin(m.meanWaterSupply, WATER_SUPPLY_ZERO, WATER_SUPPLY_FULL);
  const wv = 0.5 * wPlant + 0.5 * wSupply;
  add('water', wv, [
    { key: 'v2.reason.water.atPlanting', params: { share: rnd(m.meanWaterShareAtPlanting, 2) }, tone: toneOf(wPlant), src: ['simulator', 'ssurgo'] },
    { key: 'v2.reason.water.supply', params: { ratio: rnd(m.meanWaterSupply, 2) }, tone: toneOf(wSupply), src: ['simulator'] },
  ]);

  // 5 Nutrients: nitrogen balance, fertilizer bought (legume credit)
  const bought = lin(m.nFertilizerLbPerYear, NUTRIENT_BOUGHT_ZERO_LB, NUTRIENT_BOUGHT_FULL_LB);
  const balSub = m.nBalanceLbPerYear >= 0 ? 100 : lin(m.nBalanceLbPerYear, NUTRIENT_BALANCE_ZERO_LB, 0);
  const nv = NUTRIENT_WEIGHTS.bought * bought + NUTRIENT_WEIGHTS.balance * balSub;
  const nr = [{ key: m.nFertilizerLbPerYear > 0 ? 'v2.reason.nutrients.bought' : 'v2.reason.nutrients.noneBought', params: { lb: rnd(m.nFertilizerLbPerYear) }, tone: toneOf(bought), src: ['crop-library'] }];
  if (m.nFixedLbPerYear >= 5) nr.push({ key: 'v2.reason.nutrients.fixed', params: { lb: rnd(m.nFixedLbPerYear) }, tone: 'up', src: ['crop-library'] });
  if (m.nBalanceLbPerYear < -10) nr.push({ key: 'v2.reason.nutrients.mining', params: { lb: rnd(-m.nBalanceLbPerYear) }, tone: 'down', src: ['simulator'] });
  add('nutrients', nv, nr);

  // 6 Pests: shared hosts, green bridges, family repeats, simulated pest loss
  let pv2 = lin(m.meanPestLoss, PEST_LOSS_ZERO, 0) - PEST_FAMILY_REPEAT_PENALTY * (st.familyRepeatShare ?? 0) - (st.greenBridge ? PEST_BRIDGE_PENALTY : 0);
  const pests = [{ key: m.meanPestLoss > 0.05 ? 'v2.reason.pests.loss' : 'v2.reason.pests.lowLoss', params: { pct: rnd(m.meanPestLoss * 100, 1) }, tone: toneOf(lin(m.meanPestLoss, PEST_LOSS_ZERO, 0)), src: ['crop-library', 'simulator'] }];
  pests.push((st.familyRepeatShare ?? 0) > 0
    ? { key: 'v2.reason.pests.familyRepeat', params: { share: rnd(st.familyRepeatShare, 2) }, tone: 'down', src: ['crop-library'] }
    : { key: 'v2.reason.pests.familiesRotate', params: {}, tone: 'up', src: ['crop-library'] });
  if (st.greenBridge) pests.push({ key: 'v2.reason.pests.greenBridge', params: { cover: st.greenBridge.cover, nextCrop: st.greenBridge.nextCrop, pest: st.greenBridge.pest }, tone: 'down', src: ['crop-library'] });
  add('pests', pv2, pests);
  return S;
}
