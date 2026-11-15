# Field Shift v2: precompute run guide (two computers)

Turns the downloaded data into the files the app reads, for the 1,711 North Texas fields. No Earth Engine and no
network: everything runs from local files. Handoff doc with the reasoning: the "Greenline v2: precompute handoff" doc.

```
v2/data (15 GB, this laptop only)
   │  python pipeline/v2/build_inputs.py         input files (once)
   ▼
shared/v2/inputs/<fid>.json  +  shared/v2/input-index.json
   │  python pipeline/v2/write_model_slots.py     model slot files (after any model change)
   ▼
shared/v2/models/<fid>.json
   │  node scoring/tools/precompute_v2.mjs        output files (after any model or engine change), split by county
   ▼
shared/v2/fields/<fid>.json  +  shared/v2/validation-raw/<fid>.json
   │  node scoring/tools/precompute_v2.mjs --report-only   report cards (after both computers' results are merged)
   │  cd app && npm run deploy                    packs public/v2f/<fid>.json.gz (~10 KB each) and deploys
   ▼
app
```

Field ids are the USDA ids from `v2/data/fields_v2.geojson` (`48139-0021` = county FIPS + number).

## Who runs what

| Computer | Counties | Fields |
|---|---|---|
| A (this laptop: has `v2/data` and the models) | Ellis 48139, Hill 48217, Johnson 48251 | 900 |
| B (teammate) | Kaufman 48257, McLennan 48309, Navarro 48349 | 811 |

Ellis goes first on A, so a working county is ready early.

## Computer A

From the repo root (`Greenline`), in plain PowerShell (no Claude needed, so it costs no tokens):

```powershell
# 1. input files for all six counties (reads 15 GB; a few minutes)
python pipeline/v2/build_inputs.py
# 2. model slot files (models from the Greenline-v2 worktree, branch pranav-work)
python pipeline/v2/write_model_slots.py
# 3. package computer B's share (keeps the folders, so B unzips once at the repo root)
$b = "48257", "48309", "48349"
Remove-Item v2-share-B -Recurse -Force -ErrorAction SilentlyContinue
foreach ($d in "inputs", "models") {
  New-Item -ItemType Directory -Force "v2-share-B/shared/v2/$d" | Out-Null
  Get-ChildItem "shared/v2/$d" -File | Where-Object { $b -contains $_.Name.Substring(0, 5) } | Copy-Item -Destination "v2-share-B/shared/v2/$d"
}
Copy-Item shared/v2/input-index.json v2-share-B/shared/v2/
Compress-Archive -Path v2-share-B/shared -DestinationPath v2-share-B.zip -Force
# 4. precompute A's counties, Ellis first
node scoring/tools/precompute_v2.mjs --counties 48139 --no-report
node scoring/tools/precompute_v2.mjs --counties 48217,48251 --no-report
```

Send `v2-share-B.zip` (about 100 MB) to computer B by Drive or USB.

## Computer B

1. `git pull` the same branch (the code must match A's).
2. At the repo root: `Expand-Archive v2-share-B.zip -DestinationPath . -Force`
3. Check: `node pipeline/v2/check_share.mjs --counties 48257,48309,48349` must print READY.
3b. Run: `node scoring/tools/precompute_v2.mjs --counties 48257,48309,48349 --no-report`
4. Package the results and send `v2-results-B.zip` back:

```powershell
$b = "48257", "48309", "48349"
Remove-Item v2-back -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force v2-back/shared/v2/fields, v2-back/shared/v2/validation-raw | Out-Null
Get-ChildItem shared/v2/fields -File | Where-Object { $b -contains $_.Name.Substring(0, 5) } | Copy-Item -Destination v2-back/shared/v2/fields
Copy-Item shared/v2/validation-raw/* v2-back/shared/v2/validation-raw
Compress-Archive -Path v2-back/shared -DestinationPath v2-results-B.zip -Force
```

Run `node pipeline/v2/check_share.mjs --counties 48257,48309,48349 --results` first: it must print READY.

## Merge and ship (computer A)

```powershell
Expand-Archive v2-results-B.zip -DestinationPath . -Force
node scoring/tools/precompute_v2.mjs --report-only     # shared/v2/validation.json (Ellis) + validation-by-county/<fips>.json
cd app
npm run selftest
npm run i18n
npm run deploy                                          # packs public/v2f/, builds, deploys
```

Before deploying: the precompute prints "N failed the contract check"; those fields are not written and the app shows
"No data here yet" for them. `npm run build` prints the packed size (expect ~17 MB for 1,711 fields).

## What the slot files contain

| Slot | Source | Status |
|---|---|---|
| A field history | Model 1 v2 crop per year (USDA label where clean) | model; crop dates are still the placeholder calendars |
| B field response | – | placeholder: Model B measures greenness response, not the yield factors the engine needs |
| C year types | Model C county summer types, 2040 = 8-model mean | model |
| D soil moisture | – | placeholder: Model D gives volumetric moisture, not a share of plant-available water |
| E yields | Calibration E county trend yield (wheat, corn, sorghum, cotton) | model for those 4 crops; Calibration E's fit includes Hill, so Hill's yields are not a held-out test |

## Known gaps

- Weather comes from **Daymet**, not gridMET: the gridMET export has empty files for 1989, 1995, 2001, 2007, 2013,
  2019 and 2025. Models B and C were trained on gridMET; check how they handled those years.
- IMERG has empty years (2001–2003, 2008–2009, 2014–2015, 2020–2021) and PRISM has missing years; both are only
  cross-checks.
- The map still shows the 300 old Ellis outlines (`ec-*`) and the demo field is `ec-251`. Switching the map to the
  1,711 fields (outlines from `fields_v2.geojson`) and picking a new demo id is a separate step.
- `shared/v2/inputs/`, `shared/v2/validation-raw/` and `app/public/v2f/` are gitignored (generated, large). Share them
  as zips, not through git.
