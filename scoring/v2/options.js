// The option generator (docs/fieldshift-v2.md "The option generator"):
//   1 screen crops for this location   2 find the gaps in the current rotation   3 fill the gaps with cover crops
//   4 change the sequence of cash crops   5 apply the rotation rules   6 keep the best (the caller ranks and trims).
// Pure JS. Returns SPECS (see plans.js); the optimizer chooses the management for each.
import {
  CASH_CROPS_FOR_ROTATIONS, COVER_PLANS, DOUBLE_CROP_CHOICES, SCREEN_GDD_SHARE, SEARCH_START_YEAR, SEARCH_YEARS, WARMING_2040_C,
} from './constants.js';
import { materialize, DEFAULT_CHOICES } from './plans.js';
import { scenarioWeather } from './context.js';
import { median } from './metrics.js';
import { structureOf, marketCheck } from './fitChecks.js';

const DAY = 365;
const famKey = (lib, crop) => (lib[crop].family === 'other' ? crop : lib[crop].family);

/** Heat sum (growing degree days) a crop gets between its usual planting and end dates, one season. */
function gddSeason(weather, year, cal, base, upper = 30) {
  let sum = 0;
  const from = cal.plantYearOffset === -1 ? year - 1 : year;
  const wFrom = weather.year(from), wTo = weather.year(year);
  const add = (w, d0, d1) => { for (let d = d0; d <= d1 && d <= w.days; d++) { const tm = (Math.min(w.tmax[d - 1], upper) + Math.max(w.tmin[d - 1], base)) / 2; sum += Math.max(0, tm - base); } };
  if (from === year) add(wTo, cal.plantDoy, cal.endDoy);
  else { add(wFrom, cal.plantDoy, wFrom.days); add(wTo, 1, cal.endDoy); }
  return sum;
}

function seasonTmax(weather, year, cal) {
  const w = weather.year(year);
  let s = 0, n = 0;
  for (let d = Math.max(1, cal.plantYearOffset === -1 ? 1 : cal.plantDoy); d <= Math.min(w.days, cal.endDoy); d++) { s += w.tmax[d - 1]; n++; }
  return n ? s / n : 0;
}

/**
 * Step 1: keep crops whose heat need fits the heat available between their usual dates (median of the real-weather seasons)
 * and flag the ones that stop fitting under the warmer 2040 scenario (heat above the crop's growth limit).
 */
export function screenCrops(ctx) {
  const { lib, calendars, weather, field } = ctx;
  const warm = scenarioWeather(weather, { warmC: WARMING_2040_C.ssp585 }, field.field.lat);
  const years = Array.from({ length: SEARCH_YEARS }, (_, i) => SEARCH_START_YEAR + i);
  const kept = [], dropped = [], flaggedBy2040 = [];
  for (const id of CASH_CROPS_FOR_ROTATIONS) {
    const def = lib[id], cal = calendars[id];
    if (!def || !cal) { dropped.push({ crop: id, reason: 'no-calendar' }); continue; }
    const gdd = median(years.map((y) => gddSeason(weather, y, cal, def.season.baseTempC)));
    if (gdd < SCREEN_GDD_SHARE * def.season.gddToMaturity) { dropped.push({ crop: id, reason: 'not-enough-heat', gdd: Math.round(gdd), needs: def.season.gddToMaturity }); continue; }
    const market = marketCheck([id], field, ctx);
    if (market.status === 'fail') { dropped.push({ crop: id, reason: 'market', evidence: market.evidence }); continue; }  // no county record, almost no acres, no buyer entered: removed before any option is built
    kept.push(id);
    const hot = median(years.map((y) => seasonTmax(warm, y, cal)));
    if (hot > def.temperature.maxGrowthC - 3) flaggedBy2040.push(id); // season-mean daily maximum within 3 C of the crop's growth limit under warming
  }
  return { kept, dropped, flaggedBy2040 };
}

