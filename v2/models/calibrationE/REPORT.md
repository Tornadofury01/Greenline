# Calibration E v2: county yields from MODIS crop greenness + weather

25 Blacklands counties, 2000-2025, 1622 county-crop-years. Target: % deviation of the NASS county yield from its trend. Scored leave-one-year-out (trend and county greenness means refit without the held-out year), plus a forward test (train 2000-2012, test 2013-2025).

R² of the deviation (0 = no better than the trend; the trend-only line is 0 by construction).

| Crop | Best method | All 25 counties | 6 study counties | Hill (held out) | Forward test | MAE yield (trend → best) |
|---|---|---|---|---|---|---|
| Wheat (BU / ACRE) | allCrops | 0.153 | 0.231 | 0.339 | 0.017 | 7.3 → 6.6 |
| Corn (BU / ACRE) | greennessLine | 0.377 | 0.431 | 0.563 | -0.277 | 20.1 → 14.6 |
| Sorghum (BU / ACRE) | allCrops | 0.206 | 0.174 | 0.437 | -0.643 | 13.1 → 11.4 |
| Cotton (LB / ACRE) | allCrops | 0.603 | 0.682 | 0.694 | 0.461 | 168.4 → 97.9 |

## Every method (leave-one-year-out, all 25 counties, R² of deviation)

| Crop | trendOnly | greennessLine | ridgeSmall | partialPool | trees | allCrops | weatherOnly |
|---|---|---|---|---|---|---|---|
| Wheat | -0.0 | 0.128 | 0.151 | 0.121 | 0.084 | 0.153 | -0.062 |
| Corn | -0.001 | 0.377 | 0.306 | 0.232 | 0.274 | 0.314 | 0.117 |
| Sorghum | -0.001 | 0.123 | 0.181 | 0.191 | 0.077 | 0.206 | -0.074 |
| Cotton | -0.0 | 0.541 | 0.598 | 0.587 | 0.517 | 0.603 | 0.347 |

## Simulator targets (ridge on all years, per unit)

| Crop | % per +0.1 NDVI anomaly | % per +0.1 late NDVI | % per hot day | % per SPEI unit | % per 100 mm rain |
|---|---|---|---|---|---|
| Wheat | 25.79 | 1.04 | -0.345 | -8.17 | -0.09 |
| Corn | 32.24 | -0.86 | -0.084 | 5.61 | -2.4 |
| Sorghum | 37.9 | -14.72 | 0.145 | 3.48 | -3.3 |
| Cotton | 33.27 | -13.99 | -0.449 | 6.88 | -2.34 |

## Field check: USDA-ARS Riesel watersheds (McLennan County, never used for fitting)

- Wheat: 16 field harvests (2000-2015). Spearman of E's county prediction vs the field's own deviation -0.765 (actual county yield vs field: -0.843).
- Corn: 43 field harvests (2000-2014). Spearman of E's county prediction vs the field's own deviation 0.616 (actual county yield vs field: 0.757).

Methods: trendOnly (0), greennessLine (deviation ~ key-window NDVI anomaly), ridgeSmall (5 inputs, counties pooled), partialPool (ridgeSmall + county greenness slopes shrunk toward the shared one), trees (10 inputs), allCrops (one ridge for all crops, shared + crop slopes), weatherOnly (no greenness).
