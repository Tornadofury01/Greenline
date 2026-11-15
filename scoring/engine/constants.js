// Named constants of the daily engine. Every number that is not a crop value or a field value lives here,
// with what it is and where it comes from. "Estimate" = a rounded modelling choice, to confirm with an agronomist.
// Units: mm, deg C, lb/acre, tons/acre, US dollars. Soil water is "mm above wilting point".

export const ENGINE_VERSION = 'engine-0.1';

// ---- soil profile (three layers down to 1 m, the depth SSURGO gives us: field.soil.waterStorage100Cm) ------
export const LAYER_THICKNESS_M = [0.3, 0.3, 0.4];          // top layer also supplies soil evaporation
export const SATURATION_OVER_FC = 0.25;                      // estimate: water above field capacity a layer can hold = 25 % of its plant-available capacity
export const DRAIN_FRACTION_BY_HSG = { A: 0.5, B: 0.35, C: 0.2, D: 0.1 }; // estimate: share of the water above field capacity that drains each day, by SSURGO hydrologic group (D = clay, slow)
export const CURVE_NUMBER_BY_HSG = { A: 67, B: 78, C: 85, D: 89 };       // USDA NRCS TR-55 / NEH-4 table, row crops, straight row, good condition (CN2)
export const CN_RESIDUE_CREDIT = 4;                          // CN points removed with full residue cover (NRCS NEH-4 treatment-and-cover classes, estimate)
export const CN_MAX = 98;
export const RUNOFF_INITIAL_ABSTRACTION = 0.2;               // TR-55 standard Ia = 0.2 S
export const EVAP_MAX_COEFF = 1.1;                           // FAO-56 / AquaCrop: Kex, soil evaporation of bare wet soil as a share of ET0
export const EVAP_MULCH_MAX_CUT = 0.5;                       // AquaCrop: residue mulch cuts soil evaporation by up to 50 %
export const KR_FULL_SHARE = 0.6;                            // evaporation stays at its maximum while the top layer holds >= 60 % of its capacity, then falls to 0 (two-stage evaporation, simplified)
export const EVAP_TEW_MM = 25;                               // total evaporable water of the top ~10 cm (FAO-56 Table 19: clay 20-30 mm)
export const MIN_ROOT_DEPTH_M = 0.15;

// ---- crop growth ------------------------------------------------------------------------------------------------
export const GDD_UPPER_CUTOFF_C = 30;                        // daily maximum temperature is capped here when counting growing degree days
export const BIOMASS_G_M2_TO_LB_AC = 8.922;                  // 1 g/m2 = 8.922 lb/acre
export const CANOPY_STRESS_LOSS = 0.03;                      // daily canopy-health loss per unit of (1 - Ks) in the growing phase (estimate, AquaCrop-style canopy expansion stress)
export const CANOPY_HEALTH_RECOVERY = 0.004;                 // daily recovery when not stressed (estimate)
export const CANOPY_HEALTH_MIN = 0.35;
export const SENESCENCE_STRESS_LOSS = 0.02;                  // daily canopy loss in senescence when Ks < 0.5 (estimate)
export const HEAT_YIELD_FLOOR = 0.2;                         // heat can remove at most 80 % of the yield
export const FROST_FLOWER_LOSS = 0.2;                        // yield share lost when a freeze hits frost-tolerant crops during flowering (estimate)
export const EARLY_HARVEST_HI_START = 0.45;                  // harvest before maturity: the harvest index builds up between this share of the heat sum and 1
export const KY_CORRECTION_MAX = 1.6;                        // limit on the FAO-33 Ky correction of the harvest index
export const MIN_RET_FOR_KY = 0.05;

