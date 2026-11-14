# Greenline SI models (Field Shift)

Three models trained on real NASA and USDA data for the **300 Field Shift study fields**: the USDA Crop Sequence
Boundary field outlines nearest 32.25 N, 96.75 W (within ~4 km, Ellis County, TX; app ids `ec-000` … `ec-299`). Plus a
season replay and a rotation recommender, which are **simulations built on published agronomy, not trained models**.
They support farmer judgment and local experts. They don't replace them.

Code, data and full details: `pipeline/fieldshift/` (README there). These models replaced the earlier three models on
201 North Texas sample fields (`nt-*`) on 2026-11-14; those are in git history (tag `v1.1-checkpoint`).

**Validation rule: train on years before 2023, score once on 2023–2025.** No random splits; tuning used cross-validation
grouped by year on the training years only.

| | Code | Results |
|---|---|---|
| Field outlines and exports (Earth Engine, Colab) | `field_shift_export_round2.ipynb`, season-data notebook | `pipeline/fieldshift/data/`, `models/` inputs |
| Model 1: season and crop | `models/features.py`, `final_m1.py`, held-out report `evaluate_m1.py` | `season_crop_model.joblib`, `field_year_results.csv`, `model1_heldout.json` |
| Model 2: vegetation stress (leak-free) | `models/run_model2.py` | `stress_model_causal.joblib`, `field_month_stress_causal.csv`, `model2_metrics_causal.json`, `model_card.json` |
| Model 3: year types | `models/m3.py` | `year_types.csv`, `model3_metrics.json` |
| Season replay + recommender (not ML) | `replay/src/` | `replay/outputs/recommendation.json` |
| App inputs for the 300 fields | `build_app_inputs.py` | `pipeline/data/fields/*.csv` |
| Per-field model export | `export_si.py` | `shared/si/ec-NNN.json`, `shared/si/index.json` |
| App field files | `pipeline/build_fields.py` | `shared/fields/ec-NNN.json`, `shared/fields/index.json` |
| Study card | `export_app.py` | `shared/fieldshift/ellis-study.json` |

## Model 1: season and crop classifier
Gradient boosting (scikit-learn HistGradientBoosting) on each field-year's season curve: NDVI, NDTI and BSI in 16-day
steps from the previous September 1 (cloud-masked, smoothed), curve-shape features, last year's curve, and OpenLandMap
soil (165 inputs). Labels: USDA Cropland Data Layer, 2008+, in 5 classes: `winter_grain`, `summer_grain` (corn +
sorghum), `cotton`, `grass_hay`, `fallow`. **Trained only on field-years where ≥ 70% of pixels share one CDL label.**

| Unseen years 2023–2025 | All fields (872) | Clean-label fields (587) |
|---|---|---|
| Accuracy | **83.1%** | **91.7%** |
| Balanced accuracy | 67.3% | 76.5% |
| Baseline: same crop as last year | 58.0% | 56.8% |

Recall on unseen years (all fields): winter grain 93%, grass/hay 89%, summer grain 80%, cotton 75%, **fallow 0%** (30
field-years; too few clean examples). `final_m1.py` then refits on all years for the app's labels, so only 2023–2025
have an honest right/wrong per field (`correct` in `shared/si`). Reproduced on 2026-11-14 (91.5 / 83.3% reported, 91.7 /
83.1% rerun).

## Model 2: vegetation stress (leak-free)
Predicts each field-month's NDVI anomaly against that field's own normal for the calendar month, and "stressed" (below
the 20th percentile), from the field's past observations, NASA POWER weather and soil wetness, SMAP, IMERG, previous-month
MODIS ET/LST, crop and soil (95 inputs). Field normals, the cut-off and climate averages use **earlier years only**.

| | AUC | Accuracy | Balanced acc. | R² |
|---|---|---|---|---|
| Unseen years 2023–2025 | **0.936** | **90.9%** | 83.2% | 0.655 |
| Cross-validated 1990–2022 | 0.897 | 85.1% | 80.1% | 0.562 |
| Baseline: last month only (CV) | 0.857 | | | 0.428 |

Most of the skill is the field's own recent greenness; weather, water and soil add about 4 AUC points. The app says so.
An earlier version (`stress_model.joblib`, AUC 0.951) leaked future information and is not used.

## Model 3: year types
k-means (k = 4) on Mar–Oct NASA POWER seasons 1985–2025 (rain, heat days ≥ 35 °C, mean Tmax, root-zone wetness,
heavy-rain days, longest dry spell). Compared with EM / Gaussian mixture (silhouette 0.18) and e-means (0.21); k-means
0.26 sets the labels, EM gives each year's probabilities. Groups: drought 2 (2000, 2011), hot 13, normal 19, wet 7. In
drought years the fields ran 0.05–0.07 NDVI below normal. Replay presets: 2011, 2000 (drought), 2015, 2007 (wet),
1998, 2022 (hot). Model 3 also sets the season replay's year types.

## Suspicious or weak, not hidden
1. **Whole-field NDVI reads greener than field centres.** The Earth Engine export averages each full USDA outline
   (edges, grass waterways, borders included). Harvested fields rarely drop below the app's bare cut-off (NDVI 0.25):
   cropland fields median 17 bare days a year (Landsat 8/9), versus ~40 for the old Ellis County centre-of-field samples.
   Model 1's own bare days (NDVI < 0.25 and NDTI < 0.165) are near zero after 2014. Fix: the planned field-interior
   export (45 m inward, `ndvi_timeseries_inner.csv`), then rebuild.
2. **Fallow is never found** (Model 1 recall 0%). Fallow years show as another class.
3. **Same places, new years.** Training and test are the same 300 fields in different years. Nothing is tested on
   other places; the fields are all within ~4 km.
4. **One weather point.** NASA POWER, SMAP, IMERG and MODIS are single area series for all 300 fields; PRISM is the 4 km
   cell series of the old sample field nt-103, 4.8 km south of the study centre (labelled "area" in the app).
5. **55 of the 300 fields were never cropland** in 2008–2025 (pasture/hay). They stay in, labelled grass/hay.
6. **Model 3 groups are soft** (41 seasons, k-means vs EM agreement ARI 0.43).
7. **Crop calendars** for bare days per rotation (`shared/crop-calendars-l89.json`) are still the ones built from the
   old 200 North Texas centre-of-field samples, because they use more fields and the old crop classes.
8. **CDL label noise** is learned along with the labels; training on ≥ 70% purity reduces it.

## Pitch summary
Greenline reads 40 years of Landsat over 300 Ellis County fields and names the crop correctly 92% of the time in years
it never saw on fields with a clear USDA label (83% on all fields, vs 58% for "same as last year"). A leak-free stress
model flags browner-than-normal months with AUC 0.94 on unseen years, and 40 years of NASA weather are sorted into
drought, hot, normal and wet seasons for the bad-year replay. We're open about the limits: whole-field averages
undercount bare soil, fallow isn't detected, and everything is tested on the same fields in new years.
