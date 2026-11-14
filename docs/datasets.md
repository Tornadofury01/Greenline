# Datasets

The dataset list from the challenge. We may also use outside data.
What the pipeline actually uses, and how, is documented in [`/pipeline/MODELS.md`](../pipeline/MODELS.md).

## Audit: what we use (201 North Texas fields)

Status: **Used** = in the field files or models today. **Partly** = used in a narrow way or for the demo field only.
**Adding** = being added on the `datasets` branch. **Future** = worth adding later (see "Future additions").
**Not used** = checked, low value for this app.

| Dataset | Status | What it feeds in Greenline | Resolution | Years | Why / notes |
|---|---|---|---|---|---|
| Landsat 5/7/8/9 C2 L2 | Used | NDVI, NDTI, BSI → model 1 (crop & cover), green/residue/bare timeline, bare days | 30 m (45 m buffer) | 1984–2025 | Only free 30 m record that goes back 40 years. L7 reads NDVI ~0.05 below L8, so bare days now use **Landsat 8/9 only from April 2013** (`*L89` keys). Earlier years are flagged low confidence. See "Tried and rejected" |
| USDA Cropland Data Layer | Used | Crop history, model 1 labels, field sampling | 30 m | 2008–2025 | Labels have noise for minor crops |
| NASA POWER | Used | Yearly rain, heat days, frost-free days; models 2 and 3 | ~50 km | 1984–2025 | Long record but coarse; smooths storms |
| GPM IMERG V07 | Used | Rain, storm days ≥ 25 mm; model 2 | ~11 km | 2008–2025 | May overcount storm days (checked against PRISM in `data-validation.md`) |
| SMAP L4 | Used | Root-zone soil-moisture anomaly; model 2 | ~11 km | 2015–2025 | Record starts 2015, which limits model 2 to 11 seasons |
| SRTM | Used | Slope, elevation | 30 m | 2000 | |
| SSURGO (via Soil Data Access) / Web Soil Survey | Used → Adding | Series, texture, drainage, OM, hydrologic group. Adding: K and T erosion factors, available water, land capability class | Map unit (1:24,000) | current | Web Soil Survey is the viewer for the same SSURGO data |
| USDA NASS Quick Stats | Used → Adding | Crop Progress (Texas) checks model 1 dates. Adding: county yields, Texas price received | County / state | 2008–2025 | Grounds the dollar estimates |
| PRISM | Adding | Monthly rain and temperature, frost dates, rain validation | 4 km | 1984–2025 | Gauge-based, so it's the best "ground truth" grid for checking POWER and IMERG |
| MODIS | Partly | MOD16A2GF ET tested in model 2 but **not used** (leakage). MOD13Q1 NDVI for the demo field only | 250–500 m | 2000–2025 | Too coarse for single fields; Landsat is better |
| HLS / Sentinel-2 | Partly | HLS S30 NDVI for the demo field only | 30 m (S2 10–20 m) | 2015– | Future: fill cloudy Landsat months |
| ECOSTRESS | Future | Field-scale ET, heat stress | 70 m | 2018– | Short, irregular record |
| NLDAS / GLDAS | Future | Pre-2015 soil moisture | ~12 km / ~25 km | 1979– / 1948– | Using it in model 2 would mean retraining |
| CoCoRaHS | Future | Gauge check of IMERG storm days | Point gauges | 1998– (TX ~2000s) | |
| GRACE / GRACE-FO | Not used | — | ~300 km | 2002– | Far too coarse for a field |
| VIIRS | Not used | — | 375–1000 m | 2012– | MODIS successor; same coarseness problem |
| GEDI | Not used | — | 25 m footprints | 2019– | Canopy height is for forests |
| NAIP | Not used | — | 1 m | every 2–3 yrs | Useful for drawing field boundaries, not for trends |
| NLCD | Not used | — | 30 m | every 2–3 yrs | CDL gives crop-level detail every year |
| STATSGO2 | Not used | — | 1:250,000 | current | SSURGO is more detailed and covers our area |
| USGS NWIS | Not used | — | Gauges / wells | — | Most of our fields are dryland, and wells are sparse |
| USDA AMS Market News | Not used | — | Markets | — | NASS price received is simpler and yearly |
| OpenET | Not used | — | 30 m | 2016– | Western U.S. focus; ET risks the same leakage as MODIS ET |
| LANDFIRE | Not used | — | 30 m | — | Fuel and vegetation layers for wildfire, not crops |
| FAO GAEZ | Not used | — | ~9 km | — | Global suitability; too coarse and generic |
| USDA Ag Data Commons | Not used | — | — | — | A catalog, not a dataset |
| ERA5 | Not used | — | ~31 km | 1940– | Duplicates POWER (POWER is partly built on reanalysis) |

## Future additions

**Worth adding**
- **NLDAS / GLDAS:** soil moisture before 2015 (NLDAS-2 ~12 km from 1979), so the soil-moisture signal could cover the 2011 drought. Using it in model 2 would mean **retraining model 2** and re-reporting its accuracy.
- **CoCoRaHS:** volunteer rain gauges, a true ground check of IMERG storm days (PRISM, our current check, is itself a gridded product). Needs station matching within a few km of each field.
- **HLS (Landsat + Sentinel-2) / Sentinel-2:** 10–30 m every 2–3 days from 2015, so fewer cloudy months, and HLS is already cross-calibrated. That addresses the Landsat 5/7 vs 8/9 NDVI mismatch for recent years. Today it's used for the demo field only.
- **ECOSTRESS:** 70 m evapotranspiration and surface temperature for crop water stress. The record starts in 2018 with irregular overpass times, and ET carries the same leakage risk we found with MODIS ET.

