# Field data format (v3)

The app loads real fields from `/shared/fields/<fieldId>.json` (v3, built by `pipeline/build_fields.py`) and falls back to
`/shared/sample-field.json` (v1, fake) when a file is missing. v3 = everything in v1 below, plus the
"v2 additions" and "v3 additions" sections. Every v3 change is **additive**: no existing key changed meaning or value. `/shared/fields/index.json` lists `{ id, county, state, lat, lon }` for every field.

Every field file the app loads (today `sample-field.json`, later the pipeline outputs) **must** follow this format.
If you change it, bump `schemaVersion`, update this doc, and update `/shared/sample-field.json`.

## Top level

| Key | Type | Notes |
|---|---|---|
| `schemaVersion` | number | `3` for real fields, `1` for the fake sample |
| `isSampleData` | boolean | `true` for fake data. The app shows a "Sample data" badge |
| `field` | object | See below |
| `soil` | object | See below |
| `terrain` | object | See below |
| `cropHistory` | array | About 10 years |
| `climateYearly` | array | One entry per year, 2005–2025 |
| `ndviMonthly` | array | One entry per year and month |
| `bareDaysPerYear` | array | One entry per year (mixed Landsat sensors; see v3 additions) |
| `ndviMonthlyL89` | array | Same as `ndviMonthly`, **Landsat 8/9 only**, April 2013 on |
| `bareDaysPerYearL89` | array | Same as `bareDaysPerYear`, **Landsat 8/9 only**, 2014 on. **Use this for bare days** |
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
Each entry also has `sensor` (`"L5/L7"` or `"L7+L8/L9"`), `lowConfidence` (`true` before 2013) and, when low,
`lowConfidenceReason: "sensorMismatch"`. The sample marks its pre-2013 years the same way.

## `sources[]`
`{ dataset, variable, resolution, dateRange }`. These are shown on the expert handoff page. Dataset names should match the `EVIDENCE` names in `/scoring/scoreRotation.js`.
These four stay **strings** (the app calls `dateRange.replace(...)`). `dateRange` is `"YYYY-YYYY"`, a single year, or `"current"`.

Added (optional, additive; present in real field files and the sample):

| Key | Type | Notes |
|---|---|---|
| `id` | string | Stable short id: `power`, `imerg`, `prism`, `smap`, `landsat`, `cdl`, `ssurgo`, `srtm`, `modis_et`, `nass_quickstats`, `nass_progress`, `si` |
| `name` | string | Full product name, e.g. `SMAP L4 Global 3-hourly Surface and Root Zone Soil Moisture v008` (real fields only) |
| `product` | string | Catalog id or API, e.g. `NASA/SMAP/SPL4SMGP/008` (real fields only) |
| `provider` | string | e.g. `NASA GSFC`, `USDA NRCS` (real fields only) |
| `scale` | string | `patch` (30–70 m, read over the field itself), `area` (a km-scale grid cell; one value for the whole field), `county`, `state`, `model`. See `/docs/data-harmonization.md` |
| `resolutionM` | number \| null | Approximate pixel size in metres. `null` for map units, county, state and model |
| `startYear`, `endYear` | number \| null | The years this field actually has data for (`null` for SSURGO) |

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
| `nass_yields.csv` | `crop, state, level, county, district, year, value, unit, raw` | From `pipeline/nass_quickstats.py`. Our counties, their districts, TX and OK state |
| `nass_prices_tx.csv` | `crop, year, value, unit` | Texas, marketing year |
| `nass_crop_progress_tx_monthly.csv` | `crop, stage, pctMean, pctEndOfMonth, weeks` | Texas statewide weekly Crop Progress, averaged by month |

