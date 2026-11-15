// Public entry of the v2 daily engine (pure JavaScript; the app and Node import the same files).
export { ENGINE_VERSION } from './constants.js';
export { createSimulation, runSimulation, pricesFromField } from './simulator.js';
export { makeWeather, makeWeatherFromDaily, yearsOfType, extraterrestrialMm, hargreavesET0, dayNumber, isoOfDayNumber, daysInYear } from './weather.js';
export { planFromSlots, validatePlan, buildEpisodes, DEFAULT_MANAGEMENT } from './plan.js';
export { lsFactor, makeSoil } from './soilWater.js';
export { PEST_TABLE, PEST_IDS } from './pests.js';
