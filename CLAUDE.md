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
```

## Build status
Work happens on branch `app-build`. The `datasets` branch (worktree `Greenline-data`) only touches `/pipeline`, `/shared`, `/docs`.
- [x] **Phase 0: crop traits.** `crops.json` follows `docs/crop-traits-verification.md` and `-2.md` (sourced water, drought sensitivity, N fixation, sesame and late-rye-kill risks). Still `"verified": false`.
- [ ] **Phase 1: signature features.**
  - [x] 1.1 Bad-year replay re-scores rotations (`scoring/rules/replay.js`, `scoreRotation(..., { replayYear })`, Compare screen picker).
  - [x] 1.2 Bare days per rotation (`scoring/bareDays.js`; per-crop `bareShare` calendars in `crops.json`, built by `scoring/tools/build_calendars.mjs` from the 201 fields' 2013+ Landsat + CDL; estimates marked).
  - [ ] 1.3 Clearer green / residue / bare field story.
- [ ] **Phase 2:** not started (fertilizer-saved estimate from `nFixLbPerAcre`).
- [ ] **Phase 4:** not started.

## Roadmap
- [x] Pipeline: real NASA POWER / IMERG / SMAP / Landsat / SRTM / SSURGO / CDL for 201 sampled fields
- [ ] Real data for every 30 m cell (today a tap loads the nearest sampled field)
- [ ] Harmonize Landsat 5/7 with Landsat 8/9 NDVI (see MODELS.md)
- [ ] Verify crop traits with Texas A&M AgriLife and NRCS. Agree on the `yearType` classification rule
- [ ] What-if sliders (rain, heat, prices) → `app/src/components/future/WhatIfSliders.jsx`
- [ ] Field walk mode (live GPS → cell, kept on device) → `FieldWalkMode.jsx`
- [ ] Memory pins (farmer notes on the map) → `MemoryPins.jsx`
- [ ] Vulnerability zones map (erosion and drought hot spots) → `VulnerabilityZonesMap.jsx`
- [ ] AI-assisted explanations (must stay grounded in the rule-based scores)
- [ ] Offline map tiles for the farmer's area. Code-split Leaflet and Recharts
- [ ] Deploy (GitHub Pages or Netlify)
