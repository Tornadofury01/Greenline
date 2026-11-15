// What-if runs for confidence (docs/fieldshift-v2.md "Uncertainty": "1,000 what-if runs with each assumption drawn from a range").
// One WORLD = one draw of the assumptions: each crop's price, each crop's yield, input costs, the nitrogen price, the legume
// nitrogen credit, and whether a cover crop fails to establish. The engine's seasons are run ONCE per option; each world re-prices
// those seasons (their money is stored split by crop and by cost type), so 1,000 worlds are cheap. The same world is applied to the
// option and to the current rotation, so "beats the current rotation" compares them under the same assumptions.
// Profit range: low / typical / high = 10th / 50th / 90th percentile over the worlds of the median-season return.
import {
  WHAT_IF_RUNS, PRICE_CV_FALLBACK, YIELD_UNCERTAINTY, INPUT_COST_RANGE, N_PRICE_CV, N_CREDIT_RANGE, COVER_FAIL_CHANCE,
  CONF_HIGH_SHARE, CONF_MEDIUM_SHARE, CONF_CLIMATE_AGREE_SHARE, CONF_SLOT_CAPS, CONF_NO_CURRENT_CROPS_LEVEL,
} from './constants.js';
import { quantile, median } from './metrics.js';

function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const normal = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** Spread of each crop's price: standard deviation of log price over the last 10 years of the field's Texas price series. */
function priceCv(field, crop) {
  const p = (field.market?.pricesTx ?? []).filter((x) => x.crop === crop).sort((a, b) => a.year - b.year).slice(-10).map((x) => Math.log(x.value)).filter(Number.isFinite);
  if (p.length < 5) return PRICE_CV_FALLBACK;
  const mu = p.reduce((a, b) => a + b, 0) / p.length;
  return Math.sqrt(p.reduce((a, b) => a + (b - mu) ** 2, 0) / (p.length - 1));
}

/** Draw all worlds once per field (seeded by the field id: same field, same worlds). */
export function drawWorlds(field, cashCrops, runs = WHAT_IF_RUNS) {
  const r = rng(hash(field.field.id + ':whatif'));
  const price = {}, yld = {};
  for (const c of cashCrops) {
    const cv = priceCv(field, c);
    price[c] = new Float64Array(runs); yld[c] = new Float64Array(runs);
    for (let i = 0; i < runs; i++) { price[c][i] = Math.exp(normal(r) * cv - (cv * cv) / 2); yld[c][i] = 1 + (r() * 2 - 1) * YIELD_UNCERTAINTY; }
  }
  const costMult = new Float64Array(runs), fertMult = new Float64Array(runs), credit = new Float64Array(runs), coverFail = new Uint8Array(runs);
  for (let i = 0; i < runs; i++) {
    costMult[i] = INPUT_COST_RANGE[0] + r() * (INPUT_COST_RANGE[1] - INPUT_COST_RANGE[0]);
    fertMult[i] = Math.exp(normal(r) * N_PRICE_CV - (N_PRICE_CV * N_PRICE_CV) / 2);
    credit[i] = N_CREDIT_RANGE[0] + r() * (N_CREDIT_RANGE[1] - N_CREDIT_RANGE[0]);
    coverFail[i] = r() < COVER_FAIL_CHANCE ? 1 : 0;
  }
  return { runs, price, yld, costMult, fertMult, credit, coverFail };
}

/** Median-season return of one option in every world. `m` = metrics (full run), `extra` = { nCreditUsd, hasCover } for the option. */
export function worldMedians(m, extra, W) {
  const out = new Float64Array(W.runs);
  const ns = m.ns;
  const crops = Object.keys(m.revByCrop);
  const tmp = new Float64Array(ns);
  for (let w = 0; w < W.runs; w++) {
    const failed = extra.hasCover && W.coverFail[w];
    const creditShift = (failed ? -1 : W.credit[w] - 1) * extra.nCreditUsd; // legume credit that is lower (or lost) than assumed costs money
    for (let i = 0; i < ns; i++) {
      let rev = 0;
      for (const c of crops) rev += m.revByCrop[c][i] * (W.price[c]?.[w] ?? 1) * (W.yld[c]?.[w] ?? 1);
      tmp[i] = rev - m.fert[i] * W.fertMult[w] - (m.seedChem[i] + m.other[i] + m.cover[i]) * W.costMult[w] + creditShift;
    }
    out[w] = median(tmp);
  }
  return out;
}

/** Confidence: the plan's rule, with the placeholder cap. */
export function confidenceOf({ beatsShare, climateAgree, climateOf, warnCount, placeholderSlots, isCurrent, currentKnownYears = 3 }) {
  const reasons = [];
  const agreeShare = climateOf ? climateAgree / climateOf : 1;
  let level;
  if (isCurrent) { level = 'medium'; reasons.push({ key: 'v2.conf.isCurrent', params: {} }); }
  else {
    if (beatsShare >= CONF_HIGH_SHARE && agreeShare >= CONF_CLIMATE_AGREE_SHARE && warnCount === 0) level = 'high';
    else if (beatsShare >= CONF_MEDIUM_SHARE) level = 'medium';
    else level = 'low';
    if (beatsShare < CONF_MEDIUM_SHARE) reasons.push({ key: 'v2.conf.beatsRarely', params: { share: Math.round(beatsShare * 100) / 100 } });
    else if (beatsShare < CONF_HIGH_SHARE) reasons.push({ key: 'v2.conf.beatsSometimes', params: { share: Math.round(beatsShare * 100) / 100 } });
    else reasons.push({ key: 'v2.conf.beatsOften', params: { share: Math.round(beatsShare * 100) / 100 } });
    if (agreeShare < CONF_CLIMATE_AGREE_SHARE) reasons.push({ key: 'v2.conf.climateDisagree', params: { agree: climateAgree, of: climateOf } });
    if (warnCount > 0) reasons.push({ key: 'v2.conf.warnedChecks', params: { n: warnCount } });
  }
  const capped = CONF_SLOT_CAPS.filter((s) => placeholderSlots.includes(s));
  if (capped.length && level === 'high') { level = 'medium'; reasons.push({ key: 'v2.conf.cappedByPlaceholders', params: { slots: capped } }); }
  if (currentKnownYears < 3) {
    reasons.push({ key: 'v2.conf.currentRotationGuess', params: { known: currentKnownYears } });
    if (currentKnownYears === 0) level = CONF_NO_CURRENT_CROPS_LEVEL;
    else if (level === 'high') level = 'medium';
  }
  if (placeholderSlots.length) reasons.push({ key: 'v2.conf.placeholderSlots', params: { n: placeholderSlots.length } });
  return { level, reasons };
}

export { quantile };