**Low value for Greenline (checked, not planned)**
- **GRACE / GRACE-FO:** ~300 km groundwater signal, one number for all of North Texas.
- **GEDI:** canopy height and biomass, built for forests.
- **VIIRS / MODIS NDVI:** 250 m–1 km, mixes several fields; Landsat and HLS cover it at 30 m.
- **NLCD:** land cover every 2–3 years; CDL already gives the crop every year.
- **NAIP:** 1 m aerial photos every 2–3 years; good for drawing field boundaries, not for trends.
- **LANDFIRE:** wildfire fuel layers.
- **OpenET:** western U.S. focus, and ET risks leakage (see MODELS.md).
- **FAO GAEZ:** global, coarse suitability maps; local soils and weather beat it.
- **ERA5:** reanalysis that duplicates what POWER already gives us.
- **USGS NWIS:** few wells and gauges near our mostly dryland fields.
- **USDA AMS Market News:** daily cash prices; NASS yearly price received is enough for rotation planning.
- **STATSGO2:** coarse version of SSURGO, which we already use.
- **USDA Ag Data Commons:** a catalog, not a dataset; search it case by case.

## Tried and rejected

- **Landsat 5/7 → 8/9 cross-sensor correction (Roy et al. 2016, RSE 185: 57–70, Table 2 OLS)**, tested on branch
  `landsat-harmonize` (kept for the record, not merged). Results: [`landsat-harmonization-results.md`](landsat-harmonization-results.md).
  - **The offset is real.** For the same field and month (2013–2021), Landsat 7 reads NDVI **0.05 below** Landsat 8.
  - **The correction overshoots.** It cut the average bias to −0.013, which still misses our 0.01 rule. It also overshoots
    right at the 0.25 bare cutoff (+0.023 for bare fields), so pre-2013 cotton went from 198 bare days a year to 0.
  - **Model 1 got slightly worse:** accuracy −0.008, balanced accuracy −0.016, sorghum F1 −0.05.
  - **The coefficients don't fit our data.** They were fit on Collection 1 data, and Google now advises against them for Collection 2.
  - **What we did instead:** bare days and cover from **Landsat 8/9 only** (April 2013 on), with pre-2013 values flagged low
    confidence. See [`landsat89-cover-results.md`](landsat89-cover-results.md).

## NASA
- SMAP Soil Moisture Active Passive: https://www.earthdata.nasa.gov/data/platforms/space-based-platforms/smap (surface soil moisture and freeze/thaw every 2–3 days; drought stress, infiltration, early crop stress)
- GPM / IMERG: https://gpm.nasa.gov/data (precipitation rate and accumulation; rainfall reliability, extreme storms, erosion risk)
- Landsat: https://earthexplorer.usgs.gov/ (30 m reflectance, NDVI; crop vigor, bare ground, seasonal change)
- MODIS: https://lpdaac.usgs.gov/products/ and VIIRS: https://search.earthdata.nasa.gov/search?q=VIIRS (250–1000 m NDVI, vegetation indices, plant stress)
- NASA POWER: https://power.larc.nasa.gov/ (temperature, humidity, radiation; crop water use, frost risk, growing season)
- SRTM elevation: https://www.earthdata.nasa.gov/data/instruments/srtm (slope, runoff, erosion risk)
- ECOSTRESS: https://ecostress.jpl.nasa.gov/data (land-surface temperature and evapotranspiration; heat stress, crop water demand)
- GRACE / GRACE-FO (groundwater and total water storage trends). *No link was given in the challenge list.*
- NLDAS / GLDAS: https://www.earthdata.nasa.gov/ (gridded temperature, precipitation, soil moisture, ET; drought onset)
- GEDI: https://gedi.umd.edu/data (canopy height and biomass; mostly forests)

## USDA and other U.S. sources
- USDA Ag Data Commons: https://www.nal.usda.gov/services/agdatacommons (open agricultural research datasets)
- Web Soil Survey: https://websoilsurvey.nrcs.usda.gov/app/ (official soil maps, properties, erosion and hydrologic ratings)
- SSURGO / STATSGO2: https://www.nrcs.usda.gov/resources/data-and-reports/soils (texture, organic matter, drainage, water-holding capacity, erosion factors)
- Cropland Data Layer (CropScape): https://nassgeodata.gmu.edu/CropScape/ (annual 30 m crop type maps)
- PRISM Climate Data: https://prism.oregonstate.edu/ (high-quality U.S. climate, 30-year normals, frost/freeze dates)
- NAIP: https://naip-usdaonline.hub.arcgis.com/ (1 m aerial imagery; field boundaries, bare soil)
- NLCD: https://www.usgs.gov/centers/eros/science/national-land-cover-database (30 m land cover)
- CoCoRaHS: https://www.cocorahs.org/Maps (volunteer rain gauge observations; validate IMERG)
- USGS NWIS: https://waterdata.usgs.gov/nwis (groundwater levels, streamflow)
- USDA AMS Market News: https://www.ams.usda.gov/market-news (commodity prices, market conditions)
- USDA NASS Quick Stats: https://quickstats.nass.usda.gov/ (county yields, acreage, crop progress)
- OpenET: https://openetdata.org/ (field-scale ET, western U.S.)
- LANDFIRE: https://www.landfire.gov/ (vegetation and fuel layers)
- FAO GAEZ: https://gaez.fao.org/ (global crop suitability layers)

## Space agency partners
- Copernicus Sentinel-2 (ESA): https://dataspace.copernicus.eu/ (10–20 m multispectral imagery; NDVI, bare soil, crop stress)
- ERA5 (ECMWF reanalysis): https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels?tab=overview (hourly global climate variables)
