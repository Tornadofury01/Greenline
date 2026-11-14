# Greenline SI models

Three models trained on real NASA and USDA data for **201 North Texas cropland fields** (200 random Cropland
Data Layer pixels in the box 31.5–34.0 °N, 98.5–95.5 °W, plus the Ellis County demo field), plus SHAP explanations.
They support farmer judgment and local experts. They don't replace them.

**Validation rule for every model: leave-one-YEAR-out.** Each year is predicted by a model that never saw that
year. No random splits and no tuning on test years. "Held-out" below always means this.

| | Code | Results |
|---|---|---|
| Data download (Earth Engine, server-side reductions only) | `pipeline/sample_fields.py` | `pipeline/data/fields/*.csv` |
| Model 1: season and crop | `pipeline/models/season_crop.py` | `pipeline/models/results/season_crop*.json` |
| Model 2: vegetation stress → weather risk signal | `pipeline/models/veg_stress.py` | `pipeline/models/results/veg_stress*.json` |
| Model 3: year patterns | `pipeline/models/year_patterns.py` | `pipeline/models/results/year_patterns.json` |
| Per-field export for the app | `pipeline/models/export_si.py` | `shared/si/<fieldId>.json`, `shared/si/index.json` |
| App field files (data + SI) | `pipeline/build_fields.py` | `shared/fields/<fieldId>.json`, `shared/fields/index.json` |

Run order (repo root):
```
pipeline/.venv/Scripts/python pipeline/sample_fields.py all      # ~1 h, needs Earth Engine sign-in
cd pipeline/models
../.venv/Scripts/python year_patterns.py
../.venv/Scripts/python season_crop.py                           # ~30-60 min
../.venv/Scripts/python veg_stress.py
../.venv/Scripts/python export_si.py
```

## Data

| Dataset | Use | Resolution | Years |
|---|---|---|---|
| Landsat 5/7/8/9 C2 L2 (NDVI, NDTI, BSI), monthly medians | Model 1 inputs, Model 2 target | 30 m (45 m buffer) | 2008–2025 |
| USDA Cropland Data Layer | Model 1 labels, Model 2 crop | 30 m | 2008–2025 |
| NASA POWER daily (Tmax, Tmin, rain) | Models 2, 3 | ~50 km | 1984–2025 |
| SMAP L4 root-zone soil moisture | Model 2 | ~11 km | 2015–2025 |
| GPM IMERG V07 monthly + half-hourly (storm days ≥ 25 mm) | Model 2 | ~11 km | 2008–2025 |
| MODIS MOD16A2GF ET / PET | Model 2 (tested, not used — see leakage) | 500 m | 2008–2025 |
| NASS Crop Progress, Texas statewide | Model 1 date check | state | 2000–2025 |

201 fields × 18 years = 3,618 field-years. Landsat months missing after cloud masking: 7.8% (gaps of up to 2 months
are interpolated). `pipeline/data` is 7.2 MB.

`MODIS/061/MOD16A2` in Earth Engine only starts in 2021, so we use the gap-filled `MOD16A2GF` (2000–2025).
**ECOSTRESS** ET is a future addition (70 m, but the record starts in 2018 with irregular overpass times).

### Storm days: IMERG vs. POWER (6 fields, 2008–2025)
| | POWER | IMERG |
|---|---|---|
| Days ≥ 25 mm per year | 7.4 | 11.1 |
| Annual rain (mm) | 873 | 989 |
Year-to-year correlation: 0.76 for storm days, 0.93 for annual rain. NOAA normals for DFW / Waxahachie are roughly
940–1,000 mm and ~9 days ≥ 1 inch (from memory; **verify against a GHCN station**). IMERG matches annual totals better.
POWER's ~50 km grid smooths out heavy storms. IMERG probably overcounts storm days somewhat (UTC days, satellite
retrieval). We use IMERG for storm days.

---

## Model 1: season and crop classifier

**Inputs:** 12 monthly NDVI, NDTI and BSI values per field-year, plus peak greenness, low greenness, peak month,
green months and spring-minus-summer greenness. **Labels:** CDL crop for that year, grouped into corn, cotton,
grain sorghum, soybeans, winter wheat, other small grains, fallow and other.

**Approaches compared (held-out years, 3,601 field-years, double crops excluded):**

