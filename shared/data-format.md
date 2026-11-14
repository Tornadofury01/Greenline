# Field data format (v2)

The app loads real fields from `/shared/fields/<fieldId>.json` (v2, built by `pipeline/build_fields.py`) and falls back to
`/shared/sample-field.json` (v1, fake) when a file is missing. v2 = everything in v1 below, plus the
"v2 additions" section. `/shared/fields/index.json` lists `{ id, county, state, lat, lon }` for every field.

Every field file the app loads (today `sample-field.json`, later the pipeline outputs) **must** follow this format.
If you change it, bump `schemaVersion`, update this doc, and update `/shared/sample-field.json`.

## Top level

| Key | Type | Notes |
|---|---|---|
| `schemaVersion` | number | `2` for real fields, `1` for the fake sample |
| `isSampleData` | boolean | `true` for fake data. The app shows a "Sample data" badge |
| `field` | object | See below |
| `soil` | object | See below |
| `terrain` | object | See below |
| `cropHistory` | array | About 10 years |
| `climateYearly` | array | One entry per year, 2005–2025 |
| `ndviMonthly` | array | One entry per year and month |
| `bareDaysPerYear` | array | One entry per year |
| `sources` | array | The datasets behind this file |

## `field`
| Key | Type | Example | Notes |
|---|---|---|---|
| `id` | string | `sample-denton-001` | Stable id |
| `county` | string | `Denton` | |
| `state` | string | `TX` | |
| `gridCell` | string | `L30-TX121-04417-08823` | 30 m Landsat-aligned cell id. **Never store raw GPS from the farmer.** |
| `lat`, `lon` | number | `33.2655`, `-97.188` | The **cell center**, not the farmer's tap |

## `soil` (USDA SSURGO)
| Key | Type | Example | Notes |
|---|---|---|---|
| `seriesName` | string | `Sanger` | Soil series |
| `texture` | string | `clay` | One of `clay`, `clay_loam`, `loam`, `sandy_loam` (translated in i18n `soil.texture`) |
| `drainageClass` | string | `well drained` | SSURGO drainage class, lowercase (translated in i18n `soil.drainage`) |
| `organicMatterPct` | number | `1.8` | Percent, topsoil |
| `hydrologicGroup` | string | `D` | `A`–`D` |

## `terrain` (SRTM 30 m)
| Key | Type | Notes |
|---|---|---|
| `slopePct` | number | Mean slope in percent across the cell |

## `cropHistory[]` (USDA Cropland Data Layer)
`{ year: number, crop: string }`. `crop` must be an `id` from `/content/crops.json`.

## `climateYearly[]`
| Key | Type | Source | Notes |
|---|---|---|---|
| `year` | number | | |
| `precipMm` | number | GPM IMERG | Annual total precipitation |
| `heatStressDays` | number | NASA POWER | Days with max temperature ≥ 35 °C (95 °F) |
| `frostFreeDays` | number | NASA POWER | Last spring frost to first fall frost |
| `soilMoistureAnomaly` | number | SMAP L4 | Growing-season mean, as a fraction compared to 2015–2025 normal (−0.28 = 28% drier). Before 2015, model or proxy |
| `heavyStormDays` | number | GPM IMERG | Days with ≥ 25 mm of rain |
| `yearType` | string | derived | `drought` \| `wet` \| `heat` \| `normal`. Pipeline rule to be agreed. Sample data: drought in 2006, 2011 and 2022 |

## `ndviMonthly[]` (Landsat / HLS, 30 m)
`{ year, month (1–12), ndvi (0–1) }`, the monthly median NDVI for the cell.
**Bare months are derived, not stored:** NDVI below `0.25` (`BARE_NDVI` in `app/src/data/loadField.js`).

## `bareDaysPerYear[]`
`{ year, days }`: estimated days per year with little or no plant cover (NDVI < 0.25, interpolated between scenes).

## `sources[]`
`{ dataset, variable, resolution, dateRange }`. These are shown on the expert handoff page. Dataset names should match the `EVIDENCE` names in `/scoring/scoreRotation.js`.

## Pipeline CSV outputs (`/pipeline/data/`)
Intermediate, monthly files from `pipeline/greenline_pipeline.py`. A later step turns them into the field JSON above
(for example `ndviMonthly` from Landsat filled with HLS/MODIS, `climateYearly` from POWER + IMERG + SMAP).
Empty cell = no valid data that month. All rows have `year` and, for monthly files, `month` (1–12).