// ---- soil carbon and nitrogen (two-pool model) -------------------------------------------------------------------
export const SOIL_MASS_LB_PER_ACRE = 1.74e6;                 // top 15 cm, bulk density 1.3 g/cm3
export const SOM_CARBON_FRACTION = 0.58;                     // van Bemmelen factor
export const FAST_DECAY_PER_DAY = 0.008;                     // residue and root pool at 20 C, wet (estimate, half-life ~ 90 days)
export const SLOW_DECAY_PER_DAY = 0.015 / 365;               // humus pool at 20 C (about 1.5 % a year; estimate)
export const HUMIFICATION = 0.15;                            // share of decomposed residue carbon that becomes humus (estimate; with the decay rate above, a typical Blackland rotation holds SOM about level)
export const CN_SOM = 10;                                    // C:N of humus
export const Q10 = 2;
export const TILLAGE_FAST_DECAY_MULT = { conventional: 1.5, reduced: 1.2, 'no-till': 1.0 };
export const TILLAGE_SLOW_DECAY_MULT = { conventional: 1.25, reduced: 1.1, 'no-till': 1.0 };
export const TILLAGE_BURIAL = { conventional: 0.7, reduced: 0.4, 'no-till': 0.05 };  // share of surface residue buried per tillage pass (estimate, NRCS RUSLE2 residue burial ranges)
export const TILLAGE_COST_PER_PASS = 12;                     // $/acre, fuel + labor + repairs (estimate, AgriLife budgets level)
export const NOTILL_PLANTER_COST = 6;                        // $/acre extra for no-till planting (estimate)
export const INIT_N_MIN_LB_AC = 40;                          // starting mineral N (estimate; a soil test would replace it)
export const INIT_FAST_C_LB_AC = 1500;
export const INIT_RESIDUE_LB_AC = 1500;
export const N_UPTAKE_MAX_SHARE_PER_DAY = 0.3;               // plant can take at most 30 % of the mineral N pool per day
export const LEACH_MIX_MM = 250;                             // leached share = 1 - exp(-drainage / this)
export const FERT_PRICE_FALLBACK = 0.6;                      // $/lb N (content/economics.json is passed in when available)
// Not modelled: denitrification, volatilization, P and K balances beyond the removal booked at harvest.

// ---- erosion (daily RUSLE) ----------------------------------------------------------------------------------------
export const R_FACTOR_TARGET = 280;                          // RUSLE2 rainfall-erosivity R for Ellis County, TX, 100 ft-tonf-in/(ac h yr) (approximate; confirm with NRCS)
export const EI_EXPONENT = 1.81;                             // Richardson et al. 1983: EI = a * P^1.81 (daily rain P, mm)
export const EI_COEFF_US = 0.024;                            // a, in R units: set so the generated weather of 5 Ellis fields (2008-2025) averages R = 280 a year (280 / mean of sum(P^1.81) = 11683)
export const SLOPE_LENGTH_FT = 150;                          // estimate (no per-field slope length in the data)
export const BARE_COVER_THRESHOLD = 0.30;                    // a day counts as "bare" when total ground cover is below this
export const SURFACE_COVER_B = 0.04;                         // RUSLE surface-cover subfactor SC = exp(-b * cover %) (Renard et al. 1997, b 0.035-0.05)
export const CANOPY_FALL_HEIGHT_DECAY = 0.1;                 // RUSLE canopy subfactor 1 - Fc exp(-0.1 H) with H in feet
export const RUNOFF_GATE_MM = 1;                             // erosion needs overland flow: full strength at >= 1 mm of runoff, scaled below
export const M_TO_FT = 3.28084;

// ---- irrigation ---------------------------------------------------------------------------------------------------
export const IRRIGATION_TRIGGER_DEPLETION = 0.5;             // irrigate when depletion of the root zone passes 50 % of its capacity
export const IRRIGATION_DEPTH_MM = 25;
export const IRRIGATION_LIMITED_BUDGET_MM = 100;             // seasonal budget of "limited" irrigation
export const IRRIGATION_COST_PER_MM = 0.35;                  // $/acre/mm (about $9 per acre-inch pumped; estimate)

// ---- pests ----------------------------------------------------------------------------------------------------------
export const PEST_PRESSURE_START = 0.3;
export const PEST_PRESSURE_HOST_GAIN = 0.35;                 // a host crop moves pressure this share of the way to 1
export const PEST_PRESSURE_BREAK_MULT = 0.4;                 // a crop that breaks the pest
export const PEST_PRESSURE_OTHER_MULT = 0.8;                 // neutral crop, fallow
export const PEST_LOSS_CAP = 0.6;

// ---- weather generator ----------------------------------------------------------------------------------------------
export const WET_DAY_MEAN_MM = 11;                           // mean rain on a wet day, sets the number of wet days from the monthly total (estimate for Ellis County)
export const RAIN_GAMMA_SHAPE = 0.8;                         // heavy-tailed daily amounts
export const TMAX_NOISE_SD = 3.5;
export const TMIN_NOISE_SD = 3.2;
export const TEMP_AR1 = 0.6;
export const WET_DAY_TMAX_DROP = 3;
export const WET_DAY_TMIN_RISE = 1;