| Approach | Accuracy | Balanced accuracy | Macro F1 |
|---|---|---|---|
| **Gradient boosting** (chosen) | **0.773** | **0.543** | **0.567** |
| Random forest | 0.768 | 0.519 | 0.531 |
| Baseline: same crop as last year | 0.344 | 0.302 | 0.249 |
| Baseline: always corn | 0.355 | 0.125 | 0.065 |

**Per crop (gradient boosting, held out). Overall accuracy hides weak crops, so read this table:**

| Crop | Field-years | Recall | Precision |
|---|---|---|---|
| Winter wheat | 1,176 | 0.94 | 0.86 |
| Corn | 1,277 | 0.88 | 0.82 |
| Cotton | 277 | 0.80 | 0.68 |
| Grain sorghum | 330 | 0.45 | 0.51 |
| Other | 145 | 0.45 | 0.66 |
| Fallow | 187 | 0.43 | 0.58 |
| Soybeans | 101 | 0.21 | 0.47 |
| Other small grains | 108 | 0.19 | 0.49 |

Held-out accuracy by year ranges from 0.67 (2010) to 0.86 (2017). The 2011 drought year scored 0.75.

**Green / residue / bare periods.** A transparent rule, not a learned model: **green** NDVI ≥ 0.40,
**bare** NDVI < 0.25 (same as `BARE_NDVI` in the app), **residue** in between (sparse plants, stubble or residue).
Monthly values are interpolated to daily to count days. **Bare-days score** = 100 × (1 − bare days / 365).
Across all field-years: median **110 bare days** (score 70). Typical medians by predicted crop: corn 138,
sorghum 137, cotton 104, fallow 97, winter wheat 87, small grains 49.

**Planting and harvest dates vs. NASS Crop Progress.** Green-up and senescence come from the day the NDVI curve
crosses half its seasonal range. These were compared with the day Texas reached 50% of a NASS stage:

| Crop | Satellite green-up − NASS 50% emerged | − NASS 50% planted | Senescence − NASS 50% harvested |
|---|---|---|---|
| Corn (n≈1,370) | median **+2 days**, 91% within 30 days | +23 days | −55 days, 10% within 30 days |
| Cotton (n≈330) | — | +17 days, 74% within 30 days | −27 days, mean error 140 days |
| Sorghum (n≈290) | +23 days (n=22) | +32 days, 43% within 30 days | −27 days, 52% within 30 days |
| Soybeans (n≈33) | 0 days, 76% within 30 days | +12 days | −46 days |

Green-up matches NASS emergence well for corn. Senescence comes **weeks before** NASS harvest, as expected: the
canopy browns (dry-down) before the combine runs. So satellite senescence is not a harvest date. The cotton
senescence errors are large, probably because defoliation, late harvest and the statewide NASS mix (South Texas
harvests in July–Aug, High Plains in Nov–Dec) don't line up with North Texas fields.

**Double-crop years.** CDL marks only **17 of 3,618** field-years as double-cropped. That's too few to learn, so double
crops are **not a model output**. They are excluded from training and scoring and exported only as
`doubleCropCdl: true` with `doubleCropConfidence: "low"`. The app should show them as "detected by CDL".

**SHAP (random forest explainer, all years).** Most important overall: spring vs. summer greenness, bare soil in
June, greenness in June, residue in June, greenness in March. By crop:
- Winter wheat and small grains: greenness and bare soil in **March**.
- Corn: spring vs. summer greenness and **June** residue and bare soil (corn is drying down while sorghum and cotton are still green).
- Cotton: bare soil in **August**.

Each field-year gets one plain-language driver, e.g. *"Greenness (NDVI) in March mattered most"*.

## Model 2: vegetation stress → "weather risk signal"

**Target:** NDVI z-score vs. the normal for the same crop and month, computed from training years only.
"Below normal" = z < −0.5 (35% of held-out months). **Inputs:** POWER Tmax, heat days ≥ 35 °C and rain (this month and
past 2 months), IMERG rain and storm days, SMAP root-zone soil-moisture anomaly (this month and last). 2015–2025
because SMAP starts in 2015, Apr–Sep.

| Version | Approach | R² | Below-normal balanced accuracy | AUC |
|---|---|---|---|---|
| v1 | Linear regression | 0.031 | 0.50 | 0.62 |
| v1 | **Gradient boosting** (chosen) | **0.039** | **0.56** | **0.62** |
| v1 + MODIS ET/PET | Linear regression | 0.169 | 0.59 | 0.72 |
| v1 + MODIS ET/PET | Gradient boosting | 0.135 | 0.61 | 0.71 |
| v2: crop-specific season months, 1–3 month lags | Linear regression | 0.018 | 0.52 | 0.59 |
| v2 | Gradient boosting | 0.047 | 0.57 | 0.61 |
| Baseline: always normal | — | 0.000 | 0.50 | 0.50 |

