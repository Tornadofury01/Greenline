# Field Shift v2: data to export

All the data needed to train Models A–D and Calibration E, build the crop library and simulator, and run validation checks 1–8.
Earth Engine IDs were current as of Nov 2026. **Check each version suffix in the catalog before you run anything**, because versions get bumped.

## 0. Scope and study design

**Decided 2026-11-14: North Texas only. Every Earth Engine export must finish within 3–4 hours.**
This replaces the plan's "any US field, 8–10 regions across the US". The multi-region test is now a held-out-county test inside North Texas.
Scripts and the 6-account split are in `v2/ee_exports/` (see its README).

| Item | Now |
|---|---|
| Counties | 6 Blackland Prairie counties: Ellis 48139 (home), **Hill 48217 (held out: never trained on)**, Navarro 48349, Kaufman 48257, Johnson 48251, McLennan 48309 (southern edge, kept for the Riesel erosion watersheds). |
| Fields | USDA CSB 2016–2023 from Earth Engine (`projects/sat-io/open-datasets/USDA/CSB_1623`). Centroid in the county, ≥ 10 ha, buffered **45 m inward**, ≥ 50 Landsat pixels left. **300 per county, 1,800 in total**, sampled at random (seed 42) and built in EE by `prepare_fields_ee.py`. |
| Neighbor pool | Same fields. |
| Years | 1985–2025. Hold out 2020–2025 by year, and Hill County by region. |
| Jobs | One job = all 1,800 fields × one year (the counties are adjacent, so one scene covers most of them). Fine sensors as **field × scene**, daily grids as **field × month** with `dDD_<band>` columns, coarse grids at county centroids. |
| Time budget | Tier 1 (core) ≈ 24 h of EE task time over 6 accounts ≈ 4 h each ≈ 1.3 h wall at 3 tasks at once. Tier 2 adds ≈ 0.6 h wall. These are guesses; correct them with `status.py`. |
| QA columns | `tot_count` (field pixels in the footprint), `<band>_count` (clear pixels), `snow_count`, `sensor`, `cloud_cover`. Gaps stay missing, never zero. |
| Format | CSV from EE; the cube builder converts it to Parquet. |

**Not used:** ECOSTRESS (decided 2026-11-14). It is only on NASA AppEEARS, and the point requests hit its size limit. In its place: **OpenET DisALEXI** (30 m monthly thermal ET, 2001–2024; DisALEXI ET / gridMET ETo = an ESI-like stress ratio), the **OpenET ensemble** (2000–2024), and **TerraClimate** (monthly deficit / AET / PET / soil water, 1985–2024). Landsat surface temperature, MODIS ET and land surface temperature, and SMAP cover the rest. ECOSTRESS is listed as a data limit.

**What North Texas changes below:**
- **Tier 2 (only if time):** Landsat 7 outside 2012, HLS L30 (same scenes as Landsat 8/9), Sentinel-1, PRISM, MODIS land surface temperature and NDVI, IrrMapper.
- **Tier 3 (off by default):** Sentinel-2 SR, OpenET, POLARIS, LANID.
- **Narrowed to Texas sources:** costs come from AgriLife budgets, not ERS regions; local prices from the AMS Texas grain reports; soil moisture stations from TxSON and SCAN in Texas.

v1 Ellis exports used whole-outline averages, which read too green. Redo them with the 45 m buffer. Don't reuse them.

## 1. Earth Engine exports

### Optical and thermal: per field, per scene (the slowest exports, so start these first)