/** Rotation rules (step 5). `mains` = crop ids of the cycle. */
function rulesOk(lib, mains) {
  const n = mains.length;
  const f = mains.map((c) => famKey(lib, c));
  if (n >= 2 && f.every((x) => x === f[0])) return false;                       // the family must switch at least every other year
  if (n === 3 && f[0] === f[1] && f[1] === f[2]) return false;
  for (let i = 0; i < n; i++) if (mains[i] === mains[(i + 1) % n]) return false; // never the same crop back to back
  return true;
}

function permutations3(a) {
  // the two cyclic orders of three crops (a rotation is a cycle, so only 2 of the 6 permutations differ)
  return [[a[0], a[1], a[2]], [a[0], a[2], a[1]]];
}

/** Fill gaps (step 3): per gap, the first cover of the plan's list that fits (plans.js decides by dates). */
function coverPattern(ctx, mains, kind) {
  const n = mains.length;
  const spec = { id: 'tmp', mains: mains.map((c) => ({ crop: c })), covers: Array(n).fill(null) };
  const picks = [];
  for (let p = 0; p < n; p++) {
    for (const season of ['winter', 'summer']) {
      for (const cover of COVER_PLANS[kind][season]) {
        const trial = { ...spec, covers: spec.covers.map((x, j) => (j === p ? cover : x)) };
        const r = materialize(trial, DEFAULT_CHOICES, ctx);
        // a cover that hosts a serious pest of the next cash crop (green bridge) is never offered; the disease check would remove the option anyway
        if (!r.problems.length && r.applied.covers[p] && !structureOf(r.plan, ctx.lib).greenBridge) { spec.covers[p] = cover; picks.push({ p, cover, season }); break; }
      }
      if (spec.covers[p]) break;
    }
  }
  return { covers: spec.covers, picks };
}

/**
 * All candidate specs (cash sequences x cover variants), each already feasible on the calendar and following the rotation rules.
 * Each spec carries `shape` (how it was built) for diversity in the pool.
 */
export function generateSpecs(ctx, kept) {
  const { lib } = ctx;
  const pool = [];
  const combos = [];
  for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
    combos.push([kept[i], kept[j]]);
    for (let k = j + 1; k < kept.length; k++) combos.push(...permutations3([kept[i], kept[j], kept[k]]));
  }
  let seq = 0;
  for (const mains of combos) {
    if (!rulesOk(lib, mains)) continue;
    // double-crop candidate after winter wheat: the first choice that is not a neighbour of the wheat in the cycle
    const n = mains.length;
    const second = (p) => {
      if (mains[p] !== 'winter_wheat') return undefined;
      const nb = new Set([mains[(p + 1) % n], mains[(p + n - 1) % n]]);
      return DOUBLE_CROP_CHOICES.find((c) => !nb.has(c) && kept.includes(c) && c !== mains[p]);
    };
    const mk = (covers, shape) => ({ id: `cand-${++seq}`, mains: mains.map((c, p) => ({ crop: c, second: second(p) })), covers, shape });
    const none = Array(n).fill(null);
    const hasLegume = mains.some((c) => lib[c].family === 'legume');
    const base = mk(none, 'cash-only');
    if (!materialize(base, DEFAULT_CHOICES, ctx).problems.length) {
      if (hasLegume) pool.push(base);
      const leg = coverPattern(ctx, mains, 'legume');
      const grass = coverPattern(ctx, mains, 'grass');
      if (leg.picks.length) pool.push(mk(leg.covers, 'legume-covers'));
      if (grass.picks.length && (hasLegume || leg.picks.length)) pool.push(mk(grass.covers, 'grass-covers'));
      // one legume cover only (the longest-gap one, first pick) when several fit
      if (leg.picks.length > 1) { const one = Array(n).fill(null); one[leg.picks[0].p] = leg.picks[0].cover; pool.push(mk(one, 'one-legume-cover')); }
      // a grass cover with a legume cash crop in the cycle also counts as a legume rotation
      if (!hasLegume && grass.picks.length && leg.picks.length) { const mix = [...grass.covers]; const i = leg.picks[0].p; mix[i] = leg.picks[0].cover; pool.push(mk(mix, 'mixed-covers')); }
    }
  }
  return pool;
}

export { famKey };
