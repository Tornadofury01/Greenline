// The four fit checks (docs/fieldshift-v2.md "The four fit checks"): water, disease, market, season.
// Each returns { status: 'pass' | 'warn' | 'fail', evidence: { key, params } } with ONE line of evidence (an i18n key + numbers).
// Thresholds are the named constants in constants.js ("to confirm with an agronomist"). Pure JS, no English text.
//
// Evidence keys emitted here (Terminal A adds the words; full list with params in docs/v2-i18n-keys.md):
//   v2.fit.water.pass / .warn / .fail            v2.fit.disease.pass / .warnFamilyRepeat / .warnSharedHost / .warnGreenBridge / .warnWeatherRisk / .failGreenBridge
//   v2.fit.market.pass / .warnFewAcres / .warnWeakPrice / .warnNoCountyRecord / .fail     v2.fit.season.pass / .warnTight / .warn2040 / .fail
import {
  WATER_SHORT_SHARE, WATER_FAIL_YEARS, WATER_WARN_YEARS, WATER_EXTRA_VS_CURRENT, SEASON_FAIL_YEARS, SEASON_WARN_YEARS, SEASON_DONE_STAGE,
  DISEASE_SERIOUS_LOSS, DISEASE_WEATHER_RISE, MARKET_FAIL_FIELD_SHARE, MARKET_WARN_FIELD_SHARE, MARKET_WEAK_PRICE_RATIO,
} from './constants.js';
import { PEST_TABLE } from '../engine/pests.js';
import { median } from './metrics.js';

const DAY = 365;
const rnd = (x, d = 2) => { const m = 10 ** d; return Math.round(x * m) / m; };
const fam = (lib, crop) => (lib[crop]?.family === 'other' ? crop : lib[crop]?.family ?? crop); // cotton, sunflower, sesame each count as their own family

