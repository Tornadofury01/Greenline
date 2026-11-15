// Plans: what the engine is asked to simulate. The shape is the contract's Option (docs/v2-data-contract.md section 2.2):
//   { id, name, sequence: [{ year: 1..n, crops: [{ crop, role, plantDoy, endDoy, plantYearOffset }] }], management: {...} }
// The sequence repeats when the run is longer than the rotation. Calendar year of rotation year k = startYear + k - 1.
// plantYearOffset -1 means "planted the autumn before the harvest year" (winter wheat, rye, clover, vetch, alfalfa).
import { dayNumber, daysInYear } from './weather.js';

export const DEFAULT_MANAGEMENT = {
  tillage: 'conventional',          // conventional | reduced | no-till
  nitrogenLbPerAcre: 'default',     // number (the same lb N/acre for every cash crop), or 'default' = the library's extension rate for each crop
  nitrogenScale: 1,                 // multiplies the library rate when nitrogenLbPerAcre is 'default' (the optimizer's N-rate knob; 0 = none)
  irrigation: 'none',               // none | limited | full
  maturity: 'full',                 // full | short (scales the heat sum by days short / days full)
  coverTermination: 'at-planting',  // at-planting (the plan's end date) | early (14 days earlier, saves water) | none
  supportPractice: 1,               // RUSLE P factor (1 = none; contour about 0.6-0.9)
};
export const COVER_EARLY_DAYS = 14;

const libById = (library) => (library.crops ? Object.fromEntries(library.crops.map((c) => [c.id, c])) : library);

/** Problems (must fix) and warnings (allowed, shown) for a plan. */
export function validatePlan(plan, library) {
  const lib = libById(library);
  const problems = [], warnings = [];
  if (!plan || !Array.isArray(plan.sequence) || !plan.sequence.length) return { problems: ['plan.sequence must be a non-empty array'], warnings };
  plan.sequence.forEach((yr, i) => {
    if (!Array.isArray(yr.crops)) { problems.push(`sequence[${i}].crops must be an array`); return; }
    for (const c of yr.crops) {
      const def = lib[c.crop];
      if (!def) { warnings.push(`sequence[${i}]: crop "${c.crop}" is not in the library: treated as fallow`); continue; }
      if (def.kind === 'fallow') continue;
      if (!Number.isInteger(c.plantDoy) || c.plantDoy < 1 || c.plantDoy > 366 || !Number.isInteger(c.endDoy) || c.endDoy < 1 || c.endDoy > 366) problems.push(`sequence[${i}] ${c.crop}: plantDoy and endDoy must be 1-366`);
      else {
        const w = def.plantingWindow;
        if (w && (c.plantDoy < w.earliestDoy - 14 || c.plantDoy > w.latestDoy + 14)) warnings.push(`sequence[${i}] ${c.crop}: planting day ${c.plantDoy} is outside the usual window ${w.earliestDoy}-${w.latestDoy}`);
      }
    }
  });
  return { problems, warnings };
}

/**
 * The CURRENT rotation from the model slots: crop per year from slot A, calendars from slot A's cropDates.
 * `years` = calendar years to cover (e.g. [2020, 2021, 2022]); rotation year k is years[k-1].
 * A crop that has no calendar or is not in the library ('other', unknown) is simulated as a fallow year and flagged.
 */
export function planFromSlots(slots, library, { years, management = {} } = {}) {
  const lib = libById(library);
  const A = slots.A ?? slots.slots?.A;
  const byYear = new Map(A.cropByYear.map((r) => [r.year, r]));
  const sequence = years.map((year, i) => {
    const r = byYear.get(year);
    const def = r && lib[r.crop];
    const cal = r && A.cropDates[r.crop];
    if (!r || !def || def.kind === 'fallow' || !cal) {
      return { year: i + 1, crops: [{ crop: 'fallow', role: 'fallow', plantDoy: 1, endDoy: daysInYear(year), plantYearOffset: 0, unknownCrop: !!r && r.crop !== 'fallow', sourceCrop: r?.crop ?? null }] };
    }
    return { year: i + 1, crops: [{ crop: r.crop, role: def.kind, plantDoy: cal.plantDoy, endDoy: cal.endDoy, plantYearOffset: cal.plantYearOffset }] };
  });
  return { id: 'current', kind: 'current', name: { key: 'v2.option.current', params: {} }, startYear: years[0], sequence, management: { ...DEFAULT_MANAGEMENT, ...management } };
}

/**
 * Turn the plan into dated episodes {crop, role, plantDay, endDay, harvestYear}, in time order.
 * Overlaps: the earlier crop is ended the day before the later one is planted (event kept in `notes`).
 * A perennial (alfalfa) that continues from the previous year is one episode.
 */
export function buildEpisodes(plan, library, { startYear, years }) {
  const lib = libById(library);
  const n = plan.sequence.length;
  const mgmt = { ...DEFAULT_MANAGEMENT, ...(plan.management ?? {}) };
  const raw = [];
  for (let i = 0; i < years; i++) {
    const year = startYear + i;
    const yr = plan.sequence[i % n];
    for (const c of yr.crops) {
      const def = lib[c.crop];
      const fallow = !def || def.kind === 'fallow';
      const id = fallow ? 'fallow' : c.crop;
      let plantDay = dayNumber(year + (fallow ? 0 : (c.plantYearOffset ?? 0)), fallow ? (c.plantDoy ?? 1) : c.plantDoy);
      let endDay = dayNumber(year, fallow ? (c.endDoy ?? daysInYear(year)) : c.endDoy);
      if (!fallow && def.kind === 'cover' && mgmt.coverTermination === 'early') endDay -= COVER_EARLY_DAYS;
      if (endDay < plantDay) endDay = plantDay; // a one-day episode is harmless; validatePlan warns about odd dates
      raw.push({ crop: id, role: fallow ? 'fallow' : def.kind, plantDay, endDay, year, notes: [], unknownCrop: !!c.unknownCrop });
    }
  }
  raw.sort((a, b) => a.plantDay - b.plantDay || a.endDay - b.endDay);
  const out = [];
  for (const e of raw) {
    const prev = out[out.length - 1];
    if (prev && prev.crop === e.crop && lib[e.crop]?.season?.perennial && e.plantDay <= prev.endDay + 1) { prev.endDay = Math.max(prev.endDay, e.endDay); prev.year = e.year; continue; }
    if (prev && e.plantDay <= prev.endDay) { prev.endDay = e.plantDay - 1; prev.notes.push('ended early: next crop planted'); if (prev.endDay < prev.plantDay) prev.endDay = prev.plantDay; }
    out.push(e);
  }
  return out;
}
