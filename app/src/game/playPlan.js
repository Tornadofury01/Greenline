// "Play this plan": hands one v2 option from the Plans / Compare cards to the Farm game, and turns it into the
// simulator's choices. Small and React-free so the Plans screen can import it without loading the game.
// The plan is kept in memory only (not saved, not in the URL).
import { PLANT_SHIFT_DAYS } from '@scoring/v2/constants.js';

let pending = null;
export const setPlayPlan = (option) => { pending = option ?? null; };
export const hasPlayPlan = () => pending != null;
/** Read and clear the plan waiting for the game (null when there is none). */
export const takePlayPlan = () => { const p = pending; pending = null; return p; };

const CASH = new Set(['winter_wheat', 'corn', 'grain_sorghum', 'cotton', 'soybeans', 'sunflower', 'sesame', 'alfalfa', 'fallow']);
const COVER = new Set(['cereal_rye', 'crimson_clover', 'hairy_vetch']);

/**
 * v2 option ({ sequence, management }) -> { crops: [{ main, cover }], controls, nitrogenScale, notes[] }.
 * Each year keeps its first cash crop and its first cover (the game has one crop + one winter cover per year).
 * Notes list what could not be carried over (double crop, covers the game does not offer); they are shown to the farmer.
 */
export function planToSim(option) {
  const notes = new Set();
  const crops = option.sequence.map((y) => {
    const cash = y.crops.filter((c) => c.role === 'cash' || c.role === 'fallow');
    const covers = y.crops.filter((c) => c.role === 'cover');
    if (cash.length > 1) notes.add('doubleCrop');
    if (covers.some((c) => !COVER.has(c.crop))) notes.add('cover');
    const main = cash.find((c) => CASH.has(c.crop))?.crop ?? 'fallow';
    const cover = covers.find((c) => COVER.has(c.crop))?.crop ?? null;
    return { main, cover };
  });
  const m = option.management ?? {};
  if (m.maturity && m.maturity !== 'full') notes.add('maturity');
  if (m.coverTermination && m.coverTermination !== 'at-planting') notes.add('termination');
  const controls = {
    tillage: m.tillage ?? 'reduced',
    // The precompute runs "default" N (library rate x nitrogenScale); the number on the card is only an average.
    nitrogen: 'default',
    irrigation: m.irrigation ?? 'none',
    shiftDays: PLANT_SHIFT_DAYS[m.plantingDate] ?? 0,
    maturity: 'full',
    termination: 'at-planting',
  };
  return { crops, controls, nitrogenScale: m.nitrogenScale ?? 1, notes: [...notes] };
}