/** Crops of a plan in time order (by planting day), as [{crop, role}], from the sequence of the contract. */
export function orderedCrops(plan) {
  const out = [];
  for (const y of plan.sequence) for (const c of y.crops) {
    out.push({ crop: c.crop, role: c.role, t: (y.year - 1 + (c.plantYearOffset ?? 0)) * DAY + c.plantDoy });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Rotation structure used by the disease check, the pest score and the check-locally list. */
export function structureOf(plan, lib) {
  const all = orderedCrops(plan).filter((c) => c.role !== 'fallow');
  const cash = all.filter((c) => c.role === 'cash').map((c) => c.crop);
  const familyRepeats = [];
  for (let i = 0; i < cash.length; i++) {
    const a = cash[i], b = cash[(i + 1) % cash.length];
    if (fam(lib, a) === fam(lib, b)) familyRepeats.push({ crop: a, nextCrop: b });
  }
  const sharedHosts = [];
  let greenBridge = null, minorBridge = null;
  for (let i = 0; i < all.length; i++) {
    const a = all[i], b = all[(i + 1) % all.length];
    const ha = lib[a.crop]?.pests?.hosts ?? [], hb = new Set(lib[b.crop]?.pests?.hosts ?? []);
    const shared = ha.filter((p) => hb.has(p));
    if (a.role === 'cover' && b.role === 'cash') {
      for (const p of shared) {
        const serious = (PEST_TABLE[p]?.maxLoss ?? 0) >= DISEASE_SERIOUS_LOSS;
        if (serious && !greenBridge) greenBridge = { cover: a.crop, nextCrop: b.crop, pest: p };
        if (!serious && !minorBridge) minorBridge = { cover: a.crop, nextCrop: b.crop, pest: p };
      }
    } else if (a.role === 'cash' && b.role === 'cash' && shared.length) sharedHosts.push({ crop: a.crop, nextCrop: b.crop, pest: shared[0] });
  }
  const legumeFamily = (c) => lib[c]?.family === 'legume';
  return {
    cash, familyRepeats, familyRepeatShare: cash.length ? familyRepeats.length / cash.length : 0, sharedHosts, greenBridge, minorBridge,
    usesLegume: all.some((c) => legumeFamily(c.crop)), hasCover: all.some((c) => c.role === 'cover'), crops: [...new Set(all.map((c) => c.crop))],
  };
}

/** 1 Water fit: does the option leave the next cash crop short of water? Relative to the current rotation. */
export function waterCheck(m, base, field) {
  const share = (x) => (x.waterShareAtPlanting.length ? x.waterShareAtPlanting.filter((s) => s < WATER_SHORT_SHARE).length / x.waterShareAtPlanting.length : 0);
  const short = share(m), cur = share(base), extra = short - cur;
  const mm = Math.max(0, (base.meanWaterShareAtPlanting - m.meanWaterShareAtPlanting) * 10 * (field.soil?.waterStorage100Cm ?? 16));
  const params = { shortYears: rnd(short), extraVsCurrent: rnd(extra), waterCostMm: Math.round(mm) };
  if (short > WATER_FAIL_YEARS && extra > WATER_EXTRA_VS_CURRENT) return { status: 'fail', evidence: { key: 'v2.fit.water.fail', params } };
  if (short >= WATER_WARN_YEARS) return { status: 'warn', evidence: { key: 'v2.fit.water.warn', params } };
  return { status: 'pass', evidence: { key: 'v2.fit.water.pass', params } };
}

/** 2 Disease fit: shared hosts, green bridges, family repeats, weather-driven pest risk today and in 2040. */
export function diseaseCheck(st, pestLossNow, pestLoss2040) {
  if (st.greenBridge) return { status: 'fail', evidence: { key: 'v2.fit.disease.failGreenBridge', params: st.greenBridge } };
  if (st.minorBridge) return { status: 'warn', evidence: { key: 'v2.fit.disease.warnGreenBridge', params: st.minorBridge } };
  if (st.familyRepeats.length) return { status: 'warn', evidence: { key: 'v2.fit.disease.warnFamilyRepeat', params: st.familyRepeats[0] } };
  if (st.sharedHosts.length) return { status: 'warn', evidence: { key: 'v2.fit.disease.warnSharedHost', params: st.sharedHosts[0] } };
  const ratio = pestLossNow > 0.005 ? pestLoss2040 / pestLossNow : 1;
  if (ratio >= DISEASE_WEATHER_RISE) return { status: 'warn', evidence: { key: 'v2.fit.disease.warnWeatherRisk', params: { ratio: rnd(ratio) } } };
  return { status: 'pass', evidence: { key: 'v2.fit.disease.pass', params: {} } };
}

/**
 * 3 Market fit: is the crop grown nearby (share of the study fields that grew it in the last years, county yield records) and is the price weak?
 * ctx = { regional: { cropFieldShare: {crop: 0-1} } | null, buyers: {crop: true} | {} }
 */
export function marketCheck(cashCrops, field, ctx) {
  const yields = field.market?.yields ?? [], prices = field.market?.pricesTx ?? [];
  let worst = { status: 'pass', evidence: { key: 'v2.fit.market.pass', params: { crops: cashCrops.length } } };
  const rank = { pass: 0, warn: 1, fail: 2 };
  const consider = (r) => { if (rank[r.status] > rank[worst.status]) worst = r; };
  for (const crop of cashCrops) {
    const countyRows = yields.filter((y) => y.crop === crop && y.level === 'county').length;
    const share = ctx.regional?.cropFieldShare?.[crop] ?? null;
    const buyer = !!ctx.buyers?.[crop];
    if (!buyer && countyRows === 0 && (share === null ? true : share < MARKET_FAIL_FIELD_SHARE)) {
      consider({ status: 'fail', evidence: { key: 'v2.fit.market.fail', params: { crop, share: share === null ? null : rnd(share, 3) } } });
      continue;
    }
    if (!buyer && countyRows === 0) { consider({ status: 'warn', evidence: { key: 'v2.fit.market.warnNoCountyRecord', params: { crop, share: rnd(share, 3) } } }); continue; }
    if (!buyer && share !== null && share < MARKET_WARN_FIELD_SHARE) { consider({ status: 'warn', evidence: { key: 'v2.fit.market.warnFewAcres', params: { crop, share: rnd(share, 3) } } }); continue; }
    const pr = prices.filter((p) => p.crop === crop).sort((a, b) => a.year - b.year);
    if (pr.length >= 5) {
      const last = pr[pr.length - 1].value, med = median(pr.slice(-10).map((p) => p.value));
      if (med > 0 && last / med < MARKET_WEAK_PRICE_RATIO) consider({ status: 'warn', evidence: { key: 'v2.fit.market.warnWeakPrice', params: { crop, ratio: rnd(last / med) } } });
    }
  }
  return worst;
}

/** 4 Season fit: share of seasons in which a cash crop did not finish (or froze), today and under the 2040 scenarios. `scen` = metrics of each scenario run. */
export function seasonCheck(m, scen) {
  const unfinished = (x) => {
    const eps = x.cashEpisodes;
    if (!eps.length) return { share: 0, crop: null };
    const bad = eps.filter((e) => e.stageAtEnd < SEASON_DONE_STAGE || e.killed);
    const byCrop = {};
    for (const e of bad) byCrop[e.crop] = (byCrop[e.crop] ?? 0) + 1;
    const worst = Object.entries(byCrop).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { share: bad.length / eps.length, crop: worst };
  };
  const now = unfinished(m);
  const s2040 = scen.length ? scen.reduce((a, x) => a + unfinished(x).share, 0) / scen.length : now.share;
  const params = { crop: now.crop, share: rnd(now.share), share2040: rnd(s2040) };
  if (now.share > SEASON_FAIL_YEARS) return { status: 'fail', evidence: { key: 'v2.fit.season.fail', params } };
  if (now.share >= SEASON_WARN_YEARS) return { status: 'warn', evidence: { key: 'v2.fit.season.warnTight', params } };
  if (s2040 > SEASON_FAIL_YEARS) return { status: 'warn', evidence: { key: 'v2.fit.season.warn2040', params } };
  return { status: 'pass', evidence: { key: 'v2.fit.season.pass', params: {} } };
}

/** "Check locally" ids (the plan's list) that apply to this option. */
export function checkLocally(st, mgmt, ctx, newCrops) {
  const ids = [];
  if (st.usesLegume) ids.push('legumeNitrogenCredit');
  if (st.hasCover) ids.push('coverEstablishment');
  if (st.hasCover || newCrops.length) ids.push('seedPriceAvailability');
  if (st.cash.length) ids.push('buyersLocalPrice');
  if (mgmt.tillage === 'no-till' || st.hasCover || mgmt.maturity === 'short' || mgmt.doubleCrop) ids.push('equipment');
  if (st.familyRepeats.length || st.sharedHosts.length || st.greenBridge || st.minorBridge || newCrops.length) ids.push('localPests');
  if (mgmt.irrigation !== 'none') ids.push('waterRights');
  ids.push('fieldQuirks');
  if (st.hasCover || mgmt.tillage === 'no-till') ids.push('costShareEligibility');
  return ids;
}