| File | Columns | Units / notes |
|---|---|---|
| `power_monthly.csv` | `tMeanC, tMaxC, tMinC, precipMm, heatStressDays, frostDays, daysWithData` | °C monthly means of daily values; precip summed; heat stress = Tmax ≥ 35 °C; frost = Tmin ≤ 0 °C |
| `power_yearly.csv` | `lastSpringFrost, firstFallFrost, frostFreeDays, heatStressDays, precipMm, completeYear` | Frost = Tmin ≤ 0 °C, split at Jul 1. ISO dates |
| `landsat_monthly.csv` | `scenes, ndvi, ndti, bsi` | Monthly median of cloud-masked Landsat 5/7/8/9 C2 L2. NDTI = (SWIR1−SWIR2)/(SWIR1+SWIR2), residue; BSI = bare soil index |
| `hls_s30_monthly.csv` | `scenes, ndvi` | HLS Sentinel-2, Fmask cloud-masked |
| `modis_ndvi_monthly.csv` | `scenes, ndvi` | MOD13Q1, 250 m, good-quality pixels |
| `cdl_history.csv` | `code, cdlName` | One row per year (no month). Most common CDL class in the field. Map to `/content/crops.json` ids later |
| `smap_monthly.csv` | `days, sm_surface, sm_rootzone` | SMAP L4, m³/m³, ~11 km |
| `imerg_monthly.csv` | `precipMm` | GPM IMERG V07 monthly total |
| `terrain.csv` | `elevationM, slopePct` | One row. SRTM 30 m |
| `nass_crop_progress_tx_monthly.csv` | `crop, stage, pctMean, pctEndOfMonth, weeks` | Texas statewide weekly Crop Progress, averaged by month |

## Multi-field CSVs (`/pipeline/data/fields/`)
From `pipeline/sample_fields.py`: 200 random North Texas cropland pixels plus the demo field. Same as above,
plus a `fieldId` column. 30 m datasets are averaged over a 45 m buffer. Coarse grids (SMAP, IMERG) are sampled at the point.

| File | Columns | Notes |
|---|---|---|
| `fields.csv` | `fieldId, lon, lat, county` | CDL pixel centers chosen by us (never farmer GPS). `nt-001`… plus `demo-ellis-001` |
| `cdl.csv` | `fieldId, year, code` | CDL mode class, 2008–2025 |
| `landsat_monthly.csv` | `fieldId, year, month, scenes, ndvi, ndti, bsi` | As `landsat_monthly.csv` above |
| `power_monthly.csv` | `fieldId, powerCell, year, month, tMaxC, tMinC, precipMm, heatStressDays` | POWER daily, aggregated |
| `smap_monthly.csv` | `fieldId, year, month, days, sm_surface, sm_rootzone` | SMAP L4 v008, 2015– |
| `imerg_monthly.csv` | `fieldId, year, month, precipMm` | IMERG V07 monthly |
| `imerg_storms_monthly.csv` | `fieldId, year, month, stormDays` | Days with ≥ 25 mm (half-hourly IMERG summed by UTC day) |
| `modis_et_monthly.csv` | `fieldId, year, month, composites, etMm, petMm` | MOD16A2GF, sum of 8-day composites starting in the month |

## SI results (`/shared/si/`)
One small JSON per field (`<fieldId>.json`) plus `index.json`, written by `pipeline/models/export_si.py`.
How the models work and how accurate they are: `/pipeline/MODELS.md`. `schemaVersion` is `1`.

### Top level
| Key | Type | Notes |
|---|---|---|
| `schemaVersion` | number | `1` |
| `fieldId`, `county`, `state`, `lat`, `lon` | | Sample pixel center, not a farmer's position |
| `generated` | string | ISO date |
| `models` | object | Held-out (leave-one-year-out) scores. Same in every file. See below |
| `years[]` | array | One entry per field-year, 2008–2025 |
| `yearTypes[]` | array | `{ year, yearType }` from the k-means model, 1984–2025. `yearType` is `drought` \| `wet` \| `heat` \| `normal`. Same for every field (one POWER cell) |
| `replayPresets[]` | array | `{ year, yearType, severityZ }`: the worst past years for "bad-year replay" (e.g. 2011 drought) |

### `models`
| Key | Notes |
|---|---|
| `seasonCrop` | `approach`, `heldOutAccuracy`, `heldOutBalancedAccuracy`, `baselineAccuracy` (same crop as last year), `years`, `nFieldYears` |
| `vegStress` | `approach`, `presentAs: "weatherRiskSignal"`, `confidence: "low"`, `heldOutR2`, `heldOutBelowNormalBalancedAccuracy`, `showSignalFor` (crop classes where it beat "always normal"), `perCrop` |
| `yearPatterns` | `approach: "kmeans"`, `heldOutStability`, `years` |

