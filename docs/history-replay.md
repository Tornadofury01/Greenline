# Field History replay

The History screen starts with a fixed-camera Landsat replay. Play and the scrubber are together immediately below the image. Capture date, annual USDA crop and monthly Landsat cover are separate labels. Crops, ground cover and weather open on demand; Simulator remains a separate screen.

## Assets and provenance

- 300 mapped fields; all 300 have playable replays.
- 233 fields have 18 frames, 64 have 17, and 3 have 16.
- Window: February, April, June, August, October and December in 2022?2024. No synthetic dates or interpolated imagery.
- 24 shared region scenes, 10,391,395 JPEG bytes total. Each field has a separate fixed SVG view and its own projected USDA outline.
- Shared scenes are reused only when at least 98% of that particular field passes QA and optical usability checks.
- Landsat Collection 2 L2, natural color SR_B4/SR_B3/SR_B2, reflectance scale 0.0000275 and offset -0.2. Visualization is fixed at 0.02?0.28, gamma 1.15.
- QA_PIXEL bits 0?5 must be unset; QA_RADSAT must be zero. Visible-band mean reflectance must be 0.025?0.65. This extra check rejects nearly black atmospheric-correction failures that cloud QA alone missed.
- Camera/image coordinates use a single fixed EPSG:3857 square. All source outline vertices are projected into the same square; SVG viewBox is fixed for each field throughout playback.
- Replay manifests and imagery load only on History, and history/** is excluded from PWA precaching. Only the current and next shared scene are requested by the player.
- Missing image/network errors have a retry action; another field is never substituted.
- The original ec-251 JSON, original 18 prototype JPEGs and original single-field export command are preserved. A zip of the pre-redesign local edits is also in the system temporary directory.

References: [USGS QA bands](https://www.usgs.gov/landsat-missions/landsat-collection-2-quality-assessment-bands), [Earth Engine thumbnail geometry](https://developers.google.com/earth-engine/guides/image_visualization), [reduceRegions](https://developers.google.com/earth-engine/apidocs/ee-image-reduceregions).

## Regenerate and audit

```powershell
pipeline/.venv/Scripts/python.exe pipeline/export_history_frames.py all 2022 2024 --project skillful-cider-490516-f6
pipeline/.venv/Scripts/python.exe pipeline/verify_history_archive.py
```

Earth Engine is needed only during generation. The app serves local static files. No model is trained, edited or called. The audit requires Pillow in the pipeline virtualenv.

Per-field manifests: `app/public/history/fields/ec-NNN.json`. Shared scene provenance, dates and SHA-256 values: `app/public/history/coverage.json`. Independent full geometry/asset/label audit: `docs/history-archive-audit.json`.

## Fields with missing sampling months

All remaining sampling months are available. These months are omitted explicitly, without replacement.

| Sampling month | Fields |
|---|---|
| 2024-02 | ec-204 |
| 2024-04 | ec-000, ec-003, ec-006, ec-008, ec-009, ec-016, ec-018, ec-019, ec-031, ec-032, ec-046, ec-054, ec-057, ec-072, ec-079, ec-091, ec-104, ec-129, ec-130, ec-193, ec-194, ec-220, ec-236 |
| 2024-06 | ec-003, ec-005, ec-006, ec-008, ec-022, ec-024, ec-026, ec-047, ec-048, ec-049, ec-069, ec-071, ec-077, ec-078, ec-088, ec-095, ec-096, ec-115, ec-121, ec-123, ec-133, ec-134, ec-142, ec-143, ec-159, ec-186, ec-197, ec-202, ec-207, ec-209, ec-210, ec-231, ec-234, ec-246, ec-253, ec-257, ec-259, ec-261, ec-262, ec-264, ec-269, ec-272, ec-278, ec-282, ec-292, ec-296 |

## Local review links

- Demo: http://localhost:5173/?field=ec-251&screen=story
- North: http://localhost:5173/?field=ec-289&screen=story
- South: http://localhost:5173/?field=ec-291&screen=story
- East: http://localhost:5173/?field=ec-292&screen=story
- West: http://localhost:5173/?field=ec-287&screen=story
- Two omitted months: http://localhost:5173/?field=ec-003&screen=story

## Verification

- Selftest: passed.
- English/Spanish key and placeholder check: passed (1,287 keys).
- Production build: passed; existing large-JavaScript-chunk warning.
- PWA precache: 16 entries, roughly 1.8 MB; no history assets precached.
- Asset audit: all 300 ids, all referenced scene hashes and JPEG decodes, every outline vertex, fixed crop bounds, chronological unique dates, per-field clear fractions and annual/monthly labels passed.
- Browser interaction/layout verification is pending because Computer Use could not determine the current browser URL. Permission for an isolated Playwright browser session was requested.
