# Greenline

A mobile-first PWA for the NASA Space Apps challenge "Field Shift: Adapting Farms with NASA Data".
It helps North Texas farmers compare crop rotations using NASA Earth observation data.
**It supports farmer judgment and local experts. It doesn't replace them.**

Current stage: running on **real data for the 300 Field Shift study fields** in Ellis County, TX (`ec-000` … `ec-299`, USDA field outlines; Landsat, CDL, NASA POWER, IMERG, SMAP, SRTM, SSURGO, PRISM)
and the three Field Shift models (crop classifier, leak-free stress model, year types; see `pipeline/MODELS.md`), plus the season replay + recommender.
The fake `shared/sample-field.json` is only used in development (`npm run dev`) when a field file is missing; production never shows it.

## Stack
- Vite + React (JavaScript, no TypeScript), Leaflet (react-leaflet 4), Recharts, vite-plugin-pwa
- No backend. All data comes from static JSON.

## Folders
| Folder | What goes here |
|---|---|
| `/app` | The React PWA. `npm` commands run from here |
| `/scoring` | Rotation scoring as plain JS functions with no React and no DOM. Imported by the app as `@scoring` |
| `/content` | `crops.json`, `rotations.json`, `i18n/en.json`, `i18n/es.json` (all user-facing text, including the glossary) |
| `/shared` | `fields/` (real per-field JSON), `si/` (model results), `sample-field.json` (fake fallback), `data-format.md` (the contract) |
| `/pipeline` | Python / Earth Engine downloads and SI models (`MODELS.md`). Outputs files in the `/shared` format |

Aliases set in `app/vite.config.js`: `@content`, `@shared`, `@scoring`.

## Key code paths
- Field data enters the app in **one place**: `app/src/data/loadField.js`. Real fields: `/shared/fields/<id>.json`
  (built by `pipeline/build_fields.py`). A failed load returns `{ error, id }` (AppContext `loadError`, Retry button on the
  map); a failed import first reloads the tab once (stale build after a deploy). The fake `sample-field.json` is DEV only.
- Picking a field (`PickField.jsx`): green dots = the 300 study fields (`fieldIndex()`, tap = that exact field,
  `pickFieldById`); a tap elsewhere or GPS = nearest sampled field (`loadFieldAt`), with a far-away warning (> 25 km) and
  a not-cropland warning from `croplandAt()` (`shared/cropland-mask.json`, ~400 m USDA CDL grid built by
  `pipeline/build_cropland_mask.py`). The point is never stored or sent.
- **Demo field: one setting**, `DEFAULT_DEMO_FIELD_ID` in `app/src/config.js` (or `VITE_DEMO_FIELD_ID` in `app/.env.local` / the shell). Default `ec-251` (100 acres, Houston Black clay, cropped all 18 USDA years). `vite.config.js` imports it, so the precached field always matches.
- Bare days and cover: **Landsat 8/9 only** (`*L89` keys, 2014+) via `bareRows()` / `coverRows()` in `app/src/display.js`; pre-2013 years shown muted with `<LowConfTag>`, never averaged or scored. Dataset text in receipts is translated by source id (`sourceText()` in `app/src/i18n.js`, i18n `sources.*`).
- SI models: the Field Shift models in `/pipeline/fieldshift/` (README there: run order), documented in `/pipeline/MODELS.md`. `build_app_inputs.py` → `pipeline/data/fields/*.csv`, `export_si.py` → `shared/si/`, then `pipeline/build_fields.py` → `shared/fields/`. App display helpers: `app/src/si.js`; crop → model class in `MODEL_CLASS` (`scoring/confidence.js`). Model 2: use only the `_causal` files.
- Season replay study card: `pipeline/fieldshift/export_app.py` → `shared/fieldshift/ellis-study.json` → `components/FieldShiftStudy.jsx` on the Compare screen, text in i18n `fieldShift.*`. The replay and recommender are simulations on published agronomy, not ML.
- Evidence receipts: scoring reasons may carry `src` (dataset names). `<Receipt>` in `components/Small.jsx` shows them, with `sources[].scale` (your field vs regional).
- Dollars: `scoring/economics.js` (display only, from `field.market`), N price in `content/economics.json` (USDA AMS Illinois Production Cost Report, national, not Texas). What-if: `whatIfHazards()` in `scoring/rules/replay.js`.
- Scoring: `scoring/scoreRotation.js` → `scoreRotation(rotation, field, priorities, constraints, cropLibrary)`.
  One rule per file in `scoring/rules/`. The same function scores current, suggested and custom rotations.
  Rules return **i18n keys and params**, never English text.
