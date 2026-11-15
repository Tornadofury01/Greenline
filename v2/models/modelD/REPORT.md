# Model D: field soil moisture from SMAP (Field Shift v2, optional)

**Target:** SMAP L3 enhanced (9 km) surface soil moisture, 2015–2025, the mean of the AM and PM retrievals.

**Cells:** fields reading identical SMAP series share a cell. That gives 73 cells with 3 or more fields, and 21,612 cell-dates that have a Sentinel-1 radar pass.

**Inputs, averaged over each cell's fields:**
- **Radar:** VV / VH backscatter (dB), their ratio, incidence angle.
- **Greenness:** that month's NDVI.
- **Weather:** rain over the last 1 / 3 / 7 / 14 days, 7-day mean high.
- **Season:** day of year.
- **Terrain:** wetness index, height above drainage, slope.
- **Soil:** clay, sand, water holding.

## Tests at SMAP's own scale (R²)

| | Model | Rain + season only | Radar only | Monthly average |
|---|---|---|---|---|
| Cells it never saw (grouped 5-fold) | **0.93** | 0.93 | 0.25 | 0.26 |
| Years it never saw (2023–2025) | **0.75** | 0.70 | 0.33 | 0.29 |

**Mean error:** 0.028 m³/m³ on the unseen years.

## What this says, honestly

1. **Recent rain does nearly all the work.** In this flat 6-county area, rain + season alone gets R² 0.93 on unseen cells. Radar, terrain and soil add about +0.05 R² on unseen years and almost nothing across cells.
2. **The field-scale detail is small and only weakly physical.**
   - **Spread:** after downscaling, fields in the same cell differ from SMAP by a standard deviation of 0.012 m³/m³.
   - **Terrain:** that difference barely follows terrain wetness (r = +0.06) or height above drainage (r = +0.05).
   - **Clay:** it follows clay content somewhat (r = +0.23).
3. **Field-scale accuracy can't be measured here.** No soil-moisture ground station sits in the 6 counties.

**Recommendation:**
- **Gap-filler:** use Model D to estimate SMAP-scale moisture on any day, including days with no SMAP retrieval, from rain + radar.
- **Simulator start:** start the simulator from SMAP / Model D at the cell level. Don't present the per-field values as measured field moisture.
- **To make it truly field-scale:** you would need in-situ stations (TxSON, SCAN) or a wetter, hillier area. This matches the plan's "optional" label.

**Files:**
- `modelD.joblib`
- `field_soil_moisture.csv.gz`: per field, per radar pass. Columns: SMAP, downscaled.
- `metrics.json`
