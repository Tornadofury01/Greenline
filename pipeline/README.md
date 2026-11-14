# Greenline data pipeline

`greenline_pipeline.py` downloads NASA and USDA data for one demo field and writes **monthly CSVs** to
`pipeline/data/`. The CSV columns are documented in [`/shared/data-format.md`](../shared/data-format.md)
under "Pipeline CSV outputs". A later step will combine them into the field JSON the app loads.

## Demo field
A cultivated cropland point in **Ellis County, TX** (Blackland Prairie, between Italy and Avalon):
`32.1820, -96.8350`. Satellite values are averaged over a 60 m radius around it (`BUFFER_M`).
Change `FIELD` at the top of the script to use another field.

## One-time setup (Windows)
1. Install Python 3.12: `winget install -e --id Python.Python.3.12 --scope user`
2. From the repo root, create a virtual environment and install packages:
   ```
   C:\Users\<you>\AppData\Local\Programs\Python\Python312\python.exe -m venv pipeline\.venv
   pipeline\.venv\Scripts\python -m pip install requests pandas python-dotenv earthengine-api
   ```
3. Secrets: copy `.env.example` to `.env` in the repo root and add your NASS Quick Stats key
   (free at https://quickstats.nass.usda.gov/api). `.env` is gitignored. **Never put the key anywhere else.**
4. Earth Engine sign-in (needed for every step except `power` and `nass`):
   ```
   pipeline\.venv\Scripts\earthengine authenticate
   ```
   A browser opens. Sign in with the Google account that has access to Cloud project
   `skillful-cider-490516-f6`, and allow access. The token is saved to `%USERPROFILE%\.config\earthengine\`
   (outside the repo). The project must have the Earth Engine API enabled and be registered for Earth Engine
   (https://code.earthengine.google.com/register).

## Run
From the repo root:
```
pipeline\.venv\Scripts\python pipeline\greenline_pipeline.py power     # one dataset
pipeline\.venv\Scripts\python pipeline\greenline_pipeline.py all       # everything
```

| Step | Source | Output | Needs |
|---|---|---|---|
| `power` | NASA POWER daily API | `power_monthly.csv`, `power_yearly.csv` (frost dates) | nothing |
| `nass` | USDA NASS Quick Stats, Texas weekly Crop Progress | `nass_crop_progress_tx_monthly.csv` | `NASS_API_KEY` |
| `landsat` | Landsat 5/7/8/9 Collection 2 L2 (1984–now) | `landsat_monthly.csv` (NDVI, NDTI, BSI) | Earth Engine |
| `hls` | HLS Sentinel-2 (HLSS30 v2, 2016–now) | `hls_s30_monthly.csv` | Earth Engine |
| `modis` | MODIS MOD13Q1 NDVI, 250 m (2000–now) | `modis_ndvi_monthly.csv` | Earth Engine |
| `cdl` | USDA Cropland Data Layer (2008–now) | `cdl_history.csv` | Earth Engine |
| `smap` | SMAP L4 soil moisture (2015–now) | `smap_monthly.csv` | Earth Engine |
| `imerg` | GPM IMERG V07 monthly | `imerg_monthly.csv` | Earth Engine |
| `terrain` | SRTM 30 m | `terrain.csv` (elevation, slope %) | Earth Engine |

Landsat runs in 5-year chunks and can take a few minutes. Months with no clear scene have empty values;
use HLS and MODIS to fill gaps.

## Rules
- Monthly CSVs are small and committed. Rasters and other large files are gitignored.
- Output by field / grid cell id only. Never write a farmer's raw GPS position.

## 201-field sample (models and app field files)
See [`MODELS.md`](MODELS.md) for the full run order. Data-only steps added on the `datasets` branch (none of them
retrain or change a model):
```
pipeline\.venv\Scripts\python pipeline\sample_fields.py soil prism prism_yearly   # SSURGO extras, PRISM monthly + frost/storm days
pipeline\.venv\Scripts\python pipeline\nass_quickstats.py                         # county yields + Texas prices (NASS_API_KEY)
pipeline\.venv\Scripts\python pipeline\validate_rain.py                           # writes docs/data-validation.md
pipeline\.venv\Scripts\python pipeline\build_fields.py                            # rebuilds shared/fields/*.json
```