| Dataset | EE ID | Bands / values | Years | Feeds |
|---|---|---|---|---|
| Landsat 5 | `LANDSAT/LT05/C02/T1_L2` | SR_B1–B7 → NDVI, NDTI, BSI; ST_B6 surface temp; QA_PIXEL mask | 1985–2011 | A (history), B, D |
| Landsat 7 | `LANDSAT/LE07/C02/T1_L2` | same, ST_B6. SLC-off stripes after May 2003 are fine once masked | 1999–2023 | A, B. **It is the only Landsat for 2012.** |
| Landsat 8 / 9 | `LANDSAT/LC08/C02/T1_L2`, `LANDSAT/LC09/C02/T1_L2` | SR_B2–B7 → NDVI, NDTI, BSI; ST_B10; QA_PIXEL | 2013– / 2021– | A, B, D |
| HLS Landsat | `NASA/HLS/HLSL30/v002` | B2–B7 indices, Fmask | 2013– | A, B (denser time series) |
| HLS Sentinel-2 | `NASA/HLS/HLSS30/v002` | indices + **red-edge B5, B6, B7, B8A** → NDRE, CIre; Fmask | late 2015– | A (corn vs sorghum etc.) |
| Sentinel-2 SR (optional) | `COPERNICUS/S2_SR_HARMONIZED` | red-edge at native 20 m; SCL mask | 2017– | A, if HLS red-edge proves too coarse |

Per scene and field, export the **median and the 10th / 90th percentile** of each index over clear pixels, plus the pixel counts. Use the same index formulas for every sensor. Keep L5/7 and L8/9 separate, because harmonizing them was tried and rejected.

### Radar: per field, per scene

| Dataset | EE ID | Values | Years | Feeds |
|---|---|---|---|---|
| Sentinel-1 GRD | `COPERNICUS/S1_GRD` (IW, VV+VH) | VV, VH, VH/VV. **Average in linear power, then convert to dB.** Keep `orbitProperties_pass`, `relativeOrbitNumber`, and the incidence angle | Oct 2014– | A (cloudy days, structure), D (wetness) |

Revisit is every 12 days from 2022 to 2024, because Sentinel-1B failed in Dec 2021. Sentinel-1C has been in service since 2025.

### Coarse daily grids: per field, per day (area-weighted over the buffered polygon)

| Dataset | EE ID | Variables | Years | Feeds |
|---|---|---|---|---|
| Daymet V4 | `NASA/ORNL/DAYMET_V4` | prcp, tmax, tmin, srad, vp, dayl, swe | 1985–(last year in catalog) | Simulator weather, GDD, frost, B, C |
| gridMET | `IDAHO_EPSCOR/GRIDMET` | pr, tmmx, tmmn, rmax, rmin, vs (wind), srad, **eto**, vpd | 1985–present | Reference ET0, wind, humidity for pest risk, and the years Daymet hasn't reached yet |
| gridMET drought | `GRIDMET/DROUGHT` | SPI / SPEI 30d–1y, EDDI, PDSI | 1985– | C (features and checks) |
| PRISM daily | `OREGONSTATE/PRISM/AN81d` | ppt, tmax, tmin | 1985– | Cross-check of Daymet (data agreement) |
| GPM IMERG V07 | `NASA/GPM_L3/IMERG_V07` | precipitation → daily total, **max 30-min rate**, max 1-h rate | Jun 2000– | Erosion (storm intensity), B |
| SMAP L3 enhanced | `NASA/SMAP/SPL3SMP_E/006` | soil_moisture_am / _pm, retrieval QA | Apr 2015– | B, D (target), starting state |
| SMAP L4 | `NASA/SMAP/SPL4SMGP/007` | sm_surface, **sm_rootzone**, 3-hourly → daily | Apr 2015– | Simulator root-zone start, water fit check |
| MODIS NDVI | `MODIS/061/MOD13Q1` | NDVI, EVI, 250 m 16-day | 2000– | Fills Landsat cloud gaps (A) |
| MODIS ET | `MODIS/061/MOD16A2GF` | ET, PET 8-day | 2000– | B, water-balance check |
| MODIS LST | `MODIS/061/MOD11A1` + `MYD11A1` | LST day/night, QC | 2000– / 2002– | B, D |
| OpenET (optional) | `OpenET/ENSEMBLE/CONUS/GRIDMET/MONTHLY/v2_0` | 30 m ensemble ET | 2016– (West from 1999) | Independent ET check for the simulator |

### Very coarse: value at the field's location

