# Greenline: complete summary (Nov 15, 2026)

Live app: https://greenline-psi.vercel.app · Repo: github.com/Tornadofury01/Greenline (public)
Challenge: NASA Space Apps 2026, "Field Shift: Adapting Farms with NASA Data" · Local event: Dallas (37 teams; Green Line is the only agriculture team)
**Deadline: Sunday Nov 15, 11:59 p.m. Central.** Award focus: **Local Impact** (lead story) with **Best Use of Data** wording ("makes NASA data usable").

---

## 1. What Greenline is
A free, bilingual (English/Spanish), phone-first web app that helps North Texas farmers compare crop rotations for **their own field**, using NASA satellite and weather data, USDA soil and crop data, and the farmer's priorities. It shows options, the best plans, risks and a day-by-day farm simulator, and every number says where it came from and how sure we are. **It supports farmer judgment and local experts; it doesn't replace them.**

Coverage today: **300 USDA field outlines in Ellis County, TX** (`ec-000` … `ec-299`; default field `ec-251`, 100 acres of Houston Black clay).

## 2. The app, screen by screen
Bottom tabs, in the farmer's order: **Field · Farm · History · Options · Plans · More**

| Screen | What it does |
|---|---|
| **Field** (map) | Satellite map (USGS imagery) with the 300 field outlines, Ellis County line, town labels. Pick a field by tapping inside its outline, searching an address/road/town, or "Use my location". Cropland and distance warnings. Address and GPS are never saved. A natural "start with a field near [town]" shortcut (no "demo" wording). |
| **Farm** | The farmer's priorities (income, soil, risk, water…), limits, and **"How do you till?"** (conventional / reduced / no-till; default reduced, "our assumption until you tell us"; saved on the device). |
| **History** | The field's crop-by-year timeline with green / partly covered / bare time; pre-2013 years marked low confidence; link to the field's risks. |
| **Options** | Up to 30 rotation options + the current one. Each card: grade, **six scores** (Profit, Risk, Soil, Water, Nutrients, Pests), **four fit checks** (water, disease, market, season: pass / warn / fail with a one-line reason), profit range and chance of beating the current rotation, soil and nitrogen saved, confidence badge, "Check locally" list. |
| **Plans** | Three best plans side by side: **most profitable, best balance, safest**, with management choices (planting date, N rate, variety, cover crop end, double crop, tillage, irrigation). "Best expected profit within your limits", never "guaranteed". |
| **More → Risks** | Stress calendar (12 months, colorblind-safe), next months' risk with reason, erosion hotspots, water and groundwater trend, frost and heat now vs 2040 ("climate scenarios"). |
| **More → Farm simulator** | Start from "your farm today", change crops, cover crops, tillage, nitrogen, irrigation, prices and weather (typical, a past year, 2040 scenarios, rain/heat sliders), 1–30 years; play / pause / step a day / jump a month; charts for crop, water, soil, nutrients, pests, money; event log; two plans side by side; uncertainty band over **18 past seasons (2008–2025)**. "Shows what would happen under the chosen weather, not a forecast." Uses the Farm tillage setting. |
| **More → Compare** | The v1 comparison: rotation cards, bad-year replay, what-if rain/heat sliders, build-your-own rotation. |
| **More → Expert** | Printable page for the county extension agent: evidence, confidence, questions to ask. |
| **How we know** (book icon) | Plain-language glossary, dataset explanations, the **validation report card** (all checks, failures included), privacy. |
| **Help guide** | First-visit walkthrough and a help button with preset questions per screen and read-aloud (no AI model, no network). |

Everywhere: English/Spanish (formal *usted*), dark/light mode (follows the phone, toggle saved), tap targets ≥ 44 px, no text under 12 px, works offline after first visit, no account.

## 3. How it works

```
REAL DATA per field           MODEL SLOTS (5)                 ENGINE (JavaScript, /scoring)              APP
weather, soil, slope,   +     placeholders today,     →     daily farm simulation + options +     →    reads saved answers;
USDA crop history,            Pranav's models later           fit checks + optimizer + scores           simulator runs live
NASS market                                                   (run ahead of time = "precompute")         on the phone
```

