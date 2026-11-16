// Farm game rules that are not drawing and not React: the 4 plots, what the toolbar may set, planned setup costs,
// the rotation structure for the disease check, challenges and stars. Pure JavaScript.
// Every number here is either read from the engine's results or is a game setting (budget, years) that is named as such.
// Setup costs are not computed here: they come from the engine's ledger (gameWorker.js setupOf, runSource.js setupCosts).
import library from '@content/crop-library.json';
import { PEST_TABLE } from '@scoring/engine/pests.js';
import { orderedCrops } from '@scoring/v2/fitChecks.js';
import { DISEASE_SERIOUS_LOSS } from '@scoring/v2/constants.js';

export const YEARS = 5;
export const PLOTS = 4;
/** Game setting: coins each plot starts with ($ per acre). Covers one season of corn setup with room to spare. */
export const BUDGET_PER_PLOT = 300;
export const TILLAGE = ['conventional', 'reduced', 'no-till'];
/** Fertilizer levels = the engine's own nitrogen setting: "default" (the crop library rate) times nitrogenScale. */
export const FERT = { low: 0.5, med: 1, high: 1.5 };
export const IRRIGATION = ['none', 'limited', 'full'];

const lib = Object.fromEntries(library.crops.map((c) => [c.id, c]));
export const libById = lib;

export const fertOf = (scale) => Object.entries(FERT).reduce((best, [k, v]) => (Math.abs(v - scale) < Math.abs(FERT[best] - scale) ? k : best), 'med');

export function emptyPlot(id, tillage = 'reduced') {
  return { id, crops: Array(YEARS).fill(null), controls: { tillage, nScale: 1, irrigation: 'none' }, from: null };
}

/** Fill a plot's 5 years from a crop list (repeats the list) and controls. */
export function fillPlot(plot, crops, controls, from) {
  return { ...plot, crops: Array.from({ length: YEARS }, (_, i) => ({ ...crops[i % crops.length] })), controls: { ...plot.controls, ...controls }, from };
}

/** The crops a plot runs for the first k+1 years (an unseeded year is fallow). */
export const cropsUpTo = (plot, k) => Array.from({ length: k + 1 }, (_, i) => ({ cover: null, ...plot.crops[i], main: plot.crops[i]?.main ?? 'fallow' }));

/** Engine ledger items the game deducts when a season starts (the rest comes off on its own day). */
export const isSetupItem = (item) => /^(plant:|fertilizer-N:|tillage:pre-plant|tillage:fallow|no-till-planter|fallow:weed-control)/.test(item);

const fam = (crop) => (lib[crop]?.family === 'other' ? crop : lib[crop]?.family ?? crop);

/**
 * Rotation structure for the disease check and the pest score, for the years PLAYED so far, in time order and without
 * wrapping around. scoring/v2 structureOf() treats a plan as a loop (it was built for repeating rotations), so after one
 * played year it compared the crop with itself and always warned. Here year 1 is compared with the field's last real crop
 * (USDA CDL, model slot A) when there is one, and with nothing otherwise. Same fields and rules as structureOf().
 */
export function playedStructure(plan, prevCrop) {
  const played = orderedCrops(plan).filter((c) => c.role !== 'fallow');
  const all = prevCrop && lib[prevCrop] && lib[prevCrop].kind === 'cash' ? [{ crop: prevCrop, role: 'cash', prev: true }, ...played] : played;
  const cashAll = all.filter((c) => c.role === 'cash');
  const cash = played.filter((c) => c.role === 'cash').map((c) => c.crop);
  const familyRepeats = [];
  for (let i = 0; i + 1 < cashAll.length; i++) {
    const a = cashAll[i].crop, b = cashAll[i + 1].crop;
    if (fam(a) === fam(b)) familyRepeats.push({ crop: a, nextCrop: b });
  }
  const sharedHosts = [];
  let greenBridge = null, minorBridge = null;
  for (let i = 0; i + 1 < all.length; i++) {
    const a = all[i], b = all[i + 1];
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
  return {
    cash, familyRepeats, familyRepeatShare: cash.length ? familyRepeats.length / cash.length : 0, sharedHosts, greenBridge, minorBridge,
    usesLegume: played.some((c) => lib[c.crop]?.family === 'legume'), hasCover: played.some((c) => c.role === 'cover'), crops: [...new Set(played.map((c) => c.crop))],
    comparedWithPrev: all[0]?.prev ? prevCrop : null,
  };
}

// ------------------------------------------------------------------------------------------------ challenges
/** Weather years are fixed real past years on this field, so a challenge is the same for everyone. Free play draws 5 at random. */
export const CHALLENGES = [
  { id: 'drought', years: [2009, 2010, 2011, 2012, 2013] },
  { id: 'soil', years: [2015, 2016, 2017, 2018, 2019] },
  { id: 'beat', years: [2019, 2020, 2021, 2022, 2023] },
];

/**
 * Stars (0-3) for a finished game, from the engine's results only.
 * plots: [{ moneyTotal, seasons: [{ erosion, toleranceT, money }], somStart, somEnd, scores }], today: same shape (hidden run), outOfMoney.
 */
export function starsFor(id, plots, today, { outOfMoney, coinsEnd, coinsStart }) {
  if (!plots?.length) return 0;
  const underT = (p) => p.seasons.every((s) => s.erosion != null && s.erosion <= s.toleranceT);
  if (id === 'drought') {
    if (outOfMoney) return 0;
    let n = 1;
    if (coinsEnd > coinsStart) n++;
    if (today && plots.some((p) => p.moneyTotal > today.moneyTotal)) n++;
    return n;
  }
  if (id === 'soil') {
    const avgUnder = plots.some((p) => p.seasons.reduce((a, s) => a + (s.erosion ?? 0), 0) / p.seasons.length <= p.seasons[0].toleranceT);
    if (!avgUnder) return 0;
    let n = 1;
    if (plots.some(underT)) n++;
    if (plots.some((p) => underT(p) && p.somEnd >= p.somStart)) n++;
    return n;
  }
  if (id === 'beat') {
    if (!today) return 0;
    const money = plots.filter((p) => p.moneyTotal > today.moneyTotal);
    if (!money.length) return 0;
    const soil = money.filter((p) => p.scores.soil.value > today.scores.soil.value);
    if (!soil.length) return 1;
    return soil.some((p) => p.scores.water.value > today.scores.water.value) ? 3 : 2;
  }
  return 0;
}

const STAR_KEY = 'greenline.game.stars';
/** Best stars per challenge, kept on this device only. */
export function loadStars() {
  try { return JSON.parse(localStorage.getItem(STAR_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
export function saveStars(id, n) {
  try {
    const s = loadStars();
    if (!(s[id] >= n)) { s[id] = n; localStorage.setItem(STAR_KEY, JSON.stringify(s)); }
    return s;
  } catch { return loadStars(); }
}