- Confidence: `scoring/confidence.js` (reasons carry `tone`; `topReasons()` for the card face). Glossary / "How we know": `glossary.*` in i18n, shown by `GlossaryIcon` popups and `screens/HowWeKnow.jsx` (`openHow(term)` from `useApp()`).
- App state: `app/src/state/AppContext.jsx`. Scores: `app/src/state/useScores.js`.
- Screens: `app/src/screens/`. Add new ones to `SCREEN_COMPONENTS` in `App.jsx` and to `SCREENS` in `BottomNav.jsx`.
- Text: `t('key.path', params)` from `app/src/i18n.js`. Scoring reasons go through `formatReason(t, reason)`.

## Coding rules
1. **All user-facing text lives in `/content/i18n/en.json` and `es.json`.** Nothing hardcoded in JSX. Add every key to both files.
2. **Data must follow `/shared/data-format.md`.** Change the doc and the sample together.
3. **Never commit API keys.** Use `.env` (it's gitignored). Vite exposes only `VITE_*` vars to the browser, so treat those as public.
4. Never store or send the farmer's raw GPS. Use the 30 m `gridCell` id.
5. Keep scoring rules small, pure and commented. Run `node scoring/selftest.js` after changing them.
6. Crop trait values in `crops.json` are **placeholders** (`"verified": false`) until checked with AgriLife / NRCS.
7. Mobile-first: tap targets ≥ 44px, plain language.

## Commands
```
cd app
npm install
npm run dev        # http://localhost:5173
npm run build      # production build + service worker
npm run preview    # test the built PWA
npm run selftest   # scoring sanity checks
npm run i18n       # en.json and es.json have the same keys and placeholders
npm run deploy     # selftest + i18n + build, then publish to production on Vercel
```

## Deploy
**Live: https://greenline-psi.vercel.app** (public, no login). **Rerun `npm run deploy` from `app/` after each phase.**
- Vercel CLI from this laptop (`vercel` is a pinned devDependency). The project is **not connected to GitHub** (a teammate owns the repo). Don't run `vercel git connect`.
- Build locally, upload only static files: `predeploy` runs selftest + i18n, `deploy` runs `vite build` → `scripts/vercel-output.mjs` (copies `dist/` into `.vercel/output/` with cache headers + SPA fallback) → `vercel deploy --prebuilt --prod`. Why: Vercel can't build remotely (the app imports `../content`, `../shared`, `../scoring`), and `vercel build` fails on Windows without symlink rights.
- First time on a new machine: `npx vercel login`, then `npx vercel link --yes --project greenline` from `app/`. `.vercel/` and the `.env.local` it writes are gitignored.
- Before sharing a new build, check: the live link opens in an incognito window, `sw.js` precaches `assets/fields/<demo id>-*.js`, a made-up `/assets/x.js` returns 404 (not index.html), and the deploy output contains no `.env` values.

## Build status
**Latest checkpoint `v1.1-checkpoint` (tag on `main` at `59d7504`, Nov 14 2026): everything through Phase 4 plus the field picking fixes, merged into `main` and live at https://greenline-psi.vercel.app.** Earlier: `v1.0-checkpoint` (`a66239f`, through Phase 4).
`main` contains `app-build`, `datasets`, `landsat89-cover` (and the older `connect-data`, `data-pipeline`, `si-models`, `ui-polish`); only `landsat-harmonize` stays unmerged on purpose (tried, rejected, MODELS.md #14).
**Next:** optional `ui-polish-2` and `models-v2` branches, then submission prep.

Work happens on branch `app-build`. The `datasets` branch (worktree `Greenline-data`, which currently has `main` checked out) only touches `/pipeline`, `/shared`, `/docs`.
- [x] **Phase 0: crop traits.** `crops.json` follows `docs/crop-traits-verification.md` and `-2.md` (sourced water, drought sensitivity, N fixation, sesame and late-rye-kill risks). Still `"verified": false`.
- [x] **Phase 1: signature features.**
  - [x] 1.1 Bad-year replay re-scores rotations (`scoring/rules/replay.js`, `scoreRotation(..., { replayYear })`, Compare screen picker).
  - [x] 1.2 Bare days per rotation (`scoring/bareDays.js`; per-crop `bareShare` calendars in `crops.json`, built by `scoring/tools/build_calendars.mjs` from the 201 fields' 2013+ Landsat + CDL; estimates marked).
  - [x] 1.3 Clearer green / residue / bare field story (cover-by-year chart with a 2013 sensor marker, typical-year strip, "partly covered" wording; headline and bare-day stats use 2013+ only because Landsat 5/7 vs 8/9 isn't harmonized).
  - Decisions: "residue" stays "partly covered" (NDTI/BSI aren't in the per-field files and don't separate residue from bare soil on our clays; see MODELS.md #7). Bare days use 2013+ only (MODELS.md #14). Cover crops assume they establish, and count as half established in drought replays.
- [x] **Phase 2a: core features, part 1** (no dollars yet).
  - [x] Soil-health tags `droughtTolerant` (all crops `droughtSensitivity <= 2`) and `pestBreak` (grass + non-grass, no same `family` back-to-back, looping; cover crops and fallow skipped, so only ~2 of 8 candidates qualify), each with a one-line explanation. `family` added to `crops.json`.
  - [x] "Use my location" on the map (`PickField.jsx`): the GPS point stays inside the callback, goes only to `pickField()`, is never stored or sent. Handles denied / unavailable / timeout / unsupported, and warns when the nearest sampled field is over 25 km away.
  - [x] Confidence (`scoring/confidence.js`): every reason has a `tone` (up / down / note), estimated crop traits (`droughtSensitivity`, `seasonalWaterMm`, unknown `nFixLbPerAcre`) cost a point, resolution is read from `field.sources`, PRISM agreement shows if `quality.rainVsPrism` exists (no points), `topReasons()` puts one lowering and one adding reason on the card face.
  - [x] SI visible: card shows overall + balanced accuracy + the "same as last year" baseline; weather risk signal only where it beat the baseline, with the error numbers; SHAP "what mattered most" in the Evidence line.
  - [x] "How we know" screen (`screens/HowWeKnow.jsx`, header book button and card links, `glossary.*` en + es): NDVI, NDTI/residue, ET, soil moisture anomaly, frost, water balance, bare days, confidence, held-out accuracy, satellite vs ground, why 2013 matters. Not a bottom tab (6 don't fit at 375 px).
  - Tools: `npm run i18n` (from `app/`) checks en/es keys and `{placeholders}` match. Spanish uses formal *usted*.
- [x] **Phase 2b: dollars, what-if, soil and PRISM** (after merging the datasets branch from `main`).
  - [x] Dollars, display only (`scoring/economics.js` `estimateDollars`, `options.economics`, result `dollars`; `components/DollarBlock.jsx`). Gross revenue per acre per rotation year from the field's real NASS `market.recent[]` (2021–2025), labeled "gross revenue, before costs, not profit", with county / district / Texas-average yield level and the High Plains caveat. Years follow the bare-days rule (cover crops ride along); crops without NASS data are listed, not guessed. Fertilizer value = `nFixLbPerAcre` × N price × 50%. Selftest checks dollars never change totals.
  - [x] What-if sliders (`components/WhatIfSliders.jsx`, in the Replay card): rain −50…+50 % and extra days ≥ 95 °F 0…+40, via `whatIfHazards()` → the same `hazardsFromRow()` / `replayRule()` path as bad-year replay. One scenario slot in AppContext. "Hypothetical, not a forecast" banner and card badge.
  - [x] Scenario totals now only subtract from the normal total (drop from a stress-free year). Before, a weak rotation could score higher in a drought than in a normal year. A 0/0 what-if equals the normal total.
  - [x] Soil facts card (K, T, water in top 1 m, land capability class) on Field story and Expert handoff; PRISM frost dates (median of the last 10 years), POWER frost-free days kept for model 3.
  - [x] Rules: erosion uses SSURGO K × slope ≥ 0.5 (was slope > 2 %; flags 90 % vs 92 % of fields). Water scales the thirsty-crop drought penalty by soil water (< 10 cm × 1.25, ≥ 15 cm × 0.75). nt-103: same order of options; rotations with corn or cotton gain about 1 point.
  - [x] Confidence: PRISM agreement for POWER and IMERG with the field's numbers (no points: not independent, see `docs/data-validation.md`). `EVIDENCE` has PRISM, NASS Quick Stats, SSURGO. Receipts show "measured on your field" vs "regional value" from `sources[].scale`.
  - Decisions: N price $0.60/lb N from the USDA AMS Illinois Production Cost Report (Nov 13 2026, anhydrous 82% N, $981.11/ton ÷ 1,640 lb N; math in `content/economics.json` and `scoring/economics.js`), labeled "national estimate, not Texas": NASS has no Texas fertilizer price. No price slider. `docs/economics-placeholders-todo.md` dropped (real NASS data now).
  - [x] Fixes: a scenario score clamped to 0 shows the verdict "Struggles badly" (card and glance) with a "settings max out the stress" note; the number stays in the details. `<Receipt extra>` takes non-field sources (scale `national`).
- [x] **Landsat 8/9 switch** (after merging `landsat89-cover` from `main`, docs/app-changes-needed.md §5).
  - [x] Headline, stats, usually-bare months, typical year, timeline scores, field calibration (`bareDays.js`, 2014+) and `recentBareDays()` read the `*L89` keys; old keys only as a fallback (fake sample) and for pre-2013 display.
  - [x] `build_calendars.mjs` reads `shared/crop-calendars-l89.json` (corn 133→94 bare days, cotton 95→54, sorghum 113→60, wheat 88→60). Bare-day reasons cite "Landsat 8/9". Selftest checks both.
  - [x] Pre-2013 bars and rows muted + "Low confidence: older satellite" tag (opens "Why 2013 matters"); Jan–Mar 2013 = "no image"; too-cloudy years say so. No "less bare over time" wording left (that trend was a sensor artifact).
  - Decision: erosion thresholds unchanged (60 free days, 1 point per 60). nt-103: field average 113 → 78 bare days a year; rotation ranking unchanged, totals move ≤ 1 point.
  - [x] Estimated calendars on the Landsat 8/9 level (`build_calendars.mjs` step 3). Sunflower, sesame, alfalfa and fallow were hand-written next to the old mixed-sensor numbers; now `new = old ^ 1.6`, the power curve fitted on the 48 month pairs (old mixed vs L8/9) of the 4 measured crops (error 0.04/month; keeps always-bare and never-bare months fixed, unlike a flat 0.63 ratio). Cover crops not rescaled (they multiply the cash crop's already-L8/9 month); cereal rye's Nov–May proxy re-read from L8/9 small grain. Still `estimates`. Bare days/yr: sunflower 137→87, sesame 134→85, alfalfa 43→16, fallow 283→244, rye factor 137→132. nt-103: Option A/B and current unchanged (80/76/18; 2011: 67/63/0); sesame–wheat 78→54 bare days (+1 point), sunflower 55→49; ranking unchanged.
- [x] **Phase 4: Spanish and polish.**
  - [x] Full Spanish pass (plain *usted*, "suelo desnudo", verdicts "Aguanta / Batalla un poco / Batalla / Batalla mucho", "Revivir un mal año"); grammar fixes in both languages (`yearTypeYear.*`, `replayUi.vsNormalSame`); dataset descriptions translated (`sources.*`).
  - [x] Checked in Chrome (playwright-core) at 375 / 768 / 1280 px, en + es, along the demo path (demo field → farm → story → replay 2011 → compare → what-if at −50 % / +40 days → build my own → handoff → How we know): no horizontal scroll, overflow, text < 12 px or console errors. Fixed: rain axis cut off "pulg", Landsat 8 marker, "Struggles badly" note placement, receipt touch area.
  - [x] Demo field is one setting (see Key code paths); tested with `VITE_DEMO_FIELD_ID=nt-141` (only nt-141 precached).
- [x] **Field picking fixes** (after v1.0-checkpoint, tagged `v1.1-checkpoint`). Why: testers saw "Showing sample data" because a failed field load (old tab after a deploy, or offline) silently swapped in the fake sample, and any tap (lake, town) loaded the nearest field with no comment.
  - No fake data in production; reload-once on a failed import; error + Retry; Vercel returns 404 for missing `/assets/*`.
  - Map dots for the 201 sampled fields (tap = exact field). Not-cropland warning for taps and GPS (CDL mask, cell or a neighbour counts). Far-away rule unchanged (load nearest + warning), by decision.
- [x] **`models-v2`: Field Shift study models** (branch `models-v2`). Space Apps bundles in `pipeline/fieldshift/` (Model 1 v2, Model 2 `_causal`, Model 3, replay + recommender); Model 3 year types wired into the replay (grades and picks unchanged); everything rerun and reproduced. App: Ellis County season replay card on Compare (4 priority presets, today vs best, all 7 rotations, models behind it) + "Season replay" and "Field Shift study models" in How we know, en + es. Checked at 375 px in en and es.
- [x] **Field Shift models replace the old models and fields** (branch `models-v2`). The app's fields are now the 300 study fields (`ec-*`, from `fields_index.csv` / `fields.geojson`); `pipeline/models/` and the 201 `nt-*` field files are retired (git history, `v1.1-checkpoint`). New `build_app_inputs.py`, `export_si.py`, `models/evaluate_m1.py`; `build_fields.py` reads them and keeps the old crop calendars. App: Model 1 classes (`summer_grain` etc.) in `MODEL_CLASS`, model text rewritten (unseen years 2023–2025: crops 83% / 92% clean vs 58% baseline; stress AUC 0.936), map centred on the study area, demo `ec-251`. Known gap: whole-outline NDVI reads greener, so bare days run low (MODELS.md #1; fix = field-interior export). Selftest 72/72, i18n, build, en + es at 375 px checked.
- [ ] **Next (optional):** `ui-polish-2`. Then submission prep.

## Roadmap
- [x] Pipeline: real NASA POWER / IMERG / SMAP / Landsat / SRTM / SSURGO / CDL for 201 sampled fields
- [ ] Real data for every 30 m cell (today a tap loads the nearest sampled field)
- [x] Landsat 5/7 vs 8/9: harmonizing was tried and rejected; bare days use Landsat 8/9 only and pre-2013 is shown as low confidence (MODELS.md #14)
- [ ] Verify crop traits with Texas A&M AgriLife and NRCS. Agree on the `yearType` classification rule
- [x] What-if sliders (rain, hot days) → `app/src/components/WhatIfSliders.jsx`. A price slider could use `market.pricesTx[]` (2008–2025)
- [ ] Field walk mode (live GPS → cell, kept on device) → `FieldWalkMode.jsx`
- [ ] Memory pins (farmer notes on the map) → `MemoryPins.jsx`
- [ ] Vulnerability zones map (erosion and drought hot spots) → `VulnerabilityZonesMap.jsx`
- [ ] AI-assisted explanations (must stay grounded in the rule-based scores)
- [ ] Offline map tiles for the farmer's area. Code-split Leaflet and Recharts
- [x] Deploy: Vercel, https://greenline-psi.vercel.app (see Deploy)