**ET is not used** even though it scores higher. MOD16 ET is computed partly from MODIS leaf area, so it partly
measures greenness itself (leakage). One round of fixes (v2) did not help, and no more tuning was done.

**Per crop (v1 gradient boosting, held out) vs. "always normal":**

| Crop | Month-rows | R² | RMSE | Baseline RMSE | Show signal in app |
|---|---|---|---|---|---|
| Corn | 5,005 | 0.062 | 1.021 | 1.054 | yes |
| Winter wheat | 3,726 | 0.048 | 1.002 | 1.027 | yes |
| Small grains | 332 | 0.087 | 1.014 | 1.061 | yes |
| Soybeans | 322 | 0.049 | 1.043 | 1.069 | yes |
| Cotton | 923 | 0.019 | 1.042 | 1.052 | yes (barely) |
| Grain sorghum | 727 | −0.019 | 1.077 | 1.067 | **no** |
| Fallow | 1,020 | −0.081 | 1.063 | 1.023 | **no** |

The margins are small, and the per-crop result flips between v1 and v2 (in v2 sorghum beats the baseline and wheat
doesn't). So "yes" means "slightly better than nothing". For crops marked "no" the app shows *"Weather alone doesn't
predict stress well for this crop."* The list is exported as `showSignalFor`.

**SHAP (gradient boosting).** Most important overall: rain over the past 2 months, SMAP soil-moisture anomaly, rain
this month, average high temperature. In the linear model, soil moisture has the largest coefficient (wetter soil →
greener). Per field-year, the driver that pushed greenness down most is exported, e.g. *"Low soil moisture in May
mattered most"*. **Caution:** the most common per-field driver is *"High rain over the past 2 months"*. Wet springs
delay planting, so the crop is greener later and browner earlier than normal. That's real, but it's not "rain
caused stress".

**Why stress is hard to predict from weather alone:**
- **Management:** planting date, variety, fertilizer, irrigation, grazing and herbicide burndown change NDVI more than a month of weather does.
- **Harvest timing:** an early harvest looks like a crash in greenness.
- **CDL label noise:** a wrong crop label compares the field to the wrong normal.
- **Coarse weather:** POWER is ~50 km and SMAP and IMERG are ~11 km, so neighboring fields with different outcomes get the same inputs.
- **Few seasons:** 11 SMAP years, which means only 11 distinct seasons of weather to learn from.

## Model 3: year pattern finder

K-means (k = 4) on standardized yearly POWER features (annual, Apr–Sep and Jun–Aug rain, Jun–Aug mean high,
heat days ≥ 35 °C, frost-free days), 1984–2025 (42 complete years). Clusters are named from their centroids:
drought, wet, heat, normal.

| Check | Result |
|---|---|
| Leave-one-year-out stability (held-out year gets the same label) | **0.976** |
| Agreement with a simple percentile rule (baseline) | 0.643 |
| Silhouette (k = 2…7) | 0.34, 0.23, **0.25**, 0.24, 0.25, 0.24 |
| Cluster sizes | normal 13, heat 11, drought 9, wet 9 |

**Replay presets:** 2011 drought (by far the most extreme), 2023 drought, 2007 and 2004 wet, 2018 and 2000 heat.
Drought years: 1984, 1988, 1998, 1999, 2005, 2006, 2011, 2022, 2023.

## Suspicious or weak, not hidden

1. **CDL label noise.** Model 1 learns CDL, including CDL's mistakes. Texas CDL accuracy for minor crops can be well below 90%. The app shows this as a data gap.
2. **Class imbalance.** Corn and winter wheat are 68% of field-years. Sorghum, fallow, soybeans and small grains are recalled under 50% of the time.
3. **Double crops.** Only 17 field-years, so they are not modeled.
4. **Model 2 is weak.** Held-out R² is below 0.05. It is presented only as a low-confidence weather risk signal, and only for crops where it beat "always normal".
5. **Leakage avoided:** MODIS ET, as explained in model 2.
6. **Same places, new years.** The same 201 fields appear in training and test, in different years. Held-out years test new weather, not new places.
7. **Residue cannot be measured yet.** An NDTI threshold (0.07) was tried and rejected because Blackland clays read NDTI ~0.15 even when bare, so almost no day came out bare. "Residue" currently means "between bare and green". **Re-checked 2026-11-14 on all 40,024 field-months with NDTI and BSI (2008+, `pipeline/data/fields/landsat_monthly.csv`; the per-field JSON files keep only NDVI):** among months with NDVI < 0.25, NDTI is a single hump (0.04–0.28) and 98% of those months sit above the old 0.07 threshold, so there is no bare-vs-residue split to cut on. Each field's median NDTI follows its clay content (r = 0.62 with SSURGO clay %; BSI r = 0.26), so it reads soil type more than residue. NDTI correlates 0.83 with NDVI and BSI −0.87, so neither adds much beyond greenness. There are no residue-cover observations (e.g. NRCS transect or tillage surveys) to validate a threshold against. The app therefore keeps "partly covered" and does not claim to detect residue. Possible later step: with ground-truth residue observations, test NDTI relative to each field's own bare-soil baseline.
8. **Monthly composites.** Dates are good to about ±15 days at best.
9. **NASS Crop Progress is Texas-wide,** not North Texas.
10. **Model 3 clusters are weak.** k = 4 doesn't score best on silhouette (k = 2 does). It's one POWER cell (~50 km) for every field, and 2024 had no fall frost, so its frost-free days were filled with the median.
11. **IMERG storm days may run about 20% high.** Check against a gauge. *Update:* against gauge-based PRISM (4 km, 201 fields, 2008–2024),
    IMERG averages 12.7 storm days a year and PRISM 12.4, so the overcount isn't supported. POWER undercounts instead.
    Field-year agreement is moderate (r = 0.71). See `/docs/data-validation.md`. No model was changed.
12. **The original Ellis County demo point is not cropland.** The app's demo field is now **nt-103** (Ellis County, Houston Black clay; corn/cotton/sorghum/wheat, with the clearest wheat-then-bare-summer year in 2012). Change it in `app/src/config.js`. CDL labels it grassland/pasture (176) every year from 2008 to 2024 (wetland in 2025), and its NDVI never drops below 0.18. The pipeline comment claiming it was confirmed cropland was wrong. Nearby real cropland samples: `nt-141` (4.6 km; corn, cotton, wheat, soybeans, fallow) and `nt-103` (8.2 km; corn, cotton, wheat, sorghum). The team should pick a new demo field.
13. **3 of the 201 fields are in Oklahoma** (nt-056 and nt-081 in Bryan County, nt-148 in Jefferson County). The sampling box crossed the Red River. They stay in the training data (same farming conditions) and are labeled `OK`.
14. **Landsat sensor change.** Median bare days drop from 140–190 a year before 2015 to 54–122 after. Some of that may be real, but Landsat 8 (2013–) reads NDVI slightly higher than Landsat 5/7, and with a fixed 0.25 cutoff that alone lowers bare days. Fix: harmonize TM/ETM+ to OLI (Roy et al. 2016 coefficients) and re-download (~1.5 h). **App decision (2026-11-14):** the app keeps the fixed 0.25 cutoff but uses only 2013+ (Landsat 8/9) for bare-day numbers: the headline and stats, the per-crop `bareShare` calendars (`scoring/tools/build_calendars.mjs`) and the field calibration. The 2008-2012 cutoff gives nearly double the bare days (e.g. corn median 202 vs. 124). The app shows a visible 2013 marker and a data-gap note on every card. Interesting: NDTI and BSI in bare months do NOT shift between the two sensor eras (median NDTI 0.154 vs. 0.151, BSI 0.259 vs. 0.256), while NDVI does (0.200 vs. 0.224). That makes them candidates for checking a harmonization. The pipeline is unchanged.
15. **Stress-driver wording bug (fixed).** "Low" vs. "high" was first taken from the sign of the raw value, which is only meaningful for soil-moisture z-scores. It's now relative to each input's median.
16. **Not suspicious:** no model scored implausibly high. The highest is model 1 at 77% accuracy, which matches the per-class table.

## Pitch summary (3 sentences)

Greenline reads 18 years of Landsat imagery for 200 North Texas fields and recognizes what was growing each
year, correctly naming the crop 77% of the time in years the model never saw (more than double the 34% you get
by assuming the same crop as last year). It flags the bad years, such as the 2011 drought, from 40 years of
NASA weather, and shows when each field sat bare and exposed to erosion. We're honest about the limits: weather
alone barely predicts crop stress, so Greenline shows it only as a low-confidence risk signal and leaves the final
call to farmers and local experts.
