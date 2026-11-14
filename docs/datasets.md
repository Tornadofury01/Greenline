# Datasets

The dataset list from the challenge. We may also use outside data.
What the pipeline actually uses, and how, is documented in [`/pipeline/MODELS.md`](../pipeline/MODELS.md).

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
