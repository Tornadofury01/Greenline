# Field Shift: crop rotation models

Season replay and rotation recommender for the NASA Space Apps "Field Shift" challenge.
Demo site: 300 fields around Ellis County, Texas (32.25 N, -96.75 W).

## Run it

```bash
pip install -r requirements.txt
python src/run_replay.py      # ~15 s: replays every rotation through 1985-2025 + 2040 projections
python src/run_planning.py    # ~5 s: profit, cost-share, nitrogen, pest models + recommender
python src/make_outputs.py    # writes recommendation.json, scorecard.csv, scorecard.png
```
Or `bash run_all.sh`. Everything reads `data/raw/` and writes `outputs/`.

## What each file does

| File | Role |
|---|---|
| `src/fs_replay.py` | Season replay engine (library). Crop table, rotations, FAO-56 daily water balance with Penman-Monteith ET, FAO-33 yield response, frost/heat checks, cover establishment, green/residue/bare days, RUSLE soil loss, warming-trend shift, CMIP6 delta-change, summaries |
| `src/run_replay.py` | Runs the replay on the raw data. Writes `replay_*.csv/json/png`, `year_types.csv`, `field_soil_loss.csv` |
| `src/fs_planning.py` | Planning models + recommender (library). Profit & risk, NRCS EQIP cost-share, nitrogen budget, pest & disease index, 6-dimension scorecard, priority presets, scenario-robust recommendation |
| `src/run_planning.py` | Runs the four models and the recommender on the replay outputs. Writes `planning.pkl`, prints the full results |
| `src/make_outputs.py` | Writes `recommendation.json` (what the app reads), `scorecard.csv`, `scorecard.png` |
| `notebooks/field_shift_replay_export.ipynb` | Colab + Earth Engine notebook that produced `power_daily_replay.csv` and `cmip6_monthly.csv` |
| `notebooks/field_shift_season_replay.ipynb` | Older all-in-one Colab version of the replay (superseded by `src/`) |

## Raw data (`data/raw/`)

| File | Source | Contents |
|---|---|---|
| `power_daily_replay.csv` | NASA POWER daily API, AG community, point 32.25, -96.75 | 1984-2025 daily `tmax`, `tmin` (C), `rain` (mm), `rh` (%), `wind` (m/s at 2 m), `srad` (MJ/m2/day) |
| `cmip6_monthly.csv` | NASA NEX-GDDP-CMIP6 via Earth Engine | Monthly means per model x scenario: `tasmax`, `tasmin` (K), `pr` (kg/m2/s). `historical` = 1985-2014, `ssp245`/`ssp585` = 2030-2050. 8 models |
| `fields_soil.csv` | OpenLandMap via Earth Engine | Per field: clay and sand (%) at 0 and 30 cm; `orgc_*` = organic carbon in OpenLandMap units (x5 g/kg, so 2.0 = 1.0% OC) |
| `fields_terrain.csv` | SRTM via Earth Engine | Per field: acres, elevation, `slope_deg_mean`/`max` |
| `fields_terrain_twi.csv` | SRTM | Same fields plus aspect and topographic wetness index (not used yet) |

## Pipeline

```
NASA POWER daily ─┐
CMIP6 monthly ────┼─> fs_replay: 7 rotations x 5 climate views (all years, today, last 15, 2040 SSP2-4.5, 2040 SSP5-8.5 x 8 models)
soil + slope ─────┘        │  per season: water stress, yield, frost/heat, cover establishment, bare days, soil loss, N fixed
                           v
                    fs_planning: profit & risk | EQIP cost-share | nitrogen budget | pest & disease
                           v
                    recommender: 6 scores (soil cover, erosion, profit, resilience, nitrogen, pest) x farmer priorities
                           → grade the current rotation, recommend the rotation with the best average across
                             10 scenarios (5 climate views x 2 price sets), confidence, reasons, trade-offs, watch-outs
```

## Current result (balanced priorities)

Current rotation (wheat, bare summer): F, last of 7. Recommended: sorghum + crimson clover winter cover, B, wins all
10 scenarios. Sensitivity: the "sorghum + winter cover" family is robust; clover vs. rye depends on the legume N credit
(`LEGUME_CREDIT_SHARE`) and cover seed cost (`COVER_COST`).

## Assumptions to confirm (all in the top of `fs_replay.py` / `fs_planning.py`)

- Crop parameters (planting dates, Kc, Ky, heat/frost thresholds): FAO-56/FAO-33 starting values
- Rain erosivity `r_factor_us = 300`: placeholder; use the NRCS RUSLE2 value for Ellis County
- Double-crop soybean yield 25 bu, $15 fixed; half of legume cover N reaches next crop; 20 lb N after soybean
- Cover seed prices from USDA-ARS 2014-16; EQIP paid 3 years and not guaranteed
- Year types (drought/wet/heat-wave/normal) are simple rules until Model 3 exists (`year_types(..., model3_labels=)`)
- Not a crop simulator (DSSAT/APSIM); management fixed; delta method shifts real seasons, doesn't create new extremes

Sources for every economic, nitrogen and pest number are in `fs_planning.py` and in `recommendation.json` → `sources`.
