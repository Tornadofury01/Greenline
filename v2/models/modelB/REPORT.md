# Model B: how each field's crop reacts to heat and drought (Field Shift v2, North Texas)

**Data:** 1,711 fields, monthly 1985–2025.

**Greenness:** the monthly median NDVI of clear Landsat + HLS views, compared with a **leak-free normal**. The normal is the same field's mean for that crop group and month in earlier years only, or the county's earlier-years mean when the field has fewer than 3 earlier years.

**Stress:** a growing month whose greenness is at least one spread below normal (z ≤ −1). About 12–16% of growing months are stressed.

**Crop:** Model 1's crop for each field-year.

**Inputs:**
- **Weather and drought:** gridMET (rain, hot days ≥ 35 °C, VPD, reference ET), gridMET drought indices (SPI, SPEI, EDDI, PDSI), IMERG rain and peak intensity.
- **Soil water:** SMAP L4 root-zone and surface soil moisture.
- **Water use:** MODIS ET / PET, OpenET DisALEXI ET (thermal), TerraClimate deficit.
- **Soil:** SSURGO.

**Training:** 2008–2019 in five counties. **Tests:** unseen years 2020–2025, and Hill County, which is never trained on.

## 1. Stress forecast, 1–3 months ahead (AUC: 0.5 = coin flip, 1 = perfect)

Each forecast uses only what is known at the end of the current month.

| Ahead | Unseen field-months | **Model** | Last greenness only | Logistic regression | Same as last month | Crop-month average | Hill (model) |
|---|---|---|---|---|---|---|---|
| 1 month | 56,503 | **0.879** | 0.845 | 0.791 | 0.681 | 0.575 | 0.891 |
| 2 months | 55,984 | **0.793** | 0.763 | 0.647 | 0.589 | 0.577 | 0.855 |
| 3 months | 55,277 | **0.745** | 0.715 | 0.540 | 0.559 | 0.572 | 0.833 |

**What matters most** (SHAP, 1-month forecast): target_normal, ndvi, z_known, et_ratio, ndvi_l1, tmax_mean, z, tcrop_summer_grain.

The expected greenness for the target month and the field's current greenness lead. Water use relative to demand (MODIS ET / PET) and heat come next. SHAP values are computed for every forecast, so the app can show "why" for each field.

## 2. Response: this month's greenness from this month's weather

| | Unseen years | Hill |
|---|---|---|
| R² | **0.53** (last month alone: -0.00) | 0.60 |
| Mean error | 0.59 z | 0.52 z |
| Spots a stressed month (AUC) | 0.887 | 0.910 |
| 90% range (split conformal) | ± 1.29 z, covered **89.5%** | covered 92.0% |

**How the 90% range was set:** the model was fitted on 2008–2015, and the range was calibrated on 2016–2019. Unseen-year coverage was then checked once.

## 3. Sensitivity: how far each crop's greenness moves

**Method:** observed slopes, measured over growing months in all years. Each field also gets its own slope in `field_sensitivity.csv`. Fields with few months are pulled toward their crop's slope.

| Crop | z per +1 SPEI (wetter) | z per hot day | z in a severe drought (SPEI −2) | Field-to-field range (10–90%) |
|---|---|---|---|---|
| cotton | +0.295 | +0.0000 | -0.59 | 0.144 to 0.461 |
| fallow | +0.142 | -0.0030 | -0.28 | 0.033 to 0.278 |
| grass_hay | +0.323 | -0.0096 | -0.65 | 0.123 to 0.462 |
| soybeans | +0.182 | +0.0076 | -0.36 | 0.032 to 0.336 |
| summer_grain | +0.152 | -0.0231 | -0.30 | -0.025 to 0.321 |
| winter_grain | +0.209 | -0.0182 | -0.42 | -0.006 to 0.37 |

**Reading the table:** every crop gets browner in drought. Hot days hurt summer grain most, then winter grain, then hay.

## 4. Ties to real outcomes

### NASS county yields

**Method:** greenness in each crop's key months against the county yield's deviation from its trend, using the 6 counties and every year NASS reports. One clean NASS series per crop: per harvested acre, all practices, winter wheat only (`v2/models/nass_yields.py`).

| Crop | Key months | County-years | Correlation | R², leave one year out | Yield change per −1 z |
|---|---|---|---|---|---|
| Wheat | months 3, 4, 5 | 216 | +0.33 | 0.05 | +15.1% |
| Corn | months 5, 6, 7 | 201 | +0.63 | 0.36 | +44.2% |
| Sorghum | months 6, 7, 8 | 182 | +0.34 | 0.07 | +16.5% |
| Cotton | months 7, 8, 9 | 167 | +0.61 | 0.34 | +29.3% |

**Reading the table:**
- **Corn:** strongly tied. When the May–July greenness of a county's corn fields is 1 z below normal, the county's corn yield runs about 44% below trend.
- **Cotton:** about as strongly tied as corn.
- **Sorghum:** moderately tied.
- **Wheat:** weakly tied. Spring greenness is a poor signal for Blackland wheat yields, which are often set by freezes, disease and rain at harvest. Calibration E should weight wheat accordingly.

### RMA crop insurance

**Method:** the share of stressed growing field-months in a county-year against that county-year's drought and heat insurance payouts.

**Result:** Spearman **0.37** over 222 county-years.
- **Top stress years:** 2006, 2011, 1998, 1996, 2022.
- **Top drought payout years:** 2022, 2018, 2011, 2009, 2008.

2011 and 2022, the two worst Texas droughts in this period, appear in both lists.

**Why payouts and stress differ:** payouts also depend on how many acres were insured, price, and coverage.

## Files

- **Models:** `forecast_h1/2/3.joblib` (stress forecasts), `response.joblib` (with its 90% half-width).
- **`field_sensitivity.csv`:** per field and crop, greenness z per SPEI and per hot day.
- **`metrics.json`:** every number above.

**Built by:** `data.py` → `train.py`.

**Limits:**
- **Satellite stress, not yield:** the stress label is greenness below normal, not measured yield loss. The yield link above is at county level, because NASS has no field yields.
- **Drought indices use future years:** gridMET's SPI / SPEI are standardized on its full record, 1980–present. That is a published index, but strictly it uses future years. Rain anomalies are leak-free.
