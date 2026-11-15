// Contract fieldRisks (docs/v2-data-contract.md 2.3) -> props for the Field risks screen. Pure, no React.
import { FEEDS, slotSet, waitingFor } from './v2Options.js';

// Stress-month bands (share of seasons). Named constants, to confirm with an agronomist.
export const STRESS_MEDIUM = 0.15;
export const STRESS_HIGH = 0.3;
const levelOf = (risk) => (risk >= STRESS_HIGH ? 'high' : risk >= STRESS_MEDIUM ? 'medium' : 'low');

const CLIMATE_ROWS = [
  { id: 'frostFreeDays', unit: 'days' },
  { id: 'heatDays', unit: 'days' },
  { id: 'rainVariability', unit: 'share' }, // 0-1, shown as %
];

export function buildRisks(data) {
  const r = data.fieldRisks;
  const ph = slotSet(data);
  const calendar = r.stressCalendar.map((m) => ({ month: m.month, risk: m.risk, level: levelOf(m.risk), reasons: m.reasons || [] }));
  const hot = calendar.filter((m) => m.level === 'high').map((m) => m.month);
  const maxErosion = Math.max(0, ...r.erosionHotspots.map((z) => z.tonsPerAcreYear));
  return {
    calendar,
    peakMonths: hot,
    next: r.nextMonths.map((m) => ({ month: m.month, low: m.low, chance: m.chance, high: m.high, reasons: m.reasons || [] })),
    erosion: r.erosionHotspots.map((z) => ({
      zoneKey: z.zoneKey, areaShare: z.areaShare, tons: z.tonsPerAcreYear, bar: maxErosion ? z.tonsPerAcreYear / maxErosion : 0, reasons: z.reasons || [],
    })),
    groundwater: r.water.groundwaterTrend.status,
    climate: CLIMATE_ROWS.map((c) => ({ ...c, today: r.climateNowVs2040[c.id].today, y2040: r.climateNowVs2040[c.id].y2040 })),
    // One list per card; a card shows its tag only when its list is not empty.
    placeholders: {
      stress: [{ labelKey: 'risksScreen.ph.stress', slots: waitingFor(FEEDS.risk.stress, ph) }].filter((x) => x.slots.length),
      erosion: [{ labelKey: 'risksScreen.ph.erosion', slots: waitingFor(FEEDS.risk.erosion, ph) }].filter((x) => x.slots.length),
      climate: [{ labelKey: 'risksScreen.ph.climate', slots: waitingFor(FEEDS.risk.climate, ph) }].filter((x) => x.slots.length),
    },
  };
}