### `years[]`
| Key | Type | Notes |
|---|---|---|
| `year` | number | |
| `cdlClass` | string | CDL label grouped: `corn`, `cotton`, `grain_sorghum`, `soybeans`, `winter_wheat`, `small_grain`, `fallow`, `double_crop`, `other`. Can be wrong (CDL label noise) |
| `predictedClass` | string | Model 1 prediction from a model that **did not see this year**. Never `double_crop` |
| `correct` | boolean \| null | Prediction = CDL. `null` for double-crop years |
| `doubleCropCdl` | boolean | CDL says double-cropped. Not modeled (too few examples). Show as "detected by CDL" |
| `doubleCropConfidence` | `"low"` \| null | |
| `fallow` | boolean | Model 1 predicted fallow |
| `months` | string[12] | `green` (NDVI ≥ 0.40), `residue` (0.25–0.40: sparse cover, stubble or residue), `bare` (NDVI < 0.25) |
| `greenDays`, `residueDays`, `bareDays` | number | Days per state (monthly values interpolated to daily). `bareDays` matches `bareDaysPerYear` |
| `bareDaysScore` | number | 0–100, `100 × (1 − bareDays / 365)`. Higher = more ground cover |
| `filledMonths` | number | Cloudy months filled by interpolation (lower confidence) |
| `greenUpDoy`, `senescenceDoy` | number \| null | Day of year. Only for corn, cotton, sorghum, soybeans with a clear season. ±15 days or more |
| `cropDriver` | object \| null | SHAP top driver for the crop call: `{ key, params, text }`. `key` is an i18n key (`si.driver.ndviMonth`, `si.driver.bsiMonth`, `si.driver.ndtiMonth`, `si.driver.ndvi_spring_minus_summer`, …), `params.month` 1–12. `text` is English, for debugging only |
| `yearType` | string \| null | From `yearTypes` |
| `stressMonths` | number[] \| null | Months (Apr–Sep, 2015–) where NDVI was below normal (z < −0.5) |
| `predictedStressMonths` | number[] \| null | Months the weather risk signal flagged (held-out). Show only if `cdlClass` is in `models.vegStress.showSignalFor`; otherwise show "Weather alone doesn't predict stress well for this crop" |
| `stressDriver` | object \| null | SHAP: the input that pushed greenness down most that season. `{ key: "si.driver.<feature>", params: { month, direction: "low" \| "high" }, text }` |

## v2 additions (`/shared/fields/<fieldId>.json`)
| Key | Type | Notes |
|---|---|---|
| `field.gridCell` | string | `L30-<fieldId>` for sampled fields (real per-cell ids are on the roadmap) |
| `field.state` | string | `TX`, or `OK` for 3 sample fields just across the Red River |
| `soil` | object | Real SSURGO (Soil Data Access), dominant component. Any value can be `null`. Adds `clayPct`. `texture` is from topsoil clay/sand |
| `terrain.elevationM` | number | SRTM |
| `cropHistory[]` | | Adds `cdlCode` and `cdlClass` (model group). `crop` is `"other"` when the CDL crop isn't in `crops.json` |
| `climateYearly[]` | | 1984–2025 from NASA POWER (`precipMm` is POWER, not IMERG). Adds `precipMmImerg` (2008–). `soilMoistureAnomaly` (2015–) and `heavyStormDays` (IMERG, 2008–) are `null` before their records start. `yearType` from the k-means model |
| `ndviMonthly[]` | | Landsat 5/7/8/9, 1984–2025. Cloudy months are left out |
| `coverYearly[]` | array | `{ year, months[12], cloudyMonths }`. `months` = `green` / `residue` / `bare` / `null` (no clear image). 2008+ come from model 1 |
| `bareDaysPerYear[]` | | Adds `greenDays` and `score` (0–100). Years with fewer than 9 clear months are left out |
| `quality` | object | `rainAgreement { years, corr, imergVsPowerPct }`, `modelAgreesWithCdlPct`, `cloudyMonthsPct`, `climateYears`, `cropYears`. Used by the confidence score |
| `si` | object | `{ models, years, replayPresets }`, the same as `/shared/si/<fieldId>.json` (below). `models.seasonCrop.perClass` adds held-out recall/precision per crop |

Known data caveat: Landsat 8 (2013–) reads NDVI slightly higher than Landsat 5/7 and the sensors are not harmonized yet,
so bare days after ~2015 may be undercounted.