| Dataset | EE ID | Variables | Years | Feeds |
|---|---|---|---|---|
| GRACE / GRACE-FO mascons | `NASA/GRACE/MASS_GRIDS_V04/MASCON_CRI` | lwe_thickness, uncertainty | 2002– | Groundwater trend flag |
| GLDAS Noah | `NASA/GLDAS/V021/NOAH/G025/T3H` | soil moisture layers, SWE, canopy water | 2002– | Subtracted from GRACE to get **groundwater** alone |
| NEX-GDDP-CMIP6 | `NASA/GDDP-CMIP6` | pr, tasmax, tasmin, hurs, rsds, sfcWind | historical 1985–2014 + ssp245 & ssp585 2030–2050 | 2040 scenarios (delta method on Daymet/gridMET), C in 2040 |

For CMIP6, use **8 models**: ACCESS-CM2, CanESM5, EC-Earth3, GFDL-ESM4, INM-CM5-0, MIROC6, MPI-ESM1-2-HR, MRI-ESM2-0. Those 8 back "holds under 8 of 8 climate models". Export the historical run too, because deltas need it.

### Static layers: once per field

| Dataset | EE ID | Values | Feeds |
|---|---|---|---|
| USGS 3DEP 10 m | `USGS/3DEP/10m` | elevation mean, slope mean / p90, slope length (LS factor input) | Erosion, runoff |
| SRTM 30 m | `USGS/SRTMGL1_003` | elevation, slope (fallback) | Same |
| MERIT Hydro | `MERIT/Hydro/v1_0_1` | upa (flow accumulation) → **terrain wetness index** | D |
| CDL | `USDA/NASS/CDL` | cropland majority code, **purity** (share of the majority class), mean `confidence` | A labels (2008+), label purity |
| IrrMapper (West) | `UMT/Climate/IrrMapper_RF/v1_2` | irrigated yes/no per year | B (keep irrigated fields apart), irrigation default |
| NAIP | `USDA/NAIP/DOQQ` | 0.6–1 m image chips, not stats | Hand labels for Model A (see §3) |

## 2. Downloads outside Earth Engine

| Dataset | Where | What to pull | Feeds |
|---|---|---|---|
| Crop Sequence Boundaries | In EE: `projects/sat-io/open-datasets/USDA/CSB_1623` (no download) | Polygons + crop sequence for the 6 counties | Field picking, sampling, neighbors |
| gSSURGO / SSURGO | NRCS Soil Data Access (REST), area-weighted per polygon | om_r, clay/sand/silt, dbthirdbar_r, awc_r, ksat_r, kwfact, kffact, **tfact**, wei, ph1to1h2o_r, cec7_r, hydgrp, drainagecl, aws0100wta, horizon depths, wtdepannmin, flodfreqcl, nirrcapcl | Simulator soil, erosion (K, T), B, D |
| POLARIS 30 m (optional) | Duke / Hydroshare | Soil property maps with uncertainty | Soil ranges for the what-if runs |
| NASA POWER | power.larc.nasa.gov API | T2M, RH2M, WS2M, ALLSKY_SFC_SW_DWN, PRECTOTCORR | ET0 backup, outside the US |
| NASS Quick Stats (free key) | quickstats.nass.usda.gov API | County **yield, planted and harvested acres** (irrigated / non-irrigated), 1985–2025, all region crops; **crop progress** (weekly % planted, emerged, harvested, by state); prices received (monthly, state); **county cash rents** | E, B, market fit, checks 3–4 |
| Census of Agriculture | NASS (2012, 2017, 2022) | County cover-crop acres, no-till / reduced-till acres, irrigated acres | Check of Model A cover-crop and tillage detection |
| RMA Cause of Loss + Summary of Business | USDA RMA | County × crop × year indemnities by cause (drought, heat, excess moisture, hail) | **Labels and check for Model B**, C |
| US Drought Monitor | droughtmonitor.unl.edu data services | Weekly county % in D0–D4, 2000– | C check |
| ENSO index (optional) | NOAA CPC ONI | Monthly ONI | C feature |
| ERS Costs and Returns | USDA ERS | Per crop, by Farm Resource Region | Default costs outside Texas |
| Extension budgets | AgriLife (TX), K-State, Iowa State, NDSU, MSU, UGA, WSU | Per crop per district: costs, yields, N rates | Default costs, N rates |
| AMS Market News (MARS API) | mymarketnews.ams.usda.gov | Daily / weekly cash grain bids by region; **Illinois Production Cost Report** (fertilizer) | Local price, market fit, N price |
| WASDE | USDA OCE | Season-average price forecasts | Price ranges |
| EQIP payment schedules | NRCS, by state, yearly | Cover crop (340), no-till (329), nutrient management (590) | Cost-share (shown, not scored) |
| LANID (optional) | Published dataset (Zenodo) | 30 m irrigated land, CONUS, 1997–2020 | Irrigated flag in the East |

