# Field Shift models (Space Apps): the app's models and fields

**These are Greenline's models and fields.** The app's 300 fields (`ec-000` … `ec-299`) are the USDA Crop Sequence
Boundary outlines nearest 32.25 °N, 96.75 °W (Ellis County, TX) that the models were trained on
(`data/fields_index.csv`, `data/fields.geojson` from `field_shift_export_round2.ipynb`). They replaced the earlier three
models on 201 North Texas sample fields (`nt-*`) on 2026-11-14; those are in git history (tag `v1.1-checkpoint`).
Summary of results and weak spots: `pipeline/MODELS.md`.

Pipeline in one line: **Models 1–3 learn about the fields from satellites → the season replay runs 7 rotations through
41 real seasons and 2040 climate → four planning models add money, nitrogen, cost-share and pests → the recommender
grades the current rotation and picks a better one.** Machine learning only where real labels exist (Models 1–2),
unsupervised for year types (Model 3), and transparent published agronomy for the replay and planning. **The replay and
recommender are not trained models; don't call them that.**

## Folders

| Folder | What | From |
|---|---|---|
| `models/` | Model 1 (crop classifier), Model 2 (leak-free stress model), Model 3 (year types): scripts, inputs, trained `.joblib` files, outputs, metrics | `field_shift_models_v2.zip` (Models 1, 3) + `model2_package.zip` (Model 2) |
| `replay/` | Season replay + planning models + recommender: `src/`, `data/raw/`, `outputs/`, Colab notebooks, its own `README.md` and `CLAUDE.md` | `field_shift_models.zip` |
| `data/` | Field outlines + centroids (Earth Engine export), study-area PRISM, cached SSURGO | `fields_index.csv`, `fields.geojson` |
| `build_app_inputs.py` | Per-field tables for the app pipeline → `pipeline/data/fields/*.csv` | new |
| `export_si.py` | Per-field model results → `shared/si/ec-NNN.json` | new |
| `models/evaluate_m1.py` | Model 1 trained before 2023, scored once on 2023–2025 → `model1_heldout.json` (per-class numbers for the app) | new |
| `export_app.py` | Season replay study card → `shared/fieldshift/ellis-study.json` | new |

**Model 2: use the `_causal` files only** (`stress_model_causal.joblib`, `field_month_stress_causal.csv`,
`model2_metrics_causal.json`, `model_card.json`). The earlier `stress_model.joblib` / `field_month_stress.csv` /
`m2.py` from `field_shift_models_v2.zip` leaked future information (field normals from all years) and are deliberately
**not** in the repo. `FIELD_SHIFT_HANDOFF.md`'s Model 2 numbers (AUC 0.951, 91.0%) are that leaky version.

## Results

| Model | Test (unseen years 2023–2025) | Cross-validated (grouped by year) |
|---|---|---|
| 1. Season and crop classifier (gradient boosting, trained on fields with ≥ 70% USDA label purity, + soil) | **91.5%** on clean-label fields, 83.3% on all fields (mixed ~65%). Fallow F1 = 0 | 88.9% clean |
| 2. Vegetation stress, leak-free (gradient boosting; normals, cut-off and climate averages from earlier years only) | **AUC 0.936**, accuracy 90.9%, balanced 83.2%, R² 0.655 | AUC 0.897, 85.1%, R² 0.562. Last-month-only baseline: AUC 0.857, R² 0.428 |
| 3. Year types (k-means, k = 4, Mar–Oct seasons 1985–2025) | drought 2 (2000, 2011), hot 13, normal 19, wet 7 | silhouette 0.26 (EM 0.18, e-means 0.21); k-means vs EM ARI 0.43 |

