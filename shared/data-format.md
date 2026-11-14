# Field data format (v1)

Every field file the app loads (today `sample-field.json`, later the pipeline outputs) **must** follow this format.
If you change it, bump `schemaVersion`, update this doc, and update `/shared/sample-field.json`.

## Top level

| Key | Type | Notes |
|---|---|---|
| `schemaVersion` | number | Currently `1` |
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
