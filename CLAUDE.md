# Greenline

A mobile-first PWA for the NASA Space Apps challenge "Field Shift: Adapting Farms with NASA Data".
It helps North Texas farmers compare crop rotations using NASA Earth observation data.
**It supports farmer judgment and local experts. It doesn't replace them.**

Current stage: running on **real data for 201 North Texas fields** (NASA POWER, IMERG, SMAP, Landsat, SRTM, SSURGO, CDL)
and three trained SI models (season/crop classifier, vegetation stress signal, year patterns; see `pipeline/MODELS.md`).
The fake `shared/sample-field.json` is only a fallback when a field file is missing.

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
  (built by `pipeline/build_fields.py`); falls back to the fake `sample-field.json` if a file is missing.
- **Demo field: one setting**, `DEMO_FIELD_ID` in `app/src/config.js` (or `VITE_DEMO_FIELD_ID` in `app/.env.local`). Default `nt-103`.
- SI models: `/pipeline/models/`, documented in `/pipeline/MODELS.md`. App display helpers: `app/src/si.js`.
- Evidence receipts: scoring reasons may carry `src` (dataset names). `<Receipt>` in `components/Small.jsx` shows them.
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
- Before sharing a new build, check: the live link opens in an incognito window, `sw.js` precaches `assets/fields/<demo id>-*.js`, and the deploy output contains no `.env` values.

## Build status
Work happens on branch `app-build`. The `datasets` branch (worktree `Greenline-data`) only touches `/pipeline`, `/shared`, `/docs`.
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
- [ ] **Phase 2b: dollars and what-if** (separate session; placeholder prices, don't copy the datasets session's uncommitted NASS CSVs).
  - **Dollar estimates**, shown on the card only, never in the score:
    - New `content/economics.json`: placeholder N price ($/lb), N credit share (50%: cover crops don't hand over all the nitrogen they fix), and yield + unit + $/unit for wheat, sorghum, cotton, corn, sunflower, sesame, alfalfa hay, sorghum-sudangrass hay. Every entry `placeholder: true` with a source label.
    - New pure `scoring/economics.js`: `estimateDollars(crops, econ)` returns `{ fertilizer: {lo, hi}, grossPerAcreYear, byCrop[], placeholder, src }`. `scoreRotation` takes `economics` via `options` and returns `dollars`. Built so a later `field.economics` (NASS county yields) can override the defaults. Alfalfa (`nFixLbPerAcre: null`) shows "not known yet".
    - `DollarBlock` on the card with an "Estimate" pill, a `<Receipt>` source and a "placeholder figures" notice. Income is labeled "gross, before costs". No profit number.
    - New `docs/economics-placeholders-todo.md` (the only new /docs file): which numbers are placeholders, the NASS series from `pipeline/nass_quickstats.py`, the JSON shape the app expects.
  - **What-if sliders** (rain %, temperature °F), reusing the replay logic:
    - In `scoring/rules/replay.js` split `hazardsFromRow(field, row)` out of `yearHazards`. New `whatIfHazards(field, { rainPct, tempF })` builds a pretend row from the field's own averages: rain x (1 + pct), heat-stress days + 7 per °F (stated assumption, field files have no daily temperatures), storms scale with rain, SMAP null.
    - `replayRule` takes a hazards object. `scoreRotation` `options.whatIf` goes through the same blend path as `replayYear`, with `replay.hypothetical = true`.
    - AppContext: `whatIf` and `replayYear` share one scenario slot (setting one clears the other). `useScores` passes it.
    - Build `WhatIfSliders.jsx` (move out of `future/`): rain -50…+50 % step 10, temperature -2…+6 °F step 1, native range inputs >= 44 px, Reset, "Hypothetical, not a forecast" banner, placed in the Replay card. Card labels get what-if variants and a "Hypothetical" badge.
    - Selftest: -40 % rain scores <= normal; 0/0 is close to a mild year.
- [ ] **Phase 4:** not started.

## Roadmap
- [x] Pipeline: real NASA POWER / IMERG / SMAP / Landsat / SRTM / SSURGO / CDL for 201 sampled fields
- [ ] Real data for every 30 m cell (today a tap loads the nearest sampled field)
- [ ] Harmonize Landsat 5/7 with Landsat 8/9 NDVI (see MODELS.md)
- [ ] Verify crop traits with Texas A&M AgriLife and NRCS. Agree on the `yearType` classification rule
- [ ] What-if sliders (rain, temperature; prices come with Phase 2b dollars) → `app/src/components/future/WhatIfSliders.jsx`
- [ ] Field walk mode (live GPS → cell, kept on device) → `FieldWalkMode.jsx`
- [ ] Memory pins (farmer notes on the map) → `MemoryPins.jsx`
- [ ] Vulnerability zones map (erosion and drought hot spots) → `VulnerabilityZonesMap.jsx`
- [ ] AI-assisted explanations (must stay grounded in the rule-based scores)
- [ ] Offline map tiles for the farmer's area. Code-split Leaflet and Recharts
- [ ] Deploy (GitHub Pages or Netlify)
