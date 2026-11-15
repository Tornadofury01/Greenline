// Named constants of the v2 option builder, fit checks, optimizer, scores and confidence.
// Every number that is not a crop value or a field value lives here. "To confirm with an agronomist" = a modelling choice taken
// from docs/fieldshift-v2.md (the plan's thresholds) or a rounded estimate; none of these is verified.

export const V2_ENGINE_VERSION = 'v2-0.1';

// ---- simulated seasons ------------------------------------------------------------------------------------------
export const SIM_START_YEAR = 1985;      // the plan: "all 40 past seasons" (field files hold weather from 1985)
export const SIM_YEARS = 41;             // 1985-2025. The first and last calendar year are left out of the money statistics (edge years)
export const SEARCH_START_YEAR = 2008;   // the optimizer and the screening use the 18 seasons with real monthly weather (faster)
export const SEARCH_YEARS = 18;
export const SCREEN_START_YEAR = 2014;  // the first screening of all candidates uses only the 12 Landsat 8/9 era seasons (faster; the ranking only decides who gets optimized)
export const SCREEN_YEARS = 12;
export const CURRENT_ROTATION_YEARS = 3; // the current rotation = the last 3 years with a crop the library knows (docs/v2-data-contract.md)

// ---- option generator -------------------------------------------------------------------------------------------
export const MAX_OPTIONS = 30;           // the plan: up to 30 options plus the current one
export const CANDIDATE_POOL_MAX = 36;    // candidates sent to the optimizer (some will fail a fit check or duplicate another)
export const MIN_GAP_DAYS = 7;           // minimum days between one crop's end and the next planting (rotation rule, to confirm with an agronomist)
export const MIN_COVER_DAYS = 60;        // a cover crop shorter than this is not worth its seed (estimate)
export const COVER_WINDOW_TOLERANCE_DAYS = 10; // a cover may be planted this much outside the library's planting window
export const DOUBLE_CROP_GAP_DAYS = 7;   // days between the wheat harvest and planting the second crop
export const DOUBLE_CROP_DRYDOWN_DAYS = 15; // days from maturity to harvest for the second crop (estimate)
export const DOUBLE_CROP_LAST_END_DOY = 320; // the second crop must be harvested by this day of year (before the hard freeze, to confirm)
export const DOUBLE_CROP_CHOICES = ['soybeans', 'grain_sorghum']; // second crops tried after wheat, in order
export const CASH_CROPS_FOR_ROTATIONS = ['winter_wheat', 'corn', 'grain_sorghum', 'cotton', 'soybeans', 'sunflower', 'sesame']; // alfalfa (multi-year stand) is not built into rotations in this version
export const COVER_PLANS = {
  legume: { winter: ['hairy_vetch', 'crimson_clover'], summer: ['cowpea'] },
  grass: { winter: ['cereal_rye'], summer: ['sorghum_sudangrass'] },
};
export const SCREEN_GDD_SHARE = 0.85;    // a crop passes the climate screen if the heat available between its usual dates is >= 85 % of what it needs (to confirm)

// ---- management choices the optimizer tries ---------------------------------------------------------------------
export const PLANT_SHIFT_DAYS = { early: -10, normal: 0, late: 10 }; // planting date choices (estimate, kept inside the library's window)
export const N_SCALES = [1, 0.75, 0.5, 0];  // share of the extension N rate (the plan: "4-6 rates from none to the full rate"); rates above 1 are never tried
export const TILLAGE_CHOICES = ['conventional', 'reduced', 'no-till'];
export const COVER_TERMINATIONS = ['at-planting', 'early'];
export const IRRIGATION_CHOICES = ['none', 'limited', 'full'];
export const OPTIMIZER_PASSES = 1;          // coordinate-descent passes over the choices (one pass, nitrogen last because it depends on the others; two passes cost 40 % more time)
export const OPTIMIZER_MIN_GAIN_USD = 1;    // a change must raise the median return by at least this to be kept ($/acre/year)

// ---- the goal and its limits (plan: "The goal it optimizes") ------------------------------------------------------
export const RISK_LIMIT_SLACK_USD = 0;      // worst-10% result must be no worse than the current rotation's (the plan's default), minus this slack
export const SOIL_LIMIT_FACTOR = 1;         // mean erosion must stay <= this x the soil's tolerance T
export const WORST_SEASONS_SHARE = 0.10;    // "worst 10% of seasons"

