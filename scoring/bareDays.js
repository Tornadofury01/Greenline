// BARE DAYS PER ROTATION: roughly how many days a year the soil sits exposed under this rotation.
//
// Each crop has `bareShare[12]` in crops.json: the chance the ground is bare in each month when that crop is the
// main crop (measured from satellites for corn, cotton, sorghum and wheat; estimated for the rest).
//   1. Every non-cover crop (cash crop, perennial, fallow) is one year of the rotation.
//   2. A cover crop joins the year of the cash crop just before it (or just after, if it comes first).
//      The ground is bare only if BOTH are bare, so the chance is bareShare(cash) x bareShare(cover).
//   3. If a rotation is only cover crops, each one is its own year.
//   4. Field calibration: for corn, cotton, sorghum and wheat, the field's own satellite months (Landsat cover +
//      CDL crop, 2013 on) are blended with the regional pattern. k clear field-years count k / (k + PRIOR) of the blend.
//      Fallow and the estimated crops always use the regional/estimated pattern.
//   5. bare days = sum over months of chance of bare x days in that month, averaged over the rotation's years.
//   Cover crops assume they establish (coverEstablished = 1). A dry fall can stop them, so a drought replay passes
//   0.5: a cover crop then removes only half of the bare chance it normally removes (scoreRotation does this).
// It is an estimate, not a measurement. 2013+ is used because Landsat 5/7 and 8/9 aren't harmonized yet.
import { avg } from './rules/helpers.js';

const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const PRIOR = 2;         // the regional pattern counts like 2 field-years
const MIN_YEARS = 2;     // need at least this many clear years of the crop on the field to use its own record
const FROM_YEAR = 2013;  // Landsat 8/9 era (see above)
const CAL_CROPS = ['corn', 'cotton', 'grain_sorghum', 'winter_wheat']; // crops the CDL history can calibrate

// The field's own bare share per month for one crop: { share: number[12|null], years } or null.
export function fieldBareShare(field, cropId) {
  if (!CAL_CROPS.includes(cropId) || !field?.coverYearly || !field.cropHistory) return null;
  const cover = Object.fromEntries(field.coverYearly.map((c) => [c.year, c.months]));
  const grown = field.cropHistory.filter((h) => h.crop === cropId && h.year >= FROM_YEAR && cover[h.year]);
  if (grown.length < MIN_YEARS) return null;
  const share = Array.from({ length: 12 }, (_, m) => {
    const seen = grown.map((h) => cover[h.year][m]).filter(Boolean); // cloudy months are null
    return seen.length ? seen.filter((s) => s === 'bare').length / seen.length : null;
  });
  return { share, years: grown.length };
}

// Regional pattern blended with the field's own record (when it has one).
function monthsFor(crop, field, calibrated) {
  const own = fieldBareShare(field, crop.id);
  if (!own) return crop.bareShare;
  calibrated.set(crop.id, own.years);
  const w = own.years / (own.years + PRIOR);
  return crop.bareShare.map((p, m) => (own.share[m] == null ? p : w * own.share[m] + (1 - w) * p));
}

// rotation crops (library objects, in order) -> list of years, each a list of bareShare arrays to combine
function groupYears(crops) {
  const cash = crops.map((c, i) => (c.coverCrop ? null : i)).filter((i) => i != null);
  if (!cash.length) return crops.map((c) => [c]);
  const years = cash.map((i) => [crops[i]]);
  crops.forEach((c, i) => {
    if (!c.coverCrop) return;
    const before = cash.filter((j) => j < i);
    years[before.length ? before.length - 1 : 0].push(c); // after the cash crop it follows, else the first year
  });
  return years;
}

// Returns { bareDays (per year), bareMonths: number[12] (average chance bare), calibrated: [{ crop, years }] }
export function estimateBareDays(crops, field, { coverEstablished = 1 } = {}) {
  const calibrated = new Map();
  const perYear = groupYears(crops).map((group) => {
    const shares = group.map((c) => {
      const s = monthsFor(c, field, calibrated);
      // partly established cover: only a fraction of its protection happens
      return c.coverCrop && coverEstablished < 1 ? s.map((p) => 1 - coverEstablished * (1 - p)) : s;
    });
    return Array.from({ length: 12 }, (_, m) => shares.reduce((p, s) => p * s[m], 1)); // bare only if all are bare
  });
  const bareMonths = Array.from({ length: 12 }, (_, m) => avg(perYear.map((y) => y[m])));
  const bareDays = Math.round(bareMonths.reduce((sum, p, m) => sum + p * DAYS[m], 0));
  return {
    bareDays,
    bareMonths: bareMonths.map((p) => Math.round(p * 100) / 100),
    calibrated: [...calibrated].map(([crop, years]) => ({ crop, years })),
    // crops whose calendar is an estimate, not measured (crops.json `estimates`)
    estimated: [...new Set(crops.filter((c) => c.estimates?.includes('bareShare')).map((c) => c.id))],
  };
}
