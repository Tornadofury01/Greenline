# Pipeline (planned)

There is no code here yet.

This folder will hold the Python / Google Earth Engine processing that turns NASA and USDA data
(NASA POWER, GPM IMERG, SMAP, Landsat/HLS, SRTM, SSURGO, Cropland Data Layer) into one JSON file per
30 m field cell.

**Every output file must follow [`/shared/data-format.md`](../shared/data-format.md)**, the same format as
`/shared/sample-field.json`, so the app can load it without changes. The app reads field data in
exactly one place: `app/src/data/loadField.js`.

Rules:
- Keep Earth Engine and API credentials in `.env` (never commit them).
- Don't commit large rasters or intermediate data. `.gitignore` already blocks common formats and `pipeline/data/`.
- Output by grid cell id only. Never write the farmer's raw GPS position.
