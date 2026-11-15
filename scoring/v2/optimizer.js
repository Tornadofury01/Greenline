// The optimizer (docs/fieldshift-v2.md "Profit: estimating and maximizing it").
// For one option it tries the management choices (planting date, N rate, maturity, cover termination, double crop, tillage, irrigation)
// by coordinate descent: change one choice at a time through the engine, keep the change if it helps, repeat. The goal:
//   maximize the MEDIAN return above variable costs per acre per year
//   subject to: the worst 10% of seasons are no worse than the current rotation's, mean erosion stays under the soil's T.
// If no setting meets both limits, the setting with the smallest violation is kept and the option is marked "limits not met".
// Pure JS.
import {
  PLANT_SHIFT_DAYS, N_SCALES, TILLAGE_CHOICES, COVER_TERMINATIONS, IRRIGATION_CHOICES, OPTIMIZER_PASSES, OPTIMIZER_MIN_GAIN_USD,
  RISK_LIMIT_SLACK_USD, SOIL_LIMIT_FACTOR, SEARCH_START_YEAR, SEARCH_YEARS,
} from './constants.js';
import { materialize, DEFAULT_CHOICES } from './plans.js';
import { runPlan } from './context.js';

/** How far a result is outside the limits (0 = inside both). Soil: share over T. Risk: dollars below the current worst-10% result. */
export function violation(m, base) {
  const T = m.toleranceT || 5;
  const soil = Math.max(0, m.erosionTonsPerAcreYear / (T * SOIL_LIMIT_FACTOR) - 1);
  const risk = Math.max(0, base.p10Return - RISK_LIMIT_SLACK_USD - m.p10Return) / 100;
  return { soil, risk, total: soil + risk, soilMet: soil === 0, riskMet: risk === 0 };
}

const keyOf = (c) => JSON.stringify(c);

/**
 * @param ctx   field context  @param spec option spec  @param base metrics of the current rotation (search horizon)
 * @param opts  { start: initial choices }
 * @returns { choices, m (search-horizon metrics), mat (materialized plan), runs, feasible, violation } or null if nothing runs
 */
export function optimizeOption(ctx, spec, base, { start } = {}) {
  const hasCover = spec.covers.some(Boolean), hasSecond = spec.mains.some((x) => x.second);
  const knobs = [
    ['tillage', TILLAGE_CHOICES],
    ...(hasSecond ? [['doubleCrop', [false, true]]] : []),
    ...(hasCover ? [['coverTermination', COVER_TERMINATIONS]] : []),
    ['maturity', ['full', 'short']],
    ['plantingDate', Object.keys(PLANT_SHIFT_DAYS)],
    ...(ctx.constraints.irrigationAvailable ? [['irrigation', IRRIGATION_CHOICES]] : []),
    ['nitrogenScale', N_SCALES],   // last: the best N rate depends on every other choice
  ];
  const memo = new Map();
  let runs = 0;
  const evalChoices = (choices) => {
    const k = keyOf(choices);
    if (memo.has(k)) return memo.get(k);
    const mat = materialize(spec, choices, ctx);
    let res = null;
    if (!mat.problems.length) {
      // a choice that changes nothing (e.g. double crop that does not fit) reuses the run of the same effective plan
      const planKey = keyOf([mat.plan.sequence, mat.contractManagement]);
      if (memo.has(planKey)) res = memo.get(planKey);
      else {
        runs++;
        const { m } = runPlan(ctx, mat.plan, { startYear: SEARCH_START_YEAR, years: SEARCH_YEARS });
        res = { m, mat, choices, v: violation(m, base) };
        memo.set(planKey, res);
      }
    }
    memo.set(k, res);
    return res;
  };
  // `a` beats `b`: inside the limits first; among those the higher median return (by at least the minimum gain); else the smaller violation
  const better = (a, b) => {
    if (!b) return !!a;
    if (!a) return false;
    const fa = a.v.total === 0, fb = b.v.total === 0;
    if (fa !== fb) return fa;
    if (fa) return a.m.medianReturn > b.m.medianReturn + OPTIMIZER_MIN_GAIN_USD;
    if (Math.abs(a.v.total - b.v.total) > 0.01) return a.v.total < b.v.total;
    return a.m.medianReturn > b.m.medianReturn + OPTIMIZER_MIN_GAIN_USD;
  };

  let cur = { ...DEFAULT_CHOICES, ...(start ?? {}) };
  let best = evalChoices(cur);
  if (!best) return null;
  for (let pass = 0; pass < OPTIMIZER_PASSES; pass++) {
    let changed = false;
    for (const [name, values] of knobs) {
      for (const v of values) {
        if (v === cur[name]) continue;
        const cand = evalChoices({ ...cur, [name]: v });
        if (better(cand, best)) { best = cand; cur = { ...cur, [name]: v }; changed = true; }
      }
    }
    if (!changed) break;
  }
  return { choices: cur, m: best.m, mat: best.mat, runs, feasible: best.v.total === 0, violation: best.v };
}
