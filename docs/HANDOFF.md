# Greenline: Full Handoff for Claude Code

**Read this first, all of it, before touching anything.** It is the complete context from the long planning and build conversation with the team (Divya and teammates, Brightcone), written so a fresh Claude Code session can continue without asking the team to re-explain. It complements `CLAUDE.md` (which stays the source of truth for code paths and commands). Where this file and `CLAUDE.md` disagree about code, trust the code and `CLAUDE.md`, then tell the user.

Live app: https://greenline-psi.vercel.app · Repo: github.com/Tornadofury01/Greenline (public) · Last tag: `v1.0-checkpoint` on `main`.

---

## 0. How to work with this user (important)

- The user is **a beginner at coding and git**. The team is "vibe coding": the user gives feedback to agents and does not read code. Explain what you are doing in plain language, one step at a time. Define a term the first time you use it.
- The user asked, repeatedly, **not to be a yes-man**. Push back when something is wrong, risky, or not worth the time. Say why, then offer the better option. Do not flatter.
- Give **exact copy-paste commands and prompts**. Do not say "run the usual commands".
- Two Claude Code terminals are used, in two separate git worktrees:
  - **Terminal A** = the app, folder `Greenline` (branch `app-build`). Touches `/app`, `/scoring`, `/content`.
  - **Terminal B** = data and models, folder `Greenline-data` (branch `datasets`). Touches only `/pipeline`, `/shared`, `/docs`.
  - Never run two sessions in the same folder. If you are unsure which terminal you are, run `pwd` and `git branch --show-current` and say so.
- Workflow habits: plan mode first for anything big (Shift+Tab), then accept-edits. Opus to plan, Sonnet to build. `/clear` between unrelated tasks. Large work is split into phases that each end in a commit.
- Commit small, commit often, with a plain message. The repo is public, so **never commit `.env`, API keys, or tokens.** If you are about to stage a file that might hold a secret, stop and check.
- When you finish a task: one or two sentences on the outcome, what changed, and what the user should check. No long recaps.
- Be honest about uncertainty and limits. This project's credibility with judges rests on honest numbers (see section 9).

---

## 1. The competition

**Event:** NASA International Space Apps Challenge 2026. **Challenge:** "Field Shift: Adapting Farms with NASA Data."

### 1.1 Challenge statement
Farmers face shifting temperatures, changing rainfall, water shortages, extreme weather and declining soil health, which makes choosing crop rotations hard. Build a **decision-support tool** that uses NASA Earth observations plus local soil information, crop characteristics and farmer priorities, to help farmers explore rotation strategies that strengthen soil health and adapt to changing conditions. A crop that helps soil in one place can use too much water, bring disease, lack a local market, or not fit the season somewhere else.

### 1.2 What the tool must do
- Combine NASA Earth observations with local agricultural information. Any format is allowed (app, model, map, other).
- Analyze temperature, heat stress, rainfall, soil moisture, evaporation, frost risk, extreme precipitation, vegetation stress, long-term water trends.
- Consider soil, crop traits and farmer priorities (water use, forage value, nitrogen fixing, erosion reduction, organic matter, market fit).
- Highlight bare-field periods, vulnerable seasons, and rotations that break pest cycles, cut water demand, improve infiltration or add income.
- **Compare at least three rotation strategies, including the current one.** For each: **why it was suggested, the evidence, the benefits, the information gaps, and the risks that need local expert review.**
- **It supports farmer judgment and local expertise. It does not replace them.** This sentence is the product's core principle. Keep it visible in the UI and in all wording.

