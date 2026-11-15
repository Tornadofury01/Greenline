# Field Shift v2: prompts with model slots (models plugged in later)

Plan: build the whole site now. Pranav's models plug into "model slots" later; until then each slot uses a published default and the app tags those values "default value, field model coming". Type /clear after each step.

| | Terminal A (app) | Terminal B (engine + data) |
|---|---|---|
| Folder | Greenline | Greenline-data |
| Branch | v2-app | v2-engine |

Start B1 and A1 at the same time. A uses the sample file until B's engine output is merged.

## Model slots
| Slot | Provides | Default until the model is ready |
|---|---|---|
| Model A (field history) | Crop each year, crop dates, bare windows | USDA CDL history + crop library calendars |
| Model B (field response) | Drought/heat sensitivity per crop | FAO-33 Ky factors |
| Model C (year types) | Drought/hot/wet/normal years, 2040 frequencies | Existing year-types file |
| Model D (soil moisture) | Field soil moisture | SMAP area value |
| Calibration E (yields) | Yield settings | County/extension average yields |

---

## Terminal B

### B1: model slots and contract
```
Work in Greenline-data. Pull main, create branch v2-engine, push it. Read CLAUDE.md, docs/v2-workflow.md, docs/v2-prompts.md and docs/fieldshift-v2.md (if missing, ask me to paste Pranav's plan and save it there).
Models will be plugged in later. Design for that:
1. Write docs/v2-data-contract.md defining (a) the per-field MODEL SLOT files Pranav's models will produce later: shared/v2/models/<field-id>.json with sections modelA (crop by year + confidence, crop dates, bare windows), modelB (drought/heat sensitivity per crop, stress outlook), modelC (year types + 2040 frequencies), modelD (field soil moisture), calibrationE (yield settings); (b) the precomputed outputs the app reads (options, six scores, four fit checks, check-locally list, profit range, confidence, best plans, field risks, validation); (c) the crop library record.
2. Write /scoring/modelSlots.js: one function per slot that returns the model's values if the file exists, otherwise a documented DEFAULT, with a flag source: "model" | "default". Defaults: Model A = USDA CDL history in the field files + crop library calendars; Model B = FAO-33 Ky drought factors; Model C = the existing year-types file; Model D = the SMAP area value; Calibration E = county/extension average yields.
3. Write docs/v2-model-plugin.md for Pranav: exact file format, units, how to test that his file is read, and that nothing else needs to change.
4. Write a sample shared/v2-sample/sample-field.json that follows the output contract so Terminal A can start.
Commit and push. Explain in plain words what each slot does and its default.
```

### B2: crop library and engine
```
On v2-engine. Read docs/fieldshift-v2.md (crop library, engine), docs/v2-data-contract.md, scoring/modelSlots.js.
1. Build content/crop-library.json for the 10–15 crops that matter in Ellis County (wheat, corn, sorghum, cotton, soybeans, cowpea, cereal rye, crimson clover, hairy vetch, sorghum-sudan, sunflower, sesame, alfalfa, fallow). Every value has a source (FAO-56/33, ECOCROP, Texas A&M AgriLife, SARE, NRCS) and "verified": false.
2. Write the daily simulator engine in /scoring/engine/ as pure JavaScript (state object + step(day)): weather in, crop growth (GDD stages, simple AquaCrop-style biomass from transpiration, heat/frost/water stress), water balance, nitrogen, cover and daily RUSLE erosion, two-pool soil carbon, pest risk counters, money. It gets all field-specific settings ONLY through modelSlots.js, so swapping defaults for real models needs no engine changes.
3. Use the existing field files for weather, soil and slope. Target: one season under 0.1 s.
4. Selftests run with node: water balance closes, no negatives, bare erodes more than covered, same inputs give the same output, and switching one slot from default to a fake model file changes the result.
Commit and push. Report speed and test results.
```

