# Field Shift: Model 2 (field vegetation stress, leak-free)

Estimates each field's greenness anomaly and whether the month is stressed, using only that field's past observations plus weather, water and soil.
- Test, unseen years 2023-2025: AUC 0.936, accuracy 90.9%, balanced accuracy 83.2%, R2 0.655.
- Cross-validated 1990-2022 (grouped by year): AUC 0.897, accuracy 85.1%, R2 0.562. Last-month-only baseline: AUC 0.857, R2 0.428.
- No leakage: field normals, the stress cut-off and climate averages use only earlier years; look-back features use raw observations before the month.

Run: `python3 run_model2.py final` (retrain, test, save) | no argument: cross-validate only | `baseline` | `forecast` (last month's weather only).
Inputs: ndvi_timeseries.csv, field_year_results.csv (from Model 1), power_daily.csv, power_soil_wetness.csv, smap_soil_moisture.csv, modis_et.csv, modis_lst.csv, r2/imerg_daily_rain.csv, r2/fields_soil.csv.
Outputs: stress_model_causal.joblib, field_month_stress_causal.csv, model2_metrics_causal.json. Details: model_card.json.
Requires Python 3.10+, pandas, numpy, scikit-learn, joblib.
