// Field risks (docs/fieldshift-v2.md screen 3): stress calendar, next months' outlook, erosion hot spots, groundwater, frost and heat now vs 2040.
// The stress calendar and the climate comparison come from the field's own weather (2008-2025 real monthly rows) and the engine's weather;
// the next-months outlook comes from model slot B (placeholder calendar until Model B is plugged in). Pure JS, i18n keys only.
import { stressOutlookFrom } from '../modelSlots.js';
import { scenarioWeather } from './context.js';
import { median, quantile } from './metrics.js';
import { WARMING_2040_C, SEARCH_START_YEAR, SEARCH_YEARS } from './constants.js';

export const DRY_MONTH_SHARE_OF_NORMAL = 0.6;   // a month with less than 60 % of its median rain counts as dry (estimate)
export const HOT_MONTH_ABOVE_NORMAL_C = 1.5;    // a month with a mean daily maximum 1.5 C above its median counts as hot (estimate)
export const HEAT_DAY_C = 35;                   // a heat day: daily maximum at or above 35 C
const r2 = (x) => Math.round(x * 100) / 100;

function stressCalendar(field) {
  const rows = field.climateMonthly ?? [];
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const mr = rows.filter((r) => r.month === m && Number.isFinite(r.precipMm) && Number.isFinite(r.tMaxC));
    if (mr.length < 5) { out.push({ month: m, risk: 0, reasons: [{ key: 'v2.risk.noData', params: {} }] }); continue; }
    const pMed = median(mr.map((r) => r.precipMm)), tMed = median(mr.map((r) => r.tMaxC));
    const dry = mr.filter((r) => r.precipMm < DRY_MONTH_SHARE_OF_NORMAL * pMed).length / mr.length;
    const hot = mr.filter((r) => r.tMaxC > tMed + HOT_MONTH_ABOVE_NORMAL_C).length / mr.length;
    const either = mr.filter((r) => r.precipMm < DRY_MONTH_SHARE_OF_NORMAL * pMed || r.tMaxC > tMed + HOT_MONTH_ABOVE_NORMAL_C).length / mr.length;
    const reasons = [];
    if (dry >= 0.1) reasons.push({ key: 'v2.risk.dryMonths', params: { share: r2(dry) }, src: ['power'] });
    if (hot >= 0.1) reasons.push({ key: 'v2.risk.hotMonths', params: { share: r2(hot) }, src: ['power'] });
    if (!reasons.length) reasons.push({ key: 'v2.risk.calmMonth', params: {}, src: ['power'] });
    out.push({ month: m, risk: r2(either), reasons });
  }
  return out;
}

/** Frost-free days (last spring minimum under 0 C to first autumn minimum under 0 C) and heat days (maximum >= 35 C), per year, median of the real-weather years. */
function climateStats(weather) {
  const frostFree = [], heat = [];
  for (let y = SEARCH_START_YEAR; y < SEARCH_START_YEAR + SEARCH_YEARS; y++) {
    const w = weather.year(y);
    let last = 0, first = w.days, h = 0;
    for (let d = 1; d <= w.days; d++) {
      if (w.tmax[d - 1] >= HEAT_DAY_C) h++;
      if (w.tmin[d - 1] < 0) { if (d < 183) last = d; else if (first === w.days) first = d; }
    }
    frostFree.push(first - last); heat.push(h);
  }
  return { frostFreeDays: median(frostFree), heatDays: median(heat) };
}

function rainCv(field) {
  const y = (field.climateYearly ?? []).map((r) => r.precipMm).filter(Number.isFinite);
  if (y.length < 10) return null;
  const mu = y.reduce((a, b) => a + b, 0) / y.length;
  return Math.sqrt(y.reduce((a, b) => a + (b - mu) ** 2, 0) / (y.length - 1)) / mu;
}

/**
 * @param erosionByMonth 12 numbers: simulated erosion (tons/acre/year averaged) for each month under the current rotation
 * @param irrigated whether the farmer said the field is irrigated
 */
export function buildFieldRisks(ctx, { erosionByMonth, erosionPerYear, todayISO }) {
  const { field, slots, weather } = ctx;
  const now = climateStats(weather);
  const warm = climateStats(scenarioWeather(weather, { warmC: WARMING_2040_C.ssp245 }, field.field.lat));
  const T = field.soil?.tFactor ?? 5;
  const total = erosionByMonth.reduce((a, b) => a + b, 0) || 1;
  const peak = erosionByMonth.indexOf(Math.max(...erosionByMonth)) + 1;
  const cv = rainCv(field);
  return {
    stressCalendar: stressCalendar(field),
    nextMonths: stressOutlookFrom(slots.slots.B, todayISO, 3),
    erosionHotspots: [{
      zoneKey: 'v2.zone.wholeField', areaShare: 1, tonsPerAcreYear: r2(erosionPerYear),
      reasons: [
        { key: erosionPerYear > T ? 'v2.reason.soil.erosionOverT' : 'v2.reason.soil.erosionUnderT', params: { erosion: r2(erosionPerYear), t: T }, src: ['ssurgo', 'simulator'] },
        { key: 'v2.risk.peakErosionMonth', params: { month: peak, share: r2(erosionByMonth[peak - 1] / total) }, src: ['simulator'] },
      ],
    }],
    water: { groundwaterTrend: { status: ctx.constraints.irrigationAvailable ? 'unknown' : 'not-applicable', source: ctx.constraints.irrigationAvailable ? 'grace-not-loaded' : 'dryland-assumed' } },
    climateNowVs2040: {
      frostFreeDays: { today: Math.round(now.frostFreeDays), y2040: Math.round(warm.frostFreeDays) },
      heatDays: { today: Math.round(now.heatDays), y2040: Math.round(warm.heatDays) },
      rainVariability: { today: cv == null ? 0 : r2(cv), y2040: cv == null ? 0 : r2(cv), noteKey: 'v2.risk.rainVariabilitySame' },
      scenario: { key: 'v2.risk.warmingOffset', params: { warmC: WARMING_2040_C.ssp245 } },
    },
  };
}

export { quantile };