### B3: options, fit checks, optimizer, scoring and precompute
```
On v2-engine. Read docs/fieldshift-v2.md (options, four fit checks, profit, uncertainty), the contract and modelSlots.js. In /scoring, pure JS using the engine:
- Option generator (up to 30 options + current), four fit checks (water, disease, market, season: pass/warn/fail + one-line evidence; thresholds as named constants "to confirm with an agronomist"), optimizer (planting date, N rate, maturity, cover termination, double crop, tillage, irrigation; median return above variable costs within risk and soil T limits; most profitable / best balance / safest), six scores weighted by priorities, what-if runs for confidence (start with 200 if 1,000 is slow), check-locally list. Rules return i18n keys and params, never English text.
- Every output records which model slots were defaults, so the app can show "default value, field model coming".
- A Node precompute script writes shared/v2/fields/<id>.json for all 300 Ellis County fields. Report timing and file sizes.
- Validation: a report card (shared/v2/validation.json) with the checks we can run now (bare days vs measured, yields vs NASS, crop dates) and "pending model" for the rest.
Run all selftests. Tag current main v1.2-submittable if not tagged, merge v2-engine into main, push, tell me.
```

---

## Terminal A

### A1: setup and Options screen
```
Pull main. Merge nikkibranch into main if not already, create branch v2-app, push. Read docs/v2-prompts.md, docs/fieldshift-v2.md (App screens), docs/v2-data-contract.md, design-refs/DESIGN-BRIEF.md.
All v2 data goes through ONE loader: it reads shared/v2/fields/<id>.json when it exists, otherwise shared/v2-sample/sample-field.json, and shows a small "Sample data for testing" banner (en/es) only when using the sample. Any value whose source is a default model slot shows a small receipt tag "default value, field model coming".
Build the Options screen: cards for the top options vs the current rotation with grade, six scores, the four fit checks as pass/warn/fail chips with one-line evidence, profit range, soil saved, nitrogen saved, confidence badge with reason, "Check locally" list. Match the new design. All text in en.json/es.json. Selftest, i18n, build, screenshots at 375 px dark and light, commit and push.
```

### A2: Best plans and Field risks
```
On v2-app. Read docs/fieldshift-v2.md (screens 2, 3, 5) and the contract. Build:
- Best plans: most profitable / best balance / safest side by side, with management choices, profit as a range and the chance of beating the current rotation. Wording: "best expected profit within your limits", never "guaranteed".
- Field risks: stress calendar with next month's risk and reason, erosion hotspots, water and groundwater trend, frost and heat now vs 2040.
Add them to SCREEN_COMPONENTS and the nav (must still fit at 375 px; propose a "More" menu if not). Same checks, screenshots, commit and push.
```

### A3: Farm simulator
```
On v2-app. Read docs/fieldshift-v2.md (Farm simulator) and the contract. Build the farm simulator using /scoring/engine directly in the browser (no server); if the engine isn't on main yet, build against a stub with the same interface. Starting state "your farm today"; controls for plan, inputs, money, weather scenario (typical, a past year, 2040 middle/high, sliders) and length; play, pause, step a day, jump a month; charts for crop, water, soil, nutrients, pests, money; event log; two plans side by side; uncertainty band. Label: "shows what would happen under the chosen weather, not a forecast". Run the engine in a web worker so the phone stays smooth. Checks, screenshots, commit and push.
```

### A4: Field story timeline, Evidence, report and guide
```
On v2-app. Read docs/fieldshift-v2.md (screens 2 and 7). Update Field story to the 40-year timeline (one row per year colored by crop, green/residue/bare days, headline from real data, pre-2013 marked low confidence). Build the Evidence view (tap any number: datasets, resolution, dates, which model or default, validation status) and the printable one-page field report (light mode). Then add the help guide (first-visit walkthrough + help button bottom-right with preset questions per screen + read aloud, no AI model) covering the new screens. Checks, screenshots, commit and push.
```

### A5: switch to engine output and deploy
```
On v2-app. Pull main (Terminal B merged the engine and precomputed fields). Confirm the loader now reads shared/v2/fields and the sample banner is gone; "default value, field model coming" tags remain where slots are defaults. Fix anything that breaks. Remove any claim the app doesn't do (e.g. "any US field"). Selftest, i18n, build, screenshot every screen at 375 px. Merge v2-app into main, push, cd app && npm run deploy, confirm the live site in an incognito window.
```

## For Pranav
Send him docs/v2-model-plugin.md after B1. His models write shared/v2/models/<field-id>.json in that format; rerun the B3 precompute script and the defaults are replaced everywhere.

## For the submission
Describe the models as "being trained; the app uses published defaults where a model isn't ready yet." Don't claim accuracy numbers for models that aren't plugged in.
