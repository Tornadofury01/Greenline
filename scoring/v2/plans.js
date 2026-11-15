// Turns an option SPEC (which crops, in which order, which covers) plus MANAGEMENT choices into a plan the engine can run.
//
//   spec = { id, mains: [{ crop, second? }], covers: [coverCropId | null] }
//     mains[j]  = the cash crop of rotation year j (0-based); `second` = the double crop that may follow it (used only when
//                 management.doubleCrop is true)
//     covers[j] = a cover crop planted in the gap after rotation year j's last crop (before mains[j + 1])
//   management = { plantingDate, nitrogenScale, maturity, coverTermination, doubleCrop, tillage, irrigation }
//
// All dates are worked out on one absolute timeline (day = year index x 365 + day of year) so that a winter crop planted in autumn,
// a cover crop that fits between two cash crops and the "minimum gap" rule all use the same arithmetic. The plan's sequence follows
// the contract (docs/v2-data-contract.md 2.2): rotation year k lists the crops that END in year k, with plantYearOffset -1 when
// they were planted the autumn before.
import {
  MIN_GAP_DAYS, MIN_COVER_DAYS, COVER_WINDOW_TOLERANCE_DAYS, DOUBLE_CROP_GAP_DAYS, DOUBLE_CROP_DRYDOWN_DAYS, DOUBLE_CROP_LAST_END_DOY,
  PLANT_SHIFT_DAYS,
} from './constants.js';
import { COVER_EARLY_DAYS } from '../engine/plan.js';

const DAY = 365;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export const DEFAULT_CHOICES = Object.freeze({
  plantingDate: 'normal', nitrogenScale: 1, maturity: 'full', coverTermination: 'at-planting', doubleCrop: false, tillage: 'conventional', irrigation: 'none',
});

/** Is this crop a winter-type cover (planted in autumn, ends in spring)? Read from its calendar. */
const isWinterType = (cal) => cal.plantYearOffset === -1;

/**
 * @param spec the option spec  @param choices management choices (see DEFAULT_CHOICES)
 * @param ctx { lib: {id: record}, calendars: slot A cropDates }
 * @returns { plan, applied: { covers: bool[], seconds: bool[] }, problems: string[] }  `problems` non-empty = the plan cannot be run (overlap)
 */