## Multi-field CSVs (`/pipeline/data/fields/`)
Built by `pipeline/fieldshift/build_app_inputs.py` for the **300 Field Shift study fields** (`ec-000` … `ec-299`, USDA
Crop Sequence Boundary outlines within ~4 km of 32.25 N, 96.75 W). Same columns as the old `sample_fields.py` tables for
201 North Texas points (retired, in git history). Landsat values are the **whole-outline average** per scene (clear
fraction ≥ 0.6, Landsat 5/7/8/9 only, HLS left out), monthly median of scenes. NASA POWER, SMAP (L3 surface; written to
both `sm_surface` and `sm_rootzone`), IMERG (daily, 2001+) are one study-area series repeated for every field; PRISM is
the 4 km series of old sample nt-103 (4.8 km south of the centre), labelled "area" in the app. SSURGO and SRTM are per
field. `modis_et_monthly.csv` is not built (not used by the app).

| File | Columns | Notes |
|---|---|---|
| `fields.csv` | `fieldId, lon, lat, county, state` | Study field outline centroids (never farmer GPS). `ec-000` … `ec-299` |
| `cdl.csv` | `fieldId, year, code` | CDL mode class, 2008–2025 |
| `landsat_monthly.csv` | `fieldId, year, month, scenes, ndvi, ndti, bsi` | As `landsat_monthly.csv` above |
| `landsat_monthly_l89.csv` | `fieldId, year, month, scenes, ndvi, ndti, bsi` | Same processing, **Landsat 8 and 9 only** (no Landsat 7), April 2013–2025. `sample_fields.py landsat_l89` |
| `power_monthly.csv` | `fieldId, powerCell, year, month, tMaxC, tMinC, precipMm, heatStressDays` | POWER daily, aggregated |
| `smap_monthly.csv` | `fieldId, year, month, days, sm_surface, sm_rootzone` | SMAP L4 v008, 2015– |
| `imerg_monthly.csv` | `fieldId, year, month, precipMm` | IMERG V07 monthly |
| `imerg_storms_monthly.csv` | `fieldId, year, month, stormDays` | Days with ≥ 25 mm (half-hourly IMERG summed by UTC day) |
| `modis_et_monthly.csv` | `fieldId, year, month, composites, etMm, petMm` | MOD16A2GF, sum of 8-day composites starting in the month |
| `ssurgo.csv` | `fieldId, mukey, compname, drainagecl, hydgrp, comppct_r, om, clay, sand, kwfact, kffact, awc, tfact, nirrcapcl, nirrcapscl, aws0100wta` | Soil Data Access, dominant major component, topsoil horizon |
| `prism_monthly.csv` | `fieldId, year, month, precipMm, tMeanC, tMinC, tMaxC` | `OREGONSTATE/PRISM/ANm`, 4 km, 1984–2025, sampled at the point |
| `prism_yearly.csv` | `fieldId, year, days, precipMm, stormDays, lastSpringFrostDoy, firstFallFrostDoy, frostFreeDays` | From `OREGONSTATE/PRISM/ANd` daily, computed server-side. Days run 12:00–12:00 UTC |

## SI results (`/shared/si/`)
One small JSON per field (`ec-NNN.json`) plus `index.json`, written by `pipeline/fieldshift/export_si.py` from the
Field Shift models. How the models work and how accurate they are: `/pipeline/MODELS.md`. `schemaVersion` is `2`
(schema 1 was the retired models on the 201 `nt-*` fields).