- **Real data** (measurements, in `shared/fields/ec-*.json`): daily/monthly weather 2008–2025, SSURGO soil (water held, erodibility, T), SRTM slope, USDA Cropland Data Layer crop history, NASS county yields and Texas prices.
- **Crop library** (`content/crop-library.json`): 14 crops (wheat, corn, sorghum, cotton, soybeans, cowpea, cereal rye, crimson clover, hairy vetch, sorghum-sudan, sunflower, sesame, alfalfa, fallow) with water use, temperature limits, growth stages, nitrogen, residue, pests, costs; cited to FAO-56/33/66, ECOCROP, Texas A&M AgriLife, SARE, NRCS, NASS. Written from those references, not re-fetched: `verified: false`. Wheat values spot-checked against FAO and match.
- **Model slots** (`scoring/modelSlots.js`): five places where trained models plug in. **Today all five use fixed placeholders** from `content/model-placeholders.json`, the same for every field. Old models are not used anywhere.

| Slot | Provides | Placeholder today |
|---|---|---|
| Model A, field history | crop each year + confidence, crop dates, bare windows | crop per year from USDA crop map; one typical calendar per crop |
| Model B, field response | drought/heat sensitivity, stress outlook | one fixed value per crop; fixed monthly stress chance |
| Model C, year types | drought/hot/wet/normal years, 2040 mix | 2000 and 2011 drought, 2015 wet, rest normal; 2040 = today |
| Model D, soil moisture | field soil moisture today | one fixed value (half full) |
| Calibration E, yields | yield settings | one typical dryland yield per crop |

- **Engine** (`scoring/engine/`, `scoring/v2/`): pure JavaScript, the same code in the browser and in Node. Daily: weather → crop growth (GDD stages, AquaCrop-style biomass, heat/frost/water stress) → water balance → nitrogen → cover and daily RUSLE erosion → soil carbon → pests → money. About 1 ms per season.
- **Precompute** (Node script): for every field, builds up to 30 options, tries management choices, runs every past season and 1,000 what-if runs, picks the three best plans, scores, fit checks, risks, and saves one file per field (`shared/v2/fields/ec-*.json`, 91–132 KB each, 36 MB total; 31 minutes on 7 threads). **Rerun it whenever the model settings, rules or crop library change.**
- **App loading:** first load is about 1.8 MB (only the default field precached); every other field loads when opened, then works offline.
- **No server.** Static files on Vercel; nothing to crash during judging.

## 4. Models: status and how to plug them in
- The three earlier models (crop classifier, stress model, year types) are **retired** and not used.
- Pranav is training the new models (plan: `docs/fieldshift-v2.md`). Format and test command: `docs/v2-model-plugin.md`.
- To plug them in: his files go in `shared/v2/models/<field-id>.json` → check with `node scoring/tools/checkModelFile.mjs` → **rerun the precompute** → commit, push, deploy. Placeholder tags disappear where his models fill in. No app changes needed.
- Models are trained on wider North Texas data; the app covers Ellis County only because that's where field data has been downloaded. More fields = download their data, run the models, rerun the precompute.

## 5. Validation report card (`shared/v2/validation.json`, shown in How we know)
| Check | Result | Main cause |
|---|---|---|
| Bare days vs satellite | Fail (17% of fields within 15 days; 55 simulated vs 25 measured) | Mostly the tillage assumption (no-till → 48%, −5 d); measured whole-field averages also undercount bare soil |
| Crop dates | Fail (≈30 days off; cotton worst) | Partly placeholder calendars (Model A); cotton/wheat timing also an engine/crop-library issue |
| Yields vs NASS | Partial (cotton passes) | Yield level is a calibration job (Calibration E); corn's year-to-year response is an engine/weather issue |
| Model accuracy, soil moisture, neighbor backtest | Pending a model | |
| Erosion, expert ranking | Not run (needs measurements / an agent interview) | |

