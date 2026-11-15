# v2 source data (small files)

Copies of the small, hard-to-redo inputs from `v2/data/` (which is gitignored), so a fresh clone has them:

- `fields_v2.geojson`: the 1,711 USDA Crop Sequence Boundary fields (45 m inward buffer), ids `48139-0021` etc.
- `nass_*.csv`: NASS Quick Stats downloads (`v2/downloads/nass.py`, `nass_blacklands.py`; need a NASS API key)
- `ssurgo_*.csv`: SSURGO soil per field (`v2/downloads/ssurgo.py`)
- `rma_*.csv`, `usdm_county_weekly.csv`, `riesel*`: RMA cause of loss, US Drought Monitor, USDA-ARS Riesel watersheds
- `ee_calib/`: county-level Earth Engine exports for Calibration E (`v2/ee_exports/calib_fetch.py`)

Not here: `v2/data/ee/` (14 GB of per-field Earth Engine exports). Those live in the six Earth Engine accounts'
Drive folders `fieldshift_v2` and on computer A. To rebuild the inputs or retrain the models: put the exports in
`v2/data/ee/`, copy these files into `v2/data/`, then run the scripts in `docs/v2-precompute-guide.md`.
The app and the precompute do NOT need any of this: the input files (`shared/v2/inputs/`) are committed.
