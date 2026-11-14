// FEED CATTLE: average forage value (grazing or hay) across seasons.
import { avg, clamp, round1, reason } from './helpers.js';

export function cattleRule(crops) {
  const forage = avg(crops.map((c) => c.forageValue)); // 0-5
  return { score: clamp(forage * 2), reasons: [reason('reasons.forageAvg', { value: round1(forage) })] };
}
