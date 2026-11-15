// Turns one engine run (the summary) into the numbers the option builder needs: the money of every season (split so that the
// what-if runs can re-price it), erosion, bare days, nitrogen, water at planting, season outcome and pest loss.
// Pure JS. The first and last calendar year of the run are left out of the money statistics (their planting or harvest costs fall outside).
import { WORST_SEASONS_SHARE } from './constants.js';

export const median = (a) => quantile(a, 0.5);
export function quantile(arr, q) {
  if (!arr.length) return 0;
  const s = Float64Array.from(arr).sort();
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r1 = (x) => Math.round(x * 10) / 10;

/**
 * @param sum   engine summary  @param startYear first simulated year  @param years number of years run
 * @param lib   library by id (to know which crops are covers)
 */
export function metricsOf(sum, { startYear, years, lib }) {
  const first = startYear + 1, last = startYear + years - 2;
  const seasons = [];
  for (let y = first; y <= last; y++) seasons.push(y);
  const idx = new Map(seasons.map((y, i) => [y, i]));
  const ns = seasons.length;
  const revByCrop = {};                       // crop -> Float64Array(ns) revenue
  const fert = new Float64Array(ns), cover = new Float64Array(ns), other = new Float64Array(ns), seedChem = new Float64Array(ns);
  for (const e of sum.ledger) {
    const i = idx.get(Number(e.date.slice(0, 4)));
    if (i === undefined) continue;
    const [kind, crop] = e.item.split(':');
    if (kind === 'revenue') { (revByCrop[crop] ??= new Float64Array(ns))[i] += e.usd; continue; }
    const cost = -e.usd;
    if (kind === 'fertilizer-N') fert[i] += cost;
    else if ((kind === 'plant' || kind === 'terminate') && lib[crop]?.kind === 'cover') cover[i] += cost;
    else if (kind === 'plant' || kind === 'chemicals') { seedChem[i] += cost; }
    else other[i] += cost;
  }
  const ret = new Float64Array(ns);
  for (let i = 0; i < ns; i++) {
    let rev = 0;
    for (const a of Object.values(revByCrop)) rev += a[i];
    ret[i] = rev - fert[i] - cover[i] - other[i] - seedChem[i];
  }
  const retArr = Array.from(ret);

  const eps = sum.episodes.filter((e) => e.year >= first && e.year <= last);
  const cash = eps.filter((e) => e.role === 'cash');
  const covers = eps.filter((e) => e.role === 'cover');
  const nYears = sum.yearly.filter((y) => y.days >= 365).length || 1;
  const t = sum.totals;
  const wShare = cash.map((e) => e.waterAtPlantingShare).filter((x) => x != null);
  const supply = cash.map((e) => e.waterSupplyRatio);
  return {
    seasons, ns, ret: retArr, revByCrop, fert, cover, other, seedChem,
    medianReturn: median(retArr), meanReturn: mean(retArr), p10Return: quantile(retArr, WORST_SEASONS_SHARE),
    erosionTonsPerAcreYear: sum.perYear.erosionTonsPerAcre, toleranceT: sum.perYear.toleranceT, bareDaysPerYear: sum.perYear.bareDays,
    somTrendPctPerDecade: sum.soil.somTrendPctPerDecade,
    nFertilizerLbPerYear: t.nFertilizerLb / years, nFixedLbPerYear: t.nFixedLb / years, nRemovedLbPerYear: t.nRemovedLb / years, nLeachedLbPerYear: t.nLeachedLb / years,
    nBalanceLbPerYear: (t.nFertilizerLb + t.nFixedLb - t.nRemovedLb - t.nLeachedLb) / years,
    waterShareAtPlanting: wShare, meanWaterShareAtPlanting: mean(wShare), meanWaterSupply: mean(supply),
    shortWaterShare: wShare.length ? wShare.filter((x) => x < 0.3).length / wShare.length : 0, // recomputed with the named constant in fitChecks.js
    cashEpisodes: cash.map((e) => ({ crop: e.crop, year: e.year, stageAtEnd: e.stageAtEnd, killed: e.killed, pestLoss: e.pestLoss, yield: e.yield, yieldVsTypical: e.yieldVsTypical, waterShare: e.waterAtPlantingShare, supply: e.waterSupplyRatio })),
    coverEpisodes: covers.length,
    meanPestLoss: cash.length ? mean(cash.map((e) => e.pestLoss)) : 0,
    cashYears: cash.length,
    fixedNLb: t.nFixedLb,
    summaryTotals: { rainMm: t.rainMm, returnAboveVariableUsd: t.returnAboveVariableUsd },
    yearsRun: years,
    round: { median: r1(median(retArr)) },
  };
}