### 1.3 Optional "potential considerations" (we cover most)
Explain ET, soil moisture anomalies, NDVI, frost risk, water balance; satellite vs ground data. Compare SI/statistical approaches; detect seasonal transitions, bare periods and stress; explain uncertainty and where local expertise is needed; harmonize datasets of different resolutions. ("SI" is the challenge's term for AI/ML.) Rotation exploration: nutrient cycling, erosion, organic matter, pests, water, forage, markets; explain nitrogen-fixing, cover, deep-rooting, drought-tolerant crops. Mapping: interactive maps, trends, vulnerability zones, timelines, overlays, scenario sliders. Farmer-centered design. AI is allowed.

### 1.4 Datasets the challenge suggests
- NASA: SMAP, GPM/IMERG, Landsat, MODIS/VIIRS, POWER, SRTM, ECOSTRESS, GRACE/GRACE-FO, NLDAS/GLDAS, GEDI.
- USDA/other US: Ag Data Commons, Web Soil Survey, SSURGO/STATSGO2, Cropland Data Layer, PRISM, NAIP, NLCD, CoCoRaHS, USGS NWIS, USDA AMS Market News, NASS Quick Stats, OpenET, LANDFIRE, FAO GAEZ.
- Partners: Copernicus Sentinel-2, ERA5.

### 1.5 Judging
Five criteria, each scored 1–5:

| Criterion | A 5 means |
|---|---|
| Impact | Significant problem, wide reach, could change things |
| Creativity | Original, stands out |
| Validity | Scientifically sound, feasible, fully developed, usable |
| Relevance | Directly addresses the challenge; **NASA data is core, not decoration** |
| Presentation | Clear storytelling, polished demo and video |

Phases: local/universal judging picks **Global Nominees (Dec 3, 2026)** → global judging picks **Global Finalists + Honorable Mentions (Dec 17, 2026)** → executive judging picks **Global Winners (Jan 26, 2027)**. Local awards are separate. Only Global Nominees advance.

Ten global awards: Best Use of Science, **Best Use of Data**, Best Use of Technology, Galactic Impact, Best Mission Concept, Most Inspirational, Best Storytelling, Global Connection, Art & Technology, **Local Impact**.

**Targets:** Local Impact (primary), Best Use of Data (secondary). Backups: Galactic Impact, Best Use of Science, Best Storytelling. Skip: Mission Concept, Global Connection, Art & Technology.

### 1.6 Submission rules (official Project Submission Guide)
- Page fields: project name; high-level summary (required); **demo link (required, public, hosted externally)**; final project link (public, no login); detailed description; **NASA data used (required for Global Award eligibility)**; partner/other data; **use of AI**; verification checkboxes (Terms and Conditions, "all work is original").
- **Demo: a video of 30 seconds or less with English subtitles, OR a slide deck of 7 slides or fewer.** Exceeding it makes the project **ineligible for Global Judging.** Host on YouTube, Drive, GitHub etc. (no uploads to the NASA site).
- All content in English.
- AI disclosure required. AI-generated images or video need a visible watermark. AI content may not use or alter NASA branding.
- **Do not use the NASA logo or "meatball" in the app or video.**
- No recognizable people under 18. Adults must consent to NASA's use of name and likeness. No personal information.
- Click **"Submit for Judging"** before the local event's deadline (its time zone). Submissions are final; late ones are not judged. **"Save Progress" makes the page publicly visible.** Test every link in a private browser.
- All team members must be confirmed at the same Local Event.
- **Deadline (from the official Judging & Awards Guide): Sunday, November 15, 2026 at 11:59 p.m. local time of the Local Event (Dallas = Central Time).** Confirm with the Dallas Local Lead, but plan for this. No new features after the freeze; protect the submission.
- **Award focus (decided Nov 14 after studying the 2023–2025 winners): Local Impact** ("greatest potential for making a difference in their local community"). The data rigor (7 NASA sources, PRISM validation, the Landsat sensor catch) is the evidence that backs the local story, not a second story. Every piece of submission text and the video should lead with North Texas / Ellis County, a sourced local number, real farmer input, and a concrete next step with the local extension office. Local numbers: Ellis County has 2,563 farms and 203,455 acres of cropland (corn 34,337, wheat 29,231, cotton 17,349, sorghum 9,165 acres; 2022 Census of Agriculture); Texas farms lost a record $7.62 billion to the 2011 drought (Texas AgriLife Extension economists).

---

## 2. Product strategy and decisions

- **Format:** mobile-first PWA (installable website). Reasons: farmers use phones in the field; judges just open a link; works offline; GPS; no app store review. Must still look good on laptops (checked at 375 / 768 / 1280 px).
- **Region:** North Texas. Demo field **nt-103, Ellis County** (Houston Black clay, Blackland Prairie). Region facts: winter wheat, cotton, sorghum, corn, hay; clays crack when dry and seal and run off in storms; 2011 and 2022 droughts; bare summer fields after wheat.
- **AI approach (a deliberate decision):** we do **not** train a model to predict "which rotation is best", because no honest training data for that exists. **SI reads the field** (crop/season detection, stress signal, year types). **Transparent rule-based agronomy compares rotations.** **The farmer decides.** Do not change this without discussing it with the user.
- **Why rules for scoring:** every score has human-readable reasons with dataset receipts. That is what lets the expert-handoff page work and keeps us honest.
- **Farmers market visit** (Saturday 10 AM): the user planned to ask what farmers rotate, which months fields sit bare, biggest weather worry, a bad year they remember, who they trust for advice, English or Spanish, phone use, interest in cover crops. Permission is needed before quoting or filming. Vendors may be vegetable/ranch growers rather than row-crop farmers. Any real rotation they give could replace the demo rotation.
- **Pitch wording rules:**
  - Say "for a farmer focused on water and soil, Option A scores 80 vs 18", never "your rotation is bad".
  - Never claim bare days are declining over time (that trend was a sensor artifact).
  - Say "40 years of weather and over a decade of satellite ground cover".

---

## 3. What the app does (user-visible flow)

1. Open link, no sign-up, English or Spanish (Spanish uses formal *usted*).
2. **Pick your field:** green dots = the 201 real sampled fields. Tap a dot, tap anywhere (loads the nearest sampled field and says how far), or **Use my location**. Warnings: spot is not cropland; nearest field is more than 25 km away. GPS point is never stored or sent.
3. **Your farm:** current rotation, priorities (water, erosion, soil, income, cattle), constraints (dryland/irrigated, water source, equipment, budget, market).
4. **Field story:** green / partly covered / bare months from Landsat 8/9 (2014+), pre-2013 shown muted with a low-confidence tag; drought/wet/heat/normal years; bare days per year; soil facts (K, T, water in top 1 m, land capability class); PRISM frost dates.
5. **Compare rotations:** current + best suggestions + "build my own". Each card: score, bare days per year, why / evidence (dataset receipts) / benefits / gaps / risks, tags (nitrogen-fixing, cover crop, deep roots, diverse, drought-tolerant, pest-cycle break), confidence with up and down reasons, AI insights, dollar estimates (gross revenue, before costs, not profit; fertilizer value from N fixing).
6. **Replay a bad year** (2011, 2023, 2007, 2004, 2018, 2000): each rotation re-scored under real weather, verdicts Holds up / Under strain / Struggles / Struggles badly. **What-if sliders:** rain −50…+50 %, extra days ≥ 95 °F 0…+40, labeled "Hypothetical, not a forecast". A scenario can only lower the normal score.
7. **Farm simulator** (More menu, a game): split your field into 4 plots, set each one up (crop, cover, tillage, fertilizer, irrigation), then play 5 seasons of real past weather and see which plot holds up (money, soil, water). Free play (5 random past years) or 3 challenges with stars (Survive 2011, Keep the soil, Beat your current rotation). "Play this plan" on Plans / Compare loads a plan onto plot 1. Labeled "Replays real past weather on your field. Not a forecast." **Numbers are mock until the engine is wired in `app/src/game/runSource.js`** (the game shows a "Mock numbers" tag). It replaced the old chart simulator (docs/game-plan.md, G2d).
8. **Expert handoff:** printable page for the county extension agent with evidence, confidence, questions, NRCS cost-share note.
9. **How we know** (book icon): glossary (NDVI, residue, ET, soil moisture anomaly, frost, water balance, bare days, confidence, held-out accuracy, satellite vs ground, why 2013 matters).

---

## 4. Architecture

- **Stack:** Vite + React (JavaScript, no TypeScript), Leaflet (react-leaflet 4), Recharts, vite-plugin-pwa. **No backend.** All data is static JSON.
- **Two halves:**
  - *Ahead of time:* NASA/USDA data → Google Earth Engine (server-side reductions) → Python pipeline → sklearn models → per-field JSON in `/shared/fields` and `/shared/si`.
  - *App:* reads those JSON files; rotation scoring runs in the browser (instant, offline, what-if is just re-scoring).
- **The app never runs the models.** It reads their saved results. That is why a teammate can swap models without touching the app, as long as the output format is kept (`/shared/data-format.md`).
- **Folders:** `/app`, `/scoring` (pure JS, no React/DOM), `/content` (crops, rotations, economics, `i18n/en.json`, `es.json`), `/shared`, `/pipeline`, `/docs`. Aliases: `@content`, `@shared`, `@scoring`.
- **Code paths** (details in `CLAUDE.md`): `app/src/data/loadField.js` is the only place field data enters; `DEFAULT_DEMO_FIELD_ID` in `app/src/config.js` (default `nt-103`) is the one demo-field setting; `scoring/scoreRotation.js` plus one rule per file in `scoring/rules/`; `scoring/confidence.js`; `scoring/economics.js`; `scoring/bareDays.js`; `app/src/display.js` (`bareRows()`, `coverRows()`); `app/src/si.js`; `app/src/state/`.
- **Rules that must not break (from CLAUDE.md):**
  1. All user-facing text in `en.json` and `es.json`, nothing hardcoded in JSX, same keys in both.
  2. Data follows `/shared/data-format.md`; change the doc and the sample together.
  3. Never commit API keys; Vite exposes only `VITE_*` vars to the browser, so treat those as public.
  4. Never store or send raw GPS; use the 30 m `gridCell` id.
  5. Scoring rules small, pure, commented. Run `node scoring/selftest.js` (72 checks) after changing them.
  6. Crop traits in `crops.json` are placeholders (`"verified": false`) until checked with AgriLife/NRCS.
  7. Mobile-first: tap targets at least 44 px, plain language.
- **Commands (run from `app/`):** `npm install`, `npm run dev`, `npm run build`, `npm run preview`, `npm run selftest`, `npm run i18n`, `npm run deploy`.

### 4.1 Deploy (read carefully, it is the easiest thing to get wrong)
- Vercel CLI from the team's laptop only. The project is **not connected to GitHub** (a teammate owns the repo). **Do not run `vercel git connect`.** Pushing to GitHub does **not** update the live site.
- To update the live site: pull latest `main`, then `cd app && npm run deploy` (runs selftest and i18n check, builds with Vite, `scripts/vercel-output.mjs` packages `dist/` into `.vercel/output/` with cache headers and SPA fallback, then `vercel deploy --prebuilt --prod`). Confirm the live site shows the new build.
- Why custom: Vercel cannot build remotely because the app imports `../content`, `../shared`, `../scoring`, and `vercel build` fails on Windows without symlink rights.
- New machine: `npx vercel login`, then `npx vercel link --yes --project greenline` from `app/`.
- Before sharing a build: the link opens in incognito, `sw.js` precaches `assets/fields/<demo id>-*.js`, and the deploy output contains no `.env` values.
- Recommend the user enables two-factor on Vercel.
- **Restore:** "Restore main to `v1.0-checkpoint` (or the newest tag) and redeploy."

### 4.2 Accounts and keys
- Earth Engine project: `skillful-cider-490516-f6` (Community tier, noncommercial).
- USDA NASS Quick Stats key: lives only in the gitignored `.env`. **Never print it into chat, docs, or commits.** (It was shared in the planning chat once; if there is any doubt about exposure, advise regenerating it.)

---

## 5. Data and validation

**In use:** Landsat 5/7/8/9 (NDVI, 30 m), Cropland Data Layer (crop history), NASA POWER (weather 1984–2025), SMAP (soil moisture 2015–2025), GPM IMERG (rain, storm days), SRTM (slope), SSURGO (K, T, water storage, capability class), PRISM (4 km check, frost dates), NASS Quick Stats (county yields 2021–2025, Texas prices), USDA AMS fertilizer price, NASS Crop Progress (date check).
**Rejected:** MODIS ET (leakage).
**Possible additions:** NLDAS/GLDAS (needs model 2 retrain), CoCoRaHS, HLS/Sentinel-2, ECOSTRESS, GRACE, NLCD.

**Rain vs PRISM (201 fields, 2008–2024):** POWER r = 0.92 (about 9 % too dry), IMERG r = 0.93 (about 4 % too wet); averages PRISM 40.3 in, POWER 36.8 in, IMERG 41.9 in; heavy-rain days IMERG 12.7 vs PRISM 12.4 a year; all three name **2011 driest**, 2015 wettest. Frost-free season PRISM 254 vs POWER 257 days (r = 0.68). PRISM is not independent of the others, so it adds no confidence points (see `docs/data-validation.md`).

**Landsat sensor finding (key credibility story):** Landsat 7 reads NDVI about 0.05 lower than Landsat 8, and the two were mixed until about 2022, which overstated bare days by about a third. Fix: bare days and cover use **Landsat 8/9 only (2014+)**; pre-2013 is shown muted with a "Low confidence: older satellite" tag and is never averaged or scored. Median bare days across fields 91 → 55; nt-103 114 → 78. A published correction (Roy et al. 2016) was **tested and rejected** (failed 2 of 3 pre-set checks, impossible results such as 0 bare days for cotton, slightly lowered model 1). That is branch `landsat-harmonize`, intentionally unmerged (`MODELS.md` #14). **Ignore GitHub's "Compare & pull request" banner for it. Do not merge it.**

**Residue:** not measurable on Blackland clay (NDTI tracks clay), so the UI says "partly covered" (`MODELS.md` #7).

**Bare-day rule:** green = NDVI ≥ 0.40, bare < 0.25, partly covered in between. Per-crop calendars on the Landsat 8/9 level: corn 94, wheat 60, cotton 54, sorghum 60 bare days a year (measured). Estimated crops rescaled with new = old^1.6 (fitted on 48 month pairs, error 0.04/month): sunflower 87, sesame 85, alfalfa 16, fallow 244. Cover crops multiply the cash crop's month and count as half established in drought replays. Built by `scoring/tools/build_calendars.mjs` from `shared/crop-calendars-l89.json`.

---

## 6. The AI models and their real numbers

Validation for all models: **leave-one-year-out** (each year predicted by a model that never saw it); no random splits; no tuning on test years; report balanced accuracy and baselines. Data: 201 fields × 18 years = 3,618 field-years. Code in `/pipeline/models/` (`season_crop.py`, `veg_stress.py`, `year_patterns.py`, `export_si.py`); documentation in `/pipeline/MODELS.md`.

**Model 1: crop and season detector (gradient boosting, chosen)**

| Approach | Accuracy | Balanced | Macro F1 |
|---|---|---|---|
| Gradient boosting | 77.3 % | 54.3 % | 56.7 % |
| Random forest | 76.8 % | 51.9 % | 53.1 % |
| Baseline: same as last year | 34.4 % | 30.2 % | 24.9 % |
| Baseline: always corn | 35.5 % | 12.5 % | 6.5 % |

Per-crop recall / precision: wheat 94/86, corn 88/82, cotton 80/68, sorghum 45/51, other 45/66, fallow 43/58, soybeans 21/47, small grains 19/49. By year: 67 % (2010) to 86 % (2017); 2011 = 75 %. SHAP: spring vs summer greenness, June bare soil and greenness, March greenness. Checked against NASS dates: corn green-up 2 days from "50 % emerged" (91 % within 30 days). Double crops: 17 field-years, too few to model.

**Model 2: vegetation stress, shown only as a low-confidence "weather risk signal"**
Gradient boosting R² 0.039, balanced accuracy 56 %, AUC 0.62 (baseline R² 0, 50 %). A second version with lags: R² 0.047 (did not help; tuning stopped on purpose). Shown only where it beats the baseline (corn, wheat, small grains, soybeans, cotton barely); not for sorghum or fallow. Drivers: rain over past 2 months, SMAP soil moisture, rain this month, high temperature. Weak because of management, harvest timing, CDL label errors, coarse weather, 11 seasons of SMAP.

**Model 3: year types (k-means, 42 years)**
Held-out stability 97.6 %; agreement with a percentile rule 64.3 %; clusters normal 13, heat 11, drought 9, wet 9. Drought years: 1984, 1988, 1998, 1999, 2005, 2006, **2011**, 2022, 2023.

**Swapping models (a teammate may do this):** work on his own laptop on branch `models-v2`, use only the repo's data (no re-download), first reproduce the numbers above, then compare fairly with the same leave-one-year-out splits, balanced accuracy and per-crop scores. Only if clearly better, keep the same output format, run `export_si.py` then `build_fields.py`, update `MODELS.md`. He edits only `/pipeline/models`, `/shared/si`, `/shared/fields`, `MODELS.md`. The user merges and redeploys, then **updates the pitch numbers**. Training locally is fine (Earth Engine does the heavy lifting; data is about 7.2 MB).

---

## 7. Scoring and economics details

- One function scores current, suggested and custom rotations: `scoreRotation(rotation, field, priorities, constraints, cropLibrary)`. Rules return **i18n keys and params**, never English text. Reasons carry `tone` (up/down/note) and `src` dataset names for receipts, with `sources[].scale` (your field vs regional vs national).
- **Replay/what-if:** `scoring/rules/replay.js` (`hazardsFromRow`, `whatIfHazards`, `replayRule`). Scenario totals only **subtract** from the normal total (an earlier bug let a weak rotation score higher in a drought; fixed). A 0/0 what-if equals the normal total. A scenario score clamped to 0 shows "Struggles badly" with a "settings max out the stress" note.
- **Rules tuned:** erosion uses SSURGO K × slope ≥ 0.5; erosion thresholds 60 free bare days, 1 point per 60; water scales the thirsty-crop drought penalty by soil water (< 10 cm × 1.25, ≥ 15 cm × 0.75).
- **Tags:** `droughtTolerant` (all crops `droughtSensitivity` ≤ 2); `pestBreak` (grass + non-grass, no same `family` back-to-back, looping; cover crops and fallow skipped).
- **Confidence:** estimated crop traits cost a point; resolution is read from `field.sources`; `topReasons()` shows one lowering and one adding reason on the card face.
- **Dollars are display only and never change totals** (selftest checks it). Gross revenue per acre from the field's real NASS `market.recent[]` (2021–2025), labeled "gross revenue, before costs, not profit". Fertilizer value = `nFixLbPerAcre` × N price × 50 %. N price **$0.60/lb N** from the USDA AMS Illinois Production Cost Report (Nov 13, 2026; anhydrous 82 % N, $981.11/ton ÷ 1,640 lb N), labeled "national estimate, not Texas" (NASS has no Texas fertilizer price). No price slider.
- **Crop traits** were verified against FAO (seasonal water, rooting depth, drought sensitivity), SARE (N fixed, cover crops), NRCS (cowpea), Texas A&M AgriLife (sesame). Cowpea 100–150 lb N/acre, hairy vetch 90–200. Water use split into `seasonalWaterMm` and `droughtSensitivity` (FAO's seasonal total puts corn below cotton). Sesame is contract-only in Texas and uncommon in the Blackland Prairie, so its cards carry a warning. Texas Tech: cereal rye was the best winter cover in drought-stricken West Texas; late kill can dry the soil (risk line). Still unverified: hairy vetch values and some heat, forage and erosion scores. Everything remains `"verified": false` until an AgriLife/NRCS person reviews. Sources in `docs/crop-traits-verification.md` and `-2.md`.

---

## 8. Pitch numbers (nt-103, Ellis County, dryland, goals water + soil)

| Rotation | Bare days/yr | Normal score | 2011 drought | Verdict |
|---|---|---|---|---|
| Current: cotton → corn | ~87 | 18 | 0 | Struggles badly |
| **Option A: wheat, cowpea, sorghum, rye** | **~19** | **80** | 67 | Under strain |
| Option B: wheat, sorghum-sudan, rye, sorghum | **not yet read off the app** | 76 | 63 | Under strain |

Field: about 78 bare days a year; 2011 rain 24 in (−36 %); soil holds 6.3 in; PRISM frost about Feb 19 and Nov 24. Cowpea adds about $15–23/acre/yr N value. Ellis County gross revenue: corn about $451, cotton about $444 per acre (before costs).
**Do not quote nt-103's 2024 alone.** **Option B's bare-day figure must be read from the live app before it appears in any pitch.**

One-liner: "Our model names the crop correctly 77 % of the time in years it has never seen, more than double the 34 % from guessing last year's crop, and we tell farmers exactly where it's weak."
Validity story: "We caught a satellite sensor mismatch that would have overstated bare soil by about a third, tested a published fix, and rejected it when it failed our pre-set checks."

---

## 9. Honest limits (state these if a judge asks; never hide them)

1. Model 1 learns CDL's own mistakes (CDL is the label).
2. Corn and wheat are 68 % of the data, so rare crops are recalled under 50 %.
3. Double crops are not modeled.
4. Model 2 is weak (R² under 0.05) and shown only as a low-confidence signal.
5. The same 201 fields appear in training and testing in different years, so models are tested on new weather, not new places.
6. Monthly images mean dates are good to about ±15 days.
7. Weather data is coarse (POWER about 50 km).
8. Crop traits are not yet verified by a local expert.
9. Residue is not detectable on these soils.
10. The map loads the nearest of 201 sampled fields, not every 30 m cell.

---

## 10. Current state and history

Done and merged into `main` (tag `v1.0-checkpoint`, Nov 14 2026): Phases 0, 1, 2a, 2b, the Landsat 8/9 switch, Phase 4 (full Spanish pass, polish, visual checks in Chrome at 375/768/1280 px en + es along the demo path with no overflow, text under 12 px, or console errors). After the tag, a **map fix** landed on `main` (commit 59d7504 or later): green dots for the 201 fields, a cropland-mask warning (`pipeline/build_cropland_mask.py`), no silent fake-data fallback on the live site (reload once, then a "Try again" button; fake `sample-field.json` is dev-only), and a "Try again" on failed loads.

Past bugs worth remembering: Landsat 7/8 mismatch (above); replay scoring bug (above); garbled °, ×, ≥ characters from a Terminal B edit (a check now catches it); `vercel build` failing on Windows (custom packaging script); a "same as last year" vs "always corn" baseline label mix-up (fixed before commit); silent fake-sample fallback on the live site (fixed).

Branch notes: `main` contains `app-build`, `datasets`, `landsat89-cover` (and older `connect-data`, `data-pipeline`, `si-models`, `ui-polish`). `landsat-harmonize` stays unmerged on purpose. The `datasets` worktree `Greenline-data` currently has `main` checked out.

---

## 11. What is left (in order)

1. **Tag the current `main` as `v1.1-checkpoint`** with a short message, push the tag, update "Build status" in `CLAUDE.md`, and confirm the live site matches `main`. (Suggested to the user; not confirmed done. Check `git tag` and `git log` first.)
2. **Phone test of the live site** by the user: close and reopen the installed app to get the new version; check green dots, cropland warning, Use my location, Spanish, install, offline.
3. **Optional before the freeze:**
   - `ui-polish-2` (Terminal A; only `/app` and text files; the user supplies specific feedback and screenshots; keep tap targets ≥ 44 px, keep en/es keys in sync, run `npm run i18n` and `npm run selftest`).
   - `models-v2` (a teammate; section 6).
   - Optional: bigger dot tap area when zoomed in; verify crop traits with an AgriLife/NRCS/extension contact.
4. **Freeze time**, then merge (models first, then UI), then `cd app && npm run deploy`, then verify the live link in incognito.
5. **Submission prep (Step 5 prompt):** final checks (no secrets anywhere, EN/ES complete, live link works), then write `README.md`, `SUBMISSION.md` (the text to paste into each field of the Space Apps page: name, high-level summary, detailed description, NASA data list, other data, AI-use disclosure), and `PITCH-NOTES.md` with a **30-second video script** and answers to likely judge questions (use section 9).
6. **Lock the demo field** (nt-103 unless the farmers market gave a better match) via `DEFAULT_DEMO_FIELD_ID`; read Option B bare days off the live app.
7. **Record the 30-second video with English subtitles**, upload publicly (YouTube/Drive). No recognizable minors, adult consent, no NASA logo, AI-generated visuals watermarked. Over 30 seconds = ineligible for Global Judging.
8. **Fill in the Space Apps page** from `SUBMISSION.md`; include demo link and live link. Remember "Save Progress" makes it public.
9. **Test every link in incognito.**
10. **Click "Submit for Judging" before the local deadline** (confirm the exact time and time zone with the Local Lead first).

AI-use disclosure to include in the submission (accurate as of now): Claude Code was used to write the app code and pipeline code under the team's direction; Claude was used for research and planning; the trained models are standard scikit-learn models (gradient boosting, random forest, k-means) trained by the team on public data; no AI-generated imagery is in the app (confirm before submitting).

---

## 12. Guardrails for you, Claude Code

- Do not invent data, numbers, or sources. If a number is not in the repo or this file, find it in the app or the files and cite where.
- Do not change the pitch numbers silently. If a rule or data change moves a score, say which numbers moved and update `PITCH-NOTES.md`.
- Do not merge `landsat-harmonize`. Do not run `vercel git connect`. Do not commit `.env`.
- Do not deploy unless the user asks ("redeploy to Vercel"); after a deploy, confirm the live site shows the new build.
- Do not weaken honesty wording (low confidence tags, "hypothetical, not a forecast", "gross revenue, not profit", "national estimate, not Texas", "estimated" calendars) to make the demo look better.
- Keep the product principle visible: it supports farmer judgment and local experts, it does not replace them.
- If the user asks for something that would put the 30-second video, the submission rules, or the deadline at risk, say so plainly first.