## 3. Labels and ground truth (the models are only as honest as these)

| Model | Label | Source | Gap and fix |
|---|---|---|---|
| A: crop type | Crop per field-year | CDL majority, **purity ≥ 0.7**, 2008+ | Nothing before 2008. Show the classifier's 1985–2007 output with its confidence. |
| A: daily state (green / residue / bare) | State on a date | **Hand-label ~1,000 field-dates** from HLS / S2 true color + NAIP. Spread the sample across regions, months and states. | No national truth exists. Census tillage and cover-crop acres are the only aggregate check. |
| A: crop dates | Green-up, peak, harvest | NASS **crop progress** (state, weekly) | State level only, so compare distributions, not single fields |
| A: cover crops | Cover present in winter | Census cover-crop acres (county); hand labels | Weak. Report detection as county share vs Census. |
| B: stress | NDVI drop below the field's normal (from **earlier years only**, leak-free) | Landsat / HLS | Link NDVI loss to yield loss with NASS county yields and RMA drought and heat losses. Train irrigated and dryland fields separately. |
| C: year types | None (clustering) | — | Check against Drought Monitor, RMA losses, NASS yields |
| D: soil moisture | Field soil moisture | **In situ**: NRCS SCAN, USCRN, TxSON, ISMN stations in or near the regions | Without these, D can only be checked against SMAP itself, which is circular |
| E: yields | County yield by year | NASS (fit on early years, test on later years) | County, not field. Report it that way. |

## 4. Validation-only data

| Check | Data |
|---|---|
| 2. Bare days | Model A hand labels + daily state |
| 3. Crop dates | NASS crop progress |
| 4. Yields | NASS county yields (years not used in E) |
| 5. Erosion | **USDA-ARS Riesel watersheds** (McLennan TX, runoff and sediment since the 1930s) via the ARS STEWARDS database; LTAR network sites; NRCS NRI state erosion rates |
| 6. Soil moisture | SMAP L3 / L4 + SCAN, USCRN, TxSON |
| 7. Neighbor backtest | CSB sequences + Landsat for the sampled fields |
| 8. Expert ranking | Interview with an AgriLife agent (no download) |

## 5. Crop library sources (collected, not exported)

FAO ECOCROP (temperature, rain and frost limits); FAO-56 Tables 11–12 (stage lengths, Kc); FAO-33 / 66 (Ky drought response); AquaCrop / AquaCrop-OSPy crop files (water productivity, canopy curves); USDA PLANTS; Midwest and Southern Cover Crops Council decision tools (cover seeding and termination windows); nutrient removal per bushel (IPNI / extension); RUSLE C-factor tables (ground cover by stage); extension pest guides (host and break table).

## 6. Run order (3–4 h window)

1. **Minute 0, account 1:** `prepare_fields_ee.py` builds the 1,800-field asset in EE (~10 min).
2. **Minute 0, all 6 accounts:** `run_exports.py --account N` submits the point jobs (CMIP6, GRACE, GLDAS), which don't need fields.
3. **Once the field asset is ready:** rerun `run_exports.py --account N` on every account. Tier 1 goes first, longest jobs first, then tier 2.
4. **In parallel, off EE:** SSURGO (Soil Data Access per field), NASS Quick Stats for the 6 counties + Texas, RMA, Drought Monitor, AgriLife budgets, AMS, TxSON / SCAN.
5. Hand labels for Model A once the HLS data is in.

If time runs short: whatever tier 2 hasn't finished is cut. Never cut tier 1, SSURGO, NASS yields or the Riesel data. They feed the simulator engine, the fit checks and the validation.
