# Greenline

A mobile-first PWA for the NASA Space Apps challenge "Field Shift: Adapting Farms with NASA Data".
It helps North Texas farmers compare crop rotations using NASA Earth observation data.
**It supports farmer judgment and local experts. It doesn't replace them.**

Current stage: a skeleton running on **fake sample data**. Real data, AI and advanced features come later.

## Stack
- Vite + React (JavaScript, no TypeScript), Leaflet (react-leaflet 4), Recharts, vite-plugin-pwa
- No backend. All data comes from static JSON.

## Folders
| Folder | What goes here |
|---|---|
| `/app` | The React PWA. `npm` commands run from here |
| `/scoring` | Rotation scoring as plain JS functions with no React and no DOM. Imported by the app as `@scoring` |
| `/content` | `crops.json`, `rotations.json`, `i18n/en.json`, `i18n/es.json` (all user-facing text, including the glossary) |
| `/shared` | `sample-field.json` and `data-format.md` (the field data contract) |
| `/pipeline` | Future Python / Earth Engine processing. Outputs files in the `/shared` format |

Aliases set in `app/vite.config.js`: `@content`, `@shared`, `@scoring`.

## Key code paths
- Field data enters the app in **one place**: `app/src/data/loadField.js`. Swap the sample for real pipeline output there.
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

## Roadmap
- [ ] Pipeline: real NASA POWER / IMERG / SMAP / HLS / SRTM / SSURGO / CDL outputs per 30 m cell
- [ ] `loadFieldAt(lat, lon)`: tap → grid cell → fetch that cell's JSON
- [ ] Verify crop traits with Texas A&M AgriLife and NRCS. Agree on the `yearType` classification rule
- [ ] What-if sliders (rain, heat, prices) → `app/src/components/future/WhatIfSliders.jsx`
- [ ] Field walk mode (live GPS → cell, kept on device) → `FieldWalkMode.jsx`
- [ ] Memory pins (farmer notes on the map) → `MemoryPins.jsx`
- [ ] Vulnerability zones map (erosion and drought hot spots) → `VulnerabilityZonesMap.jsx`
- [ ] AI-assisted explanations (must stay grounded in the rule-based scores)
- [ ] Offline map tiles for the farmer's area. Code-split Leaflet and Recharts
- [ ] Deploy (GitHub Pages or Netlify)
