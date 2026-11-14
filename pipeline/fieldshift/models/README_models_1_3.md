# Field Shift: Model 1 (crop and season classifier) and Model 3 (year types)

## Model 1
- Gradient boosting on each field-year's season curve (NDVI, NDTI residue, BSI bare soil; 16-day steps from the previous Sept 1), shape features, the previous year's curve, and per-field soil.
- Trained on field-years where >= 70% of pixels share one USDA label. Classes: winter_grain, summer_grain (corn + sorghum), cotton, grass_hay, fallow.
- Unseen years 2023-2025: 91.5% on clean-label fields, 83.3% on all fields (mixed fields about 65%).
- Outputs: season_crop_model.joblib; field_year_results.csv (crop_final = USDA label where it exists, else model; green/residue/bare days); app_fields.json (per-field data for the app); model1_metrics.json.
- Day states: green if NDVI >= 0.35; bare if NDVI < 0.25 and NDTI < 0.165; otherwise residue.

## Model 3
- Clusters Mar-Oct seasons 1985-2025 by rain, heat days >= 35 C, mean Tmax, root-zone wetness, heavy-rain days, longest dry spell (NASA POWER).
- Compared k-means (silhouette 0.26), Meta e-means (0.21), EM/Gaussian mixture (0.18). k-means sets labels; EM gives per-year probabilities.
- Types: drought (2000, 2011), hot, normal, wet (incl. 2015). Drought years: crops 0.07 NDVI below normal.
- Outputs: year_types.csv, model3_metrics.json.

## Rebuild
Needs ndvi_timeseries.csv (in the Model 2 package) in this folder, then:
python3 features.py 0.6 16 31 && python3 final_m1.py && python3 m3.py
(m3.py needs field_month_stress.csv from Model 2; e-means needs `pip install faiss-cpu>=1.16`.)