// ---- fit checks: thresholds (the plan: "Thresholds to confirm with an agronomist") --------------------------------
export const WATER_SHORT_SHARE = 0.30;      // the next cash crop "starts short of water" when the 1 m profile holds less than 30 % of its plant-available water at planting (estimate)
export const WATER_FAIL_YEARS = 0.25;       // fail: short in more than 1 year in 4
export const WATER_WARN_YEARS = 0.10;       // warn: 1 year in 10 to 1 in 4
export const WATER_EXTRA_VS_CURRENT = 0.05; // the water check only fails/warns an option that is also worse than the current rotation by this share (water cost is relative to current)
export const SEASON_FAIL_YEARS = 0.20;      // fail: does not finish before the next crop or frost in more than 1 year in 5
export const SEASON_WARN_YEARS = 0.10;      // warn: tight timing, 1 year in 10 or more
export const SEASON_DONE_STAGE = 0.95;      // a crop "finished" when it reached this share of its heat sum before it was harvested or ended
export const DISEASE_SERIOUS_LOSS = 0.15;   // a pest that can take >= 15 % of a crop counts as serious (PEST_TABLE maxLoss)
export const DISEASE_WEATHER_RISE = 1.25;   // warn when weather-driven pest loss in 2040 is >= 1.25 x today's
export const MARKET_FAIL_FIELD_SHARE = 0.01;// fail: under 1 % of the study fields grew it in the last 8 years, no county yield record, no buyer entered
export const MARKET_WARN_FIELD_SHARE = 0.05;// warn: under 5 % of the study fields grew it
export const MARKET_RECENT_YEARS = 8;
export const MARKET_WEAK_PRICE_RATIO = 0.8; // warn: the latest price is under 80 % of the 10-year median price
export const WARMING_2040_C = { ssp245: 1.4, ssp585: 1.9 };   // estimate: regional mean warming of 2040 vs 1985-2015 (IPCC AR6 order of magnitude); replace with NEX-GDDP-CMIP6 when exported
export const RAIN_CHANGE_2040 = [0, -0.08];                    // estimate: rain unchanged or 8 % lower
export const CLIMATE_SCENARIOS = [
  { id: 'ssp245-rain0', warmC: WARMING_2040_C.ssp245, rain: 0 },
  { id: 'ssp245-dry', warmC: WARMING_2040_C.ssp245, rain: RAIN_CHANGE_2040[1] },
  { id: 'ssp585-rain0', warmC: WARMING_2040_C.ssp585, rain: 0 },
  { id: 'ssp585-dry', warmC: WARMING_2040_C.ssp585, rain: RAIN_CHANGE_2040[1] },
]; // simple offsets, NOT climate-model output: "climateModels.of" = number of these scenarios

// ---- what-if runs and confidence (the plan: "Uncertainty") -------------------------------------------------------
export const WHAT_IF_RUNS = 1000;
export const PRICE_CV_FALLBACK = 0.2;       // price spread when the field file has too few years of prices
export const YIELD_UNCERTAINTY = 0.10;      // each crop's simulated yield is off by up to +/- 10 % (calibration E not fitted)
export const INPUT_COST_RANGE = [0.9, 1.15];// seed, chemicals, operations cost multiplier
export const N_PRICE_CV = 0.25;
export const N_CREDIT_RANGE = [0.5, 1.5];   // legume nitrogen credit: the assumption that most often flips the pick
export const COVER_FAIL_CHANCE = 0.25;      // a cover crop fails to establish in 1 world in 4 (heavy clay, dry fall; to confirm with an agent)
export const CONF_HIGH_SHARE = 0.8;
export const CONF_MEDIUM_SHARE = 0.6;
export const CONF_CLIMATE_AGREE_SHARE = 0.75; // "under most climate scenarios"
export const CONF_NO_CURRENT_CROPS_LEVEL = 'low';  // the crop map names no crop the library knows on this field (pasture, hay, unknown): the current rotation is a guess, so confidence is capped
export const CONF_SLOT_CAPS = ['calibrationE', 'modelB']; // while any of these is a placeholder, confidence is capped at "medium"

// ---- six scores (content/v2-scores.json holds the names, weights and grade cut-offs; these map measurements to 0-100) ---
export const PROFIT_SCORE_ZERO_USD = -50;   // median return at or below this = 0
export const PROFIT_SCORE_FULL_USD = 350;   // at or above = 100 ($/acre/year above variable costs; to confirm)
export const RISK_SCALE_USD = 150;          // risk score = 50 + 50 x (worst-10% result - the current rotation's) / this
export const SOIL_EROSION_FULL_T_SHARE = 0.25; // erosion <= 0.25 x T scores 100 ...
export const SOIL_EROSION_ZERO_T_SHARE = 3;    // ... and >= 3 x T scores 0
export const SOIL_BARE_FULL_DAYS = 60;      // bare days a year: <= 60 scores 100 (same free days as the v1 erosion rule) ...
export const SOIL_BARE_ZERO_DAYS = 300;     // ... >= 300 scores 0
export const SOIL_SOM_FULL_PCT_DECADE = 0.3;   // organic matter trend (percentage points per decade): >= +0.3 scores 100 ...
export const SOIL_SOM_ZERO_PCT_DECADE = -0.3;  // ... <= -0.3 scores 0
export const SOIL_WEIGHTS = { erosion: 0.5, bare: 0.3, som: 0.2 };
export const WATER_PLANT_SHARE_ZERO = 0.2, WATER_PLANT_SHARE_FULL = 0.7; // mean water share at planting
export const WATER_SUPPLY_ZERO = 0.5, WATER_SUPPLY_FULL = 1.0;           // mean water-supply ratio of the cash crops (FAO-33 rET)
export const NUTRIENT_BOUGHT_FULL_LB = 0, NUTRIENT_BOUGHT_ZERO_LB = 150; // lb N bought per acre per year
export const NUTRIENT_BALANCE_ZERO_LB = -60;                             // mining the soil by 60 lb N/acre/year scores 0 on balance
export const NUTRIENT_WEIGHTS = { bought: 0.6, balance: 0.4 };
export const PEST_LOSS_ZERO = 0.15;         // mean simulated pest loss of the cash crops: 0 = 100, >= 15 % = 0
export const PEST_FAMILY_REPEAT_PENALTY = 20;   // points off for the share of year-pairs that repeat a family
export const PEST_BRIDGE_PENALTY = 25;      // points off when a cover is a green bridge for the next cash crop's pest
export const REASON_MIN_DELTA = 8;          // a score reason is "up" or "down" when it moves the score by this much from 50

// ---- check locally ----------------------------------------------------------------------------------------------
export const NEIGHBOR_RADIUS_MILES = 20;

// ---- fixed costs (shown, never scored: the same for every option) ---------------------------------------------------------
export const FIXED_COSTS_USD_PER_ACRE = { rent: 50, ownership: 40 }; // PLACEHOLDER, NOT sourced: replace with NASS cash rents and AgriLife budget ownership costs