Recommender (balanced priorities): today's common rotation (wheat, bare summer) = **F**, last of 7. Best =
**sorghum + crimson clover cover, B**, wins all 10 scenarios (5 climate views × 2 price sets) and is the pick under all
four priority presets. Bare days 170 → 0, soil loss 11.6 → 4.9 t/ha/yr, return above variable costs $40 → $97/acre
(mostly the clover N credit), EQIP ≈ $103/acre/yr possible. Sensitivity: "sorghum + winter cover" is robust; clover vs.
rye depends on the legume N credit and cover seed cost.

## Changes made when bringing the bundles in (2026-11-14)

1. `models/ndvi_timeseries.csv` (67 MB) is stored gzipped as `ndvi_timeseries.csv.gz`; `features.py` and
   `run_model2.py` read the `.gz` directly.
2. `models/m3.py`: e-means (faiss) is optional, since k-means sets the labels and e-means is only a comparison. Install
   `faiss-cpu>=1.16` to get its silhouette back. It now reads Model 2's leak-free `field_month_stress_causal.csv` for
   the NDVI check, so `field_ndvi_anom` in `model3_metrics.json` changes slightly on a rerun (drought −0.07 → −0.05);
   labels don't change.
3. **Model 3 is wired into the replay** (`replay/src/run_replay.py` reads `../models/year_types.csv`; Model 3's `hot` =
   the replay's `heat-wave`). Grades, scores and picks are unchanged for all four presets; only the drought-year metric
   moves, since there are now 2 drought years instead of the rule-based set. The recommendation's assumption line says so.

## Rebuild

Python 3.10+ with pandas, numpy, scikit-learn, joblib, matplotlib, requests (tested with Python 3.12, scikit-learn 1.7.2).

```bash
cd pipeline/fieldshift/models
python features.py 0.6 16 31      # season-curve features -> cache_c0.6_b16_s31.pkl (gitignored), ~1 min
python final_m1.py                # Model 1 -> season_crop_model.joblib, field_year_results.csv, app_fields.json
python evaluate_m1.py             # Model 1 on unseen years 2023-2025 -> model1_heldout.json
python run_model2.py final        # Model 2 -> stress_model_causal.joblib, field_month_stress_causal.csv, ~4 min
python m3.py                      # Model 3 -> year_types.csv, model3_metrics.json
cd ../replay && bash run_all.sh   # replay + planning + recommender -> outputs/, ~40 s
cd ../../..                       # repo root
python pipeline/fieldshift/build_app_inputs.py   # -> pipeline/data/fields/*.csv (SSURGO cached in data/ssurgo.csv)
python pipeline/fieldshift/export_si.py          # -> shared/si/
python pipeline/build_fields.py                  # -> shared/fields/ (app field files)
python pipeline/fieldshift/export_app.py         # -> shared/fieldshift/ellis-study.json
cd app && npm run selftest && npm run i18n && npm run build
```

Checked on 2026-11-14 by rerunning everything from these files: Model 1 metrics byte-identical (held-out 91.7% clean /
83.1% all vs the reported 91.5 / 83.3%); Model 2 within run-to-run noise (AUC 0.936 same, accuracy 90.9 → 91.2%);
Model 3 identical labels; `recommendation.json` identical. The committed model outputs are the original shipped ones.

## Open items (from the handoff)

1. Model 1 retrain when interior NDVI, interior purity, Sentinel-1 and red-edge files arrive (report clean / mixed /
   overall). Keep `grass_hay` as one class.
2. Model 2: fold in `MINOBS = 2` (`m2_v5.py`, not in the bundles), then per-field Daymet weather; expanding-window validation.
3. Replay calibration against Ellis County NASS wheat yields by year.
4. Replace the R-factor placeholder (R = 300); local cover-seed quotes; confirm EQIP rates with NRCS.
5. Optional transfer test (train Ellis, test Hill County TX / Sumner County KS).
6. **Field-interior NDVI** (45 m inward, item 1) also fixes the app's bare days: whole-outline averages read greener, so
   cropland fields show a median of 17 bare days a year vs ~40 for the old centre-of-field samples (MODELS.md).