Diagnostic (not shipped): a yield scale fixes levels (wheat error 28% → 11%); real dates help corn and cotton but not enough; tuning cotton's heat sum improved dates but broke cotton's yield tracking (0.55 → 0.01), so it was reverted. Expected fix: Model A calendars + Calibration E.

## 6. Honesty labels in the app
- One "placeholder values until our field models are ready" notice per screen, one tag per card (tap for which slot).
- Confidence capped at medium: "can't be high until our field models are ready".
- "Climate scenarios", never "climate models", for 2040.
- Options/Plans/Risks assume reduced tillage (precomputed); the farmer's tillage setting is used in the farm simulator.
- 55 fields with no crop history: "likely pasture or hay; the current rotation is a guess".
- Cost-share "not estimated"; fixed costs tagged placeholder; profit rests on uncalibrated yields.
- "18 past seasons (2008–2025)", "300 Ellis County fields (USDA outlines), not every farm".
- Validation card shows failures: "Some gaps come from placeholder values our field models will replace; others we're still tuning in the engine."

## 7. Team workflow
| | Folder | Branch | Role |
|---|---|---|---|
| Terminal A (you) | `Greenline` | `nikkibranch` (UI) | App screens and UI |
| Terminal B | `Greenline-data` | `v2-engine` | Engine, data, precompute (finished; leave on `v2-engine`) |
| Pranav | his laptop | `models-v2` | New models |

- Branches: `main` = live app. `v2-app`, `v2-engine` merged. `landsat-harmonize` stays unmerged (rejected).
- Tags: `v1.0-checkpoint`, `v1.2-submittable` (before v2), add `v2.0-submitted` at the end.
- Rules: nobody pushes straight to `main` except the final wrap-up; only one folder can have `main` checked out (Terminal B stays on `v2-engine`); `/clear` between Claude steps; never commit `.env` or `design-refs/`.
- Deploy: only from the laptop, `cd app && npm run deploy` (Vercel isn't connected to GitHub; pushing doesn't update the site).
- **Freeze time (suggested 6 p.m. Central):** after it, no new features. Run the **wrap-up prompt** in Terminal A: merge `nikkibranch` (+ `models-v2` only if its checks pass), checks, deploy, tag `v2.0-submitted`. **Don't redeploy after submitting.**
- Docs in the repo: `CLAUDE.md`, `docs/HANDOFF.md`, `docs/fieldshift-v2.md` (Pranav's plan), `docs/v2-data-contract.md`, `docs/v2-model-plugin.md`, `docs/v2-i18n-keys.md`, `docs/v2-prompts.md`, `docs/v2-workflow.md`, `docs/award-plan.md`, `docs/SUBMISSION-DRAFT.md` (needs a v2 rewrite), `design-refs/DESIGN-BRIEF.md` (local only).

## 8. Submission checklist
1. Freeze → wrap-up prompt → live site deployed and tagged.
2. Test the live site on a phone in a private tab (3 fields; Options, Plans, simulator).
3. Rewrite the project page for v2 (no model accuracy numbers while models are placeholders; describe the engine, options, plans, simulator, validation card and honest gaps; Ellis County numbers: 2,563 farms, 203,455 cropland acres; 2011 drought cost Texas agriculture $7.62B).
4. Farmer quotes with consent (first name or "a local farmer"; adults only; no locations).
5. Demo: 30-second video with English subtitles **or** ≤ 7 slides; public link.
6. Fill in the Space Apps page (summary, demo link, live link, description, NASA data, other data, AI use), add screenshots, test links in a private tab.
7. **Submit for Judging** before 11:59 p.m. Central; wait for the confirmation banner.

## 9. Known limits and next steps
- Placeholder models → plug in Pranav's models and rerun the precompute.
- Bare-day and crop-date gaps; corn's drought response; cotton/wheat timing.
- Options/Plans don't re-score for the farmer's tillage (only the simulator does).
- Ellis County only; "any US field" needs a server and on-demand data (Pranav's plan).
- Crop library values need checking with Texas A&M AgriLife / NRCS.
- Next ideas: farmer's own rain gauge / soil test / yields input, extension-office pilot, more counties.
