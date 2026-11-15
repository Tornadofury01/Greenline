# Calibration E: yields (Field Shift v2, North Texas)

**What it is:** the yield targets the simulator must hit. It predicts county yields from satellite greenness (Model B) plus weather.

**Fit and test:** fitted on 1985–2012, tested once on 2013–2025.

**Target:** each county-crop's % deviation from its yield trend. The trend is fitted on the training years only and extrapolated, so test years never shape it.

**Yield data:** one clean NASS series per crop (`../nass_yields.py`): per harvested acre, all practices, winter wheat only.

**Inputs per county-year:**
- **Greenness:** z in the crop's key months (mean and worst month), from the fields Model 1 says grew the crop.
- **Weather:** season rain and hot days.
- **Water:** SPEI-90 and TerraClimate deficit at the end of the season, MODIS ET/PET.

| Crop | Train / test county-years | Test years | R² (deviation): greenness line | Ridge | Trees | Yield error (trend → best) | Yield per +1 greenness z |
|---|---|---|---|---|---|---|---|
| Wheat (BU / ACRE) | 154 / 62 | 2013–2025 | -0.12 | -0.80 | 0.17 | 7.3 → 6.6 | +20.1% |
| Corn (BU / ACRE) | 140 / 61 | 2013–2025 | 0.38 | 0.12 | -0.10 | 19.7 → 15.3 | +43.0% |
| Sorghum (BU / ACRE) | 146 / 36 | 2013–2023 | -0.05 | -0.28 | -0.55 | 16.2 → 15.8 | +18.5% |
| Cotton (LB / ACRE) | 121 / 46 | 2013–2025 | 0.45 | 0.32 | 0.31 | 193.8 → 136.2 | +24.9% |

**Reading the R² columns:** R² of the deviation from trend. 0 is "trend only"; below 0 is worse than the trend.

**Results:**
- **Corn and cotton:** calibrated. Greenness alone explains about 38–45% of their year-to-year swings in unseen years and cuts yield error by about a quarter.
- **Wheat:** weak. A small tree model beats the trend, but greenness alone doesn't. Blackland wheat yields are set by freezes, disease and harvest rain as much as by spring growth.
- **Sorghum:** not predictable from these inputs. NASS stops sorghum county yields in 2023, leaving few test county-years.

**Ridge and trees vs the greenness line:** with about 150 training county-years, the extra weather inputs often overfit. The single greenness line is the most reliable target.

**How the simulator uses this:**
- **Corn and cotton:** the engine's per-crop settings (water productivity, heat thresholds) are tuned until its simulated yield deviations match these targets year by year (`metrics.json` → `targets`).
- **Wheat and sorghum:** the published FAO-33 response is kept and reported as uncalibrated.

**The engine itself isn't built yet:** this step supplies the targets and the test protocol.

**Files:** `calibrationE.joblib` (per-crop ridge + trees + training-year trends), `metrics.json`.
