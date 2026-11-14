// EXTRA INCOME: share of seasons with a sellable crop, bonus if it matches the farmer's market.
import { clamp, reason } from './helpers.js';

const CASH = ['grain', 'fiber', 'oilseed', 'forage'];
// Which crop marketTypes each "market/use" choice can sell into.
const MARKET_MATCH = {
  elevator: ['grain', 'oilseed'],
  gin: ['fiber'],
  cattle: ['forage', 'grain'],
  local: ['forage', 'oilseed', 'grain'],
};

export function incomeRule(crops, field, constraints = {}) {
  const sellable = crops.filter((c) => CASH.includes(c.marketType));
  let score = (sellable.length / crops.length) * 8;
  const reasons = [reason('reasons.cashShare', { count: sellable.length, total: crops.length })];

  const match = MARKET_MATCH[constraints.market];
  if (match && sellable.some((c) => match.includes(c.marketType))) {
    score += 2;
    reasons.push(reason('reasons.marketMatch'));
  }
  return { score: clamp(score), reasons };
}