export function materialize(spec, choices, ctx) {
  const c = { ...DEFAULT_CHOICES, ...choices };
  const { lib, calendars } = ctx;
  const n = spec.mains.length;
  const problems = [];
  const shift = PLANT_SHIFT_DAYS[c.plantingDate] ?? 0;
  const mainAt = (p) => {
    const crop = spec.mains[p % n].crop, def = lib[crop], cal = calendars[crop];
    const w = def.plantingWindow;
    const plantDoy = clamp(cal.plantDoy + shift, w.earliestDoy, w.latestDoy);
    const dtm = def.season.daysToMaturity;
    const earlier = c.maturity === 'short' && dtm ? dtm.full - dtm.short : 0;
    const base = p * DAY;
    return { crop, role: def.kind, plantAbs: base + plantDoy + cal.plantYearOffset * DAY, endAbs: base + cal.endDoy - earlier, tag: 'main' };
  };

  const items = [];
  const applied = { covers: Array(n).fill(false), seconds: Array(n).fill(false) };
  let prevEnd = -Infinity;
  for (let p = 0; p < n; p++) {
    const m = mainAt(p);
    if (m.plantAbs < prevEnd + MIN_GAP_DAYS) problems.push(`year ${p + 1}: ${m.crop} is planted before the previous crop is done`);
    items.push(m);
    prevEnd = m.endAbs;
    const next = mainAt(p + 1);
    // double crop after the main crop
    const secondId = spec.mains[p].second;
    if (c.doubleCrop && secondId && lib[secondId]) {
      const def = lib[secondId], dtm = def.season.daysToMaturity;
      const plantAbs = prevEnd + DOUBLE_CROP_GAP_DAYS;
      const endAbs = plantAbs + (dtm ? dtm[c.maturity === 'short' ? 'short' : 'full'] : 100) + DOUBLE_CROP_DRYDOWN_DAYS;
      if (endAbs <= p * DAY + DOUBLE_CROP_LAST_END_DOY && endAbs + MIN_GAP_DAYS <= next.plantAbs) {
        items.push({ crop: secondId, role: 'cash', plantAbs, endAbs, tag: 'second' });
        applied.seconds[p] = true;
        prevEnd = endAbs;
      }
    }
    // cover crop in the gap before the next main crop
    const coverId = c.coverTermination === 'none' ? null : spec.covers[p];
    if (coverId && lib[coverId] && calendars[coverId]) {
      const cal = calendars[coverId], def = lib[coverId], base = p * DAY;
      const calPlant = base + cal.plantDoy, calEnd = base + (isWinterType(cal) ? DAY : 0) + cal.endDoy;
      const plantAbs = Math.max(calPlant, prevEnd + MIN_GAP_DAYS);
      const endAbs = Math.min(calEnd, next.plantAbs - MIN_GAP_DAYS);
      const plantDoyIn = plantAbs - base;
      const w = def.plantingWindow;
      const growDays = endAbs - plantAbs - (c.coverTermination === 'early' ? COVER_EARLY_DAYS : 0);
      const inWindow = !w || (plantDoyIn >= w.earliestDoy - COVER_WINDOW_TOLERANCE_DAYS && plantDoyIn <= w.latestDoy + COVER_WINDOW_TOLERANCE_DAYS);
      if (inWindow && growDays >= MIN_COVER_DAYS) {
        items.push({ crop: coverId, role: 'cover', plantAbs, endAbs, tag: 'cover' });
        applied.covers[p] = true;
      }
    }
  }
  // the wrap: the first crop of the next cycle must also clear what the last position ended with
  const wrap = mainAt(n);
  if (wrap.plantAbs < prevEnd + MIN_GAP_DAYS) problems.push('the last crop of the cycle ends too late for the first crop of the next cycle');

  // rotation years: a crop belongs to the rotation year in which it ends
  const years = Array.from({ length: n }, (_, i) => ({ year: i + 1, crops: [] }));
  for (const it of items) {
    const e = Math.floor((it.endAbs - 1) / DAY);
    const plantYear = Math.floor((it.plantAbs - 1) / DAY);
    const offset = plantYear - e;
    if (offset < -1) { problems.push(`${it.crop}: planted more than one calendar year before it ends`); continue; }
    const r = ((e % n) + n) % n;
    years[r].crops.push({
      crop: it.crop, role: it.role, plantDoy: it.plantAbs - plantYear * DAY, endDoy: it.endAbs - e * DAY, plantYearOffset: offset, _t: it.plantAbs,
    });
  }
  for (const y of years) { y.crops.sort((a, b) => a._t - b._t); for (const cr of y.crops) delete cr._t; }
  const hasCover = items.some((i) => i.tag === 'cover');
  const management = {
    plantingDate: c.plantingDate, nitrogenLbPerAcre: 'default', nitrogenScale: c.nitrogenScale, maturity: c.maturity,
    coverTermination: hasCover ? c.coverTermination : 'none', doubleCrop: items.some((i) => i.tag === 'second'),
    tillage: c.tillage, irrigation: c.irrigation, supportPractice: 1,
  };
  const engineMgmt = { ...management, coverTermination: hasCover ? c.coverTermination : 'at-planting' };
  return {
    plan: { id: spec.id, kind: 'generated', name: nameOf(spec, applied), sequence: years, management: engineMgmt },
    contractManagement: management,
    applied, problems,
  };
}

/** Option name as i18n key + params (crop ids; the app turns them into words). */
export function nameOf(spec, applied) {
  const cash = spec.mains.map((m, j) => (applied?.seconds[j] ? [m.crop, m.second] : [m.crop])).flat();
  const covers = [...new Set(spec.covers.filter((cv, j) => cv && (!applied || applied.covers[j])))];
  return { key: covers.length ? 'v2.option.rotationWithCover' : 'v2.option.rotation', params: { crops: spec.mains.map((m) => m.crop), covers, doubleCrop: applied ? applied.seconds.some(Boolean) : false, cashAll: cash } };
}