### Top level
| Key | Type | Notes |
|---|---|---|
| `schemaVersion` | number | `2` |
| `fieldId`, `county`, `state`, `lat`, `lon` | | Study field outline centroid, not a farmer's position |
| `generated` | string | ISO date |
| `models` | object | Scores on unseen years 2023–2025. Same in every file. See below |
| `years[]` | array | One entry per field-year, 1986–2025 |
| `yearTypes[]` | array | `{ year, yearType, p }` from Model 3, 1985–2025. `yearType` is `drought` \| `wet` \| `heat` \| `normal` (Model 3's "hot" = `heat`); `p` = EM probability of that label. Same for every field (one POWER point) |
| `replayPresets[]` | array | `{ year, yearType, severityZ }`: every drought year plus the two most extreme wet and hot seasons |

### `models`
| Key | Notes |
|---|---|
| `seasonCrop` | `approach`, `validation: "unseenYears"`, `years` [2023, 2025], `heldOutAccuracy`, `heldOutBalancedAccuracy` (all fields), `heldOutAccuracyClean` (fields with ≥ 70% one USDA label), `baselineAccuracy` (same crop as last year), `nFieldYears`, `trainPurityMin`, `classes`, `perClass.<class>.{recall, precision, f1, n}` |
| `vegStress` | `approach`, `presentAs: "stressModel"`, `heldOutAuc`, `heldOutAccuracy`, `heldOutBalancedAccuracy`, `heldOutR2`, `cvAuc`, `baselineCvAuc` (last month only), `threshold` (stress probability that counts as flagged), `showSignalFor` (classes) |
| `yearPatterns` | `approach: "kmeans"`, `k`, `silhouette`, `agreementWithEm` (ARI), `years`, `groups.<type>` (number of years) |

### `years[]`
| Key | Type | Notes |
|---|---|---|
| `year` | number | |
| `cdlClass` | string \| null | USDA CDL label in the model's classes: `winter_grain`, `summer_grain` (corn + sorghum), `cotton`, `grass_hay`, `fallow`. 2008+; null for other land or no label |
| `predictedClass` | string | Model 1 label (model refit on all years) |
| `confidence` | number | Model 1 probability of that label |
| `cropFinal`, `cropSource` | string | USDA label where it exists (`usda`), the model's otherwise (`model`) |
| `heldOutPredicted`, `correct` | string \| null, boolean \| null | Only for 2023–2025: the prediction of the model trained before 2023, and whether it matched USDA. Null elsewhere |
| `greenDays`, `residueDays`, `bareDays` | number \| null | Model 1 day states (green NDVI ≥ 0.35; bare NDVI < 0.25 and NDTI < 0.165; else residue). The app's own bare days are `bareDaysPerYear*` |
| `greenUpDoy`, `senescenceDoy`, `peakDoy` | number \| null | Day of year from the season curve |
| `cropDriver`, `stressDriver` | null | Not exported by the Field Shift models (kept for the app's format) |
| `yearType` | string \| null | From `yearTypes` |
| `stressMonths` | number[] \| null | Months the field's NDVI was in its lowest 20% (vs. earlier years). From 1990 on |
| `predictedStressMonths` | number[] \| null | Months Model 2 gave a stress probability ≥ `models.vegStress.threshold` |

## v2 additions (`/shared/fields/<fieldId>.json`)
| Key | Type | Notes |
|---|---|---|
| `field.gridCell` | string | `L30-<fieldId>` for sampled fields (real per-cell ids are on the roadmap) |
| `field.state` | string | `TX`, or `OK` for 3 sample fields just across the Red River |
| `soil` | object | Real SSURGO (Soil Data Access), dominant component. Any value can be `null`. Adds `clayPct` and the soil keys below. `texture` is from topsoil clay/sand |
| `soil.kFactor` | number | Erosion factor K (`kwfact`, topsoil), 0.02–0.69. Higher = erodes more easily |
| `soil.tFactor` | number | Tolerable soil loss T, tons/acre/year (1–5) |
| `soil.awcCmPerCm` | number | Topsoil available water capacity, cm of water per cm of soil |
| `soil.waterStorage100Cm` | number | Plant-available water in the top 100 cm, cm (map-unit weighted `aws0100wta`). ÷ 2.54 = inches |
| `soil.landCapabilityClass` | string | Non-irrigated land capability, class 1–8 + subclass: `e` erosion, `w` wetness, `s` soil limits, `c` climate. E.g. `2e` |
| `terrain.elevationM` | number | SRTM |
| `cropHistory[]` | | Adds `cdlCode` and `cdlClass` (model group). `crop` is `"other"` when the CDL crop isn't in `crops.json` |
| `climateYearly[]` | | 1984–2025 from NASA POWER (`precipMm` is POWER, not IMERG). Adds `precipMmImerg` (2008–). `soilMoistureAnomaly` (2015–) and `heavyStormDays` (IMERG, 2008–) are `null` before their records start. `yearType` from the k-means model |
| `climateYearly[]` PRISM keys | | `precipMmPrism` (mm), `stormDaysPrism` (days ≥ 25 mm), `lastSpringFrostPrism`, `firstFallFrostPrism` (ISO dates, Tmin ≤ 0 °C split at Jul 1, same rule as POWER), `frostFreeDaysPrism`. PRISM 4 km, gauge-based. Any can be `null` (e.g. no fall frost) |
| `climateMonthly[]` | array | PRISM, 2008–2025: `{ year, month, precipMm, tMinC, tMaxC }` (°C, monthly means of daily min/max) |
| `ndviMonthly[]` | | Landsat 5/7/8/9, 1984–2025. Cloudy months are left out |
| `coverYearly[]` | array | `{ year, months[12], cloudyMonths }`. `months` = `green` / `residue` / `bare` / `null` (no clear image). 2008+ come from model 1 |
| `bareDaysPerYear[]` | | Adds `greenDays` and `score` (0–100). Years with fewer than 9 clear months are left out |
| `quality` | object | `rainAgreement { years, corr, imergVsPowerPct }`, `rainVsPrism { power, imerg }` (each `{ years, corr, pct }` or `null`: annual rain vs PRISM, `pct` = how much higher than PRISM), `modelAgreesWithCdlPct`, `cloudyMonthsPct`, `climateYears`, `cropYears`. Used by the confidence score |
| `market` | object | USDA NASS Quick Stats (survey). `{ county, district, priceState: "TX", yields[], pricesTx[], recent[] }`. Same for every field in a county |
| `market.yields[]` | | `{ crop, year, value, unit, level }`, 2008–2025. `level` = `county`, or the fallback `district` (NASS stopped district yields after 2019) or `state` when NASS doesn't publish the county. `crop` ids: `corn`, `cotton` (upland), `grain_sorghum`, `winter_wheat`, `soybeans`, `oats`, `sunflower` (soybeans and oats aren't in `crops.json` yet) |
| `market.pricesTx[]` | | `{ crop, year, value, unit }`: Texas marketing-year average price received, nominal $. Units differ: `$/bu`, `$/lb` (cotton), `$/cwt` (sorghum, sunflower), `$/ton` (`alfalfa` hay). Oklahoma fields use Texas prices too |
| `market.recent[]` | | `{ crop, years, yield, yieldUnit, yieldLevel, yieldYears, price, priceUnit, grossPerAcreUsd }`: 2021–2025 averages at one level (county if ≥ 3 years, else district, else state). `grossPerAcreUsd` = yield × price after unit conversion (sorghum 56 lb/bu, sunflower lb → cwt). Gross revenue, **not profit**; costs aren't included |
| `si` | object | `{ models, years, replayPresets }`, the same as `/shared/si/<fieldId>.json` (below). `models.seasonCrop.perClass` adds held-out recall/precision per crop |

## v3 additions: Landsat 8/9-only cover and sensor flags

**Why:** for the same field and month, Landsat 7 reads NDVI about **0.05 lower** than Landsat 8. With a fixed 0.25 bare
cutoff, that adds bare days. The mixed record (`ndviMonthly`, `coverYearly`, `bareDaysPerYear`) blends Landsat 7 into
the monthly medians until ~2023, so its 2013–2023 bare days are too high too, not just pre-2013. A published cross-sensor
correction was tried and rejected (`/docs/datasets.md`, "Tried and rejected"). The `*L89` keys use **one sensor family**.
Results: `/docs/landsat89-cover-results.md`.

| Key | Type | Notes |
|---|---|---|
| `ndviMonthlyL89[]` | array | `{ year, month, ndvi }`, Landsat 8/9 only, 2013-04 to 2025. Cloudy months are left out |
| `coverYearlyL89[]` | array | `{ year, months[12], cloudyMonths }`, 2013–2025. Same states and 0.25 / 0.40 rule as `coverYearly`, computed straight from `ndviMonthlyL89` (gaps of ≤ 2 months interpolated). **2013 Jan–Mar are `null`** (before Landsat 8) and not counted in `cloudyMonths`. Months still missing after filling are `null` |
| `bareDaysPerYearL89[]` | array | `{ year, days, greenDays, score }`, **2014–2025** (first full Landsat 8 year). Same rule as `bareDaysPerYear`: years with fewer than 9 clear months are left out |
| `coverYearly[]`, `bareDaysPerYear[]` | | Each entry adds `sensor` (`"L5/L7"` before 2013, `"L7+L8/L9"` from 2013), `lowConfidence` (`true` before 2013) and `lowConfidenceReason: "sensorMismatch"` when low. **Values are unchanged** |
| `quality.cloudyMonthsPctL89` | number | % of April 2013–2025 months with no clear Landsat 8/9 image |
| `sources[]` `id: "landsat89"` | | New entry, `dataset: "Landsat 8/9"`. Cite it on bare-day reasons that use the `*L89` keys |

How the two records relate:
- **2024–2025:** almost no Landsat 7 is left, so old and new bare days agree in 100% of field-years.
- **Model 1 (`si`, `coverYearly.months` for 2008+)** still uses the mixed record and **was not retrained**. In the few months
  that can't be interpolated, `coverYearly` holds model 1's gap fill and `coverYearlyL89` holds `null`.
- **Pre-2013:** there is no Landsat 8/9 data. Show those years from the old keys, marked low confidence.

## `/shared/crop-calendars-l89.json` (per-crop bare-month calendars)
One file for all fields, made by `pipeline/build_fields.py`. The same counting as `scoring/tools/build_calendars.mjs`,
but from `coverYearlyL89` for 2014–2025:

| Key | Type | Notes |
|---|---|---|
| `years` | [number, number] | `[2014, 2025]` |
| `bareNdvi` | number | `0.25` |
| `crops.<cdlClass>.bareShare` | number[12] | Jan–Dec: share of field-years with this CDL class where the month was bare (of the clear months). `null` if never clear |
| `crops.<cdlClass>.clearFieldYears` | number[12] | Field-years with a clear (non-null) state that month |
| `crops.<cdlClass>.fieldYears` | number | Field-years with this class, 2014–2025 |

`cdlClass` is the model group: `corn`, `cotton`, `grain_sorghum`, `soybeans`, `winter_wheat`, `small_grain`, `fallow`,
`other`, `double_crop`. Only the 200 sampled fields (`nt-*`); `demo-ellis-001` is pasture and is left out, as in `build_calendars.mjs`.

## `/shared/cropland-mask.json` (is this spot cropland?)
Built by `pipeline/build_cropland_mask.py`. Read by `croplandAt(lat, lon)` in `app/src/data/loadField.js` to warn when a
map tap or GPS fix is not on cropland. Same cropland rule as the field sample: USDA CDL cropland in 2024 and in at least
half of 2008–2025.

| Key | Type | Meaning |
|---|---|---|
| `schemaVersion` | number | 1 |
| `source` | string | Dataset and rule |
| `years` | [from, to] | CDL years used |
| `bbox` | [west, south, east, north] | Degrees (WGS84), same box as the field sample |
| `cellDeg` | number | Cell size in degrees (0.004, ~400 m) |
| `threshold` | number | A cell is cropland when at least this share of its 30 m pixels is cropland |
| `cols`, `rows` | number | Grid size |
| `bits` | string | Base64 bitset, row-major from the north-west corner, most significant bit first (numpy `packbits`). 1 = cropland |

Cell for a point: `row = floor((north - lat) / cellDeg)`, `col = floor((lon - west) / cellDeg)`, bit `row * cols + col`.
The app also accepts a cropland cell next to the point (tap imprecision). Outside `bbox` the answer is "unknown".

## `/shared/fieldshift/ellis-study.json` (Field Shift study: season replay + recommender)
Built by `pipeline/fieldshift/export_app.py` from the Field Shift models and season replay (see
`pipeline/fieldshift/README.md`). Read by `app/src/components/FieldShiftStudy.jsx` (Compare screen, Ellis County fields
only). It describes **one typical Ellis County field at one NASA POWER point** (32.25 °N, 96.75 °W), not a sampled `nt-*`
field, and never changes field scores. Numbers, keys and grades only; all words are in i18n `fieldShift.*`.

| Key | Type | Meaning |
|---|---|---|
| `schemaVersion` | number | 1 |
| `generated` | date | Export date |
| `area` | object | `county`, `state`, `lat`, `lon`, `nFields` (300 study fields, ids 0–299, no geometry) |
| `models.seasonCrop` | object | Model 1: `accCleanFields`, `accAllFields` (unseen years `testYears`), `cvAccClean`, per-class `f1` |
| `models.vegStress` | object | Model 2 (leak-free `_causal` version): `testAuc`, `testAcc`, `testBalAcc`, `testR2`, `cvAuc`, `cvAcc`, `cvR2` |
| `models.yearPatterns` | object | Model 3: `k`, `silhouette`, `silhouetteEm`, `ariKmeansVsEm`, `groups` (years per type), `droughtNdviAnom` |
| `yearTypes[]` | `{ year, type, p }` | Model 3 label per season 1985–2025 (`drought` / `hot` / `normal` / `wet`), `p` = EM probability of that label |
| `recommender.anchors` | object | Per goal `[score 0 value, score 100 value]` |
| `recommender.presets.<preset>` | object | `balanced`, `income_first`, `soil_first`, `low_risk` (below) |

Each preset: `weights`, `current` and `recommended` cards, `runnerUp` (rotation key), `keepCurrent`, `confidence`
(`high`/`medium`/`low`), `closeCall`, `scenarios` (10), `gapPoints`, `ranking[]` (`{ key, overall, grade, avg }`, ordered by
`avg` = average score over the 10 scenarios). A card: `key`, `overall` (0–100, today's climate, high prices), `grade`
(A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, F), `rank`, `winsShare`, `dims.<goal>.{score, grade}`, and `metrics`: `bare_days`,
`soil_loss_t_ha` (t/ha/yr; the app shows US tons/acre), `return_above_var_typical`, `return_above_var_worst10`,
`return_above_var_drought` ($/acre), `loss_years_pct`, `fertilizer_n_lb`, `n_credit_lb`, `eqip_per_year` ($/acre, shown,
never scored), `pest_index` (0–100, lower is better).
Rotation keys: `current` (wheat, bare summer), `wheat_soy`, `wheat_cowpea`, `sorghum_rye`, `corn_wheat_soy`,
`sorghum_clover`, `sorghum_wheat_cowpea`.

## Field outlines (`/shared/field-outlines.json`)
Built by `node pipeline/build_field_outlines.mjs` from `pipeline/fieldshift/data/fields.geojson` (USDA NASS Crop Sequence
Boundaries, public data; never a farmer's position). Bundled with the app so the map outlines draw offline.

| Key | Type | Notes |
|---|---|---|
| `schemaVersion` | number | 1 |
| `source` | string | Where the outlines come from |
| `fields[].id` | string | `ec-000` … `ec-299`, same ids as `/shared/fields/` |
| `fields[].acres` | number | Area of the USDA outline, 1 decimal |
| `fields[].rings` | number[][][] | `[lat, lon]` points rounded to 5 decimals (~1 m). First ring = outline, the rest = holes |

## Map context layers (`/shared/map-layers.json`)
Built by `node pipeline/build_map_layers.mjs` (after `build_field_outlines.mjs`; needs internet once). US Census TIGER
(public domain) from the TIGERweb REST service, plus a hull around the USDA field outlines. Bundled (~3.5 kB), works offline.

| Key | Type | Notes |
|---|---|---|
| `county` | number[][][] | Ellis County boundary rings, `[lat, lon]`, simplified to ~200 m |
| `towns[]` | object | `name`, `geoid`, `lat`, `lon` (Census internal point), `tier` 1–3 by land area (1 = biggest, labeled at lower zoom). Names are not translated |
| `dallas` | object | `lat`, `lon` (on the county's north edge toward Dallas), `km` from the study centre |
| `studyHull` | number[][] | Convex hull of the 300 outlines, padded 450 m |
| `studyCenter`, `studyLabel` | number[] | Mean of the outline points; the hull's northmost point (label anchor) |
| `nearestTown` | string | Town nearest the study centre (used in "data near ...") |
| `frame` | number[][] | Opening map view: the hull plus its 3 nearest towns |
