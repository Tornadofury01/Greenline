# Greenline award plan: Local Impact + Best Use of Data

Decided Nov 14, 2026. Read with `CLAUDE.md`, `docs/HANDOFF.md`. Award definitions (official Judging & Awards Guide):
- **Local Impact:** "the greatest potential for making a difference in their local community."
- **Best Use of Data:** "best makes space data accessible or leverages it to a unique application."

One story serves both: **Greenline makes NASA satellite data usable for North Texas farmers, from one field up to the whole county, and shows how far each number can be trusted.**

Deadline: Sunday Nov 15, 11:59 p.m. US Central (Dallas). Aim to submit by early evening.

---

## Part A. The county map (main new feature, serves both awards)

### A1. Design rules (keep it simple for farmers)
- **Opens the same as today:** "Find your field." The new views are optional and never block picking a field.
- **Views are farmer questions, not data terms.** Shown as 4 large chips (at least 44 px tall) above the map; one active at a time:
  1. **Where does soil sit bare?** (default new view)
  2. **Where could soil wash away?**
  3. **Who got hit hardest in 2011?**
  4. **What's growing where?** (AI)
- **Three colors per view:** low / medium / high, colorblind-safe (blue → yellow → dark orange, never red/green alone), each with a second cue (dot size or ring). Fixed legend card at the bottom with one plain sentence: e.g. "Orange fields sat bare more than 3 months a year."
- **Plain units:** "about 2½ months bare a year", not "78 days" alone; "2011 rain was 36% below normal".
- **Tap a dot → small card:** one-line answer for this view + "Open this field" button + a receipt line ("Landsat 8/9, 30 m, measured on this field").
- **Honesty line, always visible:** "201 sampled fields, not every acre." No owner names; dots are sampled cropland points, not farms.
- **Start zoomed to Ellis County**, with a "Show all North Texas" button.
- English and Spanish for every label; works on a 375 px phone.

### A2. What each view shows (all data already in the field files; no retraining)
| View | Value per field | Source | Note |
|---|---|---|---|
| Bare soil | Measured bare days per year, average 2014+ | Landsat 8/9 (`*L89` keys), same rule as `bareRows()` | Never use pre-2013 years |
| Wash-away risk | SSURGO K × slope × bare days → low/med/high | SSURGO, SRTM, Landsat 8/9 | Label it an index, not tons of soil |
| 2011 hit | 2011 rain vs the field's normal + soil water stored | IMERG/POWER, SSURGO | Same numbers the replay uses |
| What's growing (AI) | Model 1's detected crop for the latest year + confidence | Model 1 (`/shared/si`) | Low-confidence dots shown hollow; link to "How we know: held-out accuracy" |

Precompute everything with one small Node script into one file (e.g. `/shared/county-layers.json`) so the map doesn't load 201 field files.

### A3. "Where to start" list (the extension-agent view; strongest Local Impact piece)
- A button under the map: **"Where would a cover crop help most?"** It lists the top 10 sampled fields where high bare days and high wash-away risk overlap, each with "Open this field."
- A one-line explanation of the ranking rule, shown on screen.
- This is the same move past Local Impact winners made: QUEÑARIS found the best places to replant; the 2023 winner ranked local areas to protect first.

### A4. "Your field vs. the county" (small, very farmer-friendly)
- On Field story: "Your field sat bare longer than 64% of sampled fields nearby." (percentile from the same precomputed file).

### A5. Download the data (makes space data accessible, on-definition for Best Use of Data)
- A "Download county data (CSV)" link for agents and researchers: field id, county, bare days, risk level, 2011 hit, AI crop + confidence, and the sources. No farm locations beyond the sampled point already on the map.

### A6. Optional, only if everything above is done
- **Replay 2011 across the county:** recolor dots by how much a rotation with a winter cover crop would have softened the 2011 hit, using the existing scoring. Label "estimate." Skip if time is short.

---

## Part B. The data trust features (Best Use of Data)

### B1. "How sharp is each dataset" panel
- **What it is:** a small interactive picture on How we know (and linked from the receipts). Buttons for each dataset. Each shows one field next to one measurement ("pixel") of that dataset, with one sentence.
- **Why it matters:** the challenge asks teams to combine data of different sizes. Farmers (and judges) can't tell that the rain number is a regional average while the bare-soil number is measured on their own field. This makes the existing "measured on your field / regional value" receipts visual.
- **Content** (read the real resolutions from `field.sources`; don't hardcode if they differ):
  - Landsat 8/9, 30 m: about 170 pixels cover a 40-acre field. Measured on your field.
  - SSURGO soil: mapped at roughly field scale.
  - PRISM, 4 km: about 100 fields per box. Used to check the others.
  - SMAP (check 9 vs 36 km), IMERG about 10 km, POWER about 50 km: regional values.
- **Bottom line on the panel:** "We checked the coarse rain data against PRISM's 4 km ground-based estimates: they agree at 0.92–0.93."
- **Drawing:** keep the box size fixed and shrink the field as you step to coarser data (the field becomes a dot at 50 km). One tap per dataset; no zoom gestures needed.

### B2. "How we checked" card (validation made visible)
- Three facts with one small chart each, from `docs/data-validation.md` and `MODELS.md`:
  1. Satellite rain vs PRISM ground-based estimates: r 0.92 / 0.93; all three call 2011 the driest year.
  2. AI green-up dates vs USDA "50% emerged" reports: corn within 2 days on average.
  3. The Landsat 7 vs 8 mismatch we caught, the published fix we tested and rejected, and why pre-2013 is marked low confidence.
- These already exist as numbers; this just puts them on screen in plain words.

### B3. Keep the existing strengths visible
- Evidence receipts on every reason; confidence with up/down reasons; AI accuracy vs baselines.
- **Do not retrain the models for the submission.** Exception: a `models-v2` that is already finished and clearly better under the same leave-one-year-out test.

---

## Part C. Local Impact pieces

1. **Farmer voices section:** "What North Texas farmers told us." 3–5 short clips (10–20 s) from the farmers market, YouTube embeds loaded only when tapped. Each card: first name or "a local farmer", county, one quote, and a link to the feature it relates to (bare soil → map/bare days; 2011 → replay; "I'd ask the county agent" → Expert handoff).
   - Not testimonials of the app working. If a farmer reacts to the app on camera, label it "first reaction."
   - Spoken consent on camera, including NASA's use; adults only, no minors in frame; no farm locations; English subtitles for Spanish.
2. **Landing line with local numbers:** Ellis County 2,563 farms and 203,455 cropland acres (2022 Census of Agriculture); 2011 drought cost Texas agriculture a record $7.62B (Texas AgriLife economists); cover crops on about 4% of Southern & Central Plains cropland (NRCS CEAP II, 2013–2016).
3. **Extension office next step:** share the live link and Expert handoff with the Ellis County AgriLife Extension office (Ag/NR agent Samuel Adams, Waxahachie, 972-825-5175). Say only what is true ("shared on Nov 15").
4. **Spanish:** already complete; mention it.

---

## Part D. Submission framing

- **Project name:** "Greenline: NASA satellite data for North Texas crop rotations"
- **Summary, first sentence:** the place and the problem. Second: what it does. Third: "makes NASA data usable" (Best Use of Data wording).
- **Detailed description order:**
  1. Problem in Ellis County (sourced numbers).
  2. What farmers told us.
  3. What the app does, with the nt-103 before/after and 2011 replay.
  4. The county map and "where to start" list.
  5. Data and how we checked it (B1, B2, the sensor catch).
  6. Honest limits.
  7. Next step with the extension office.
  8. Tools used.
- **Screenshots/GIFs on the page:** map with a view on, a field story, the replay, the resolution panel, a farmer clip card.
- **Video (30 s, English subtitles), official timeline:**
  - 0:00 names
  - 0:02 problem ("In 2011, drought cost Texas farms $7.62 billion")
  - 0:05 title and tagline
  - 0:10 a farmer clip (3 s), then phone: county map → tap a field → bare months → replay 2011
  - 0:20 one data line ("7 NASA datasets, each checked and labeled for how sharp it is")
  - 0:25 next step with the extension office

---

## Build order
1. Tag `v1.1-checkpoint` and redeploy (safety point).
2. A1–A3 county map + "where to start" (Terminal A, plan mode).
3. B1 resolution panel, then B2 "how we checked" card.
4. A4 percentile, A5 CSV download.
5. Farmers market → C1 farmer section.
6. Freeze, redeploy, incognito check, video, project page, submit.
- A6 only if everything else is done.
- After each step: `npm run selftest`, `npm run i18n`, screenshots at 375 px, and a redeploy so the live site is always submittable.

## Claude Code prompts

**Map (plan mode):**
> Read docs/award-plan.md Part A. Plan first, don't code yet. Build the county map views (A1–A3): a Node script that precomputes per-field values into one JSON in /shared, farmer-question chips, a 3-level colorblind-safe palette with a second cue, a legend sentence, tap cards with receipts, the "201 sampled fields" note, default zoom to Ellis County, and the "Where would a cover crop help most?" top-10 list. Landsat 8/9 keys only for bare days. Don't change scoring. All text in en.json and es.json, tap targets ≥ 44 px. List the data fields you'll use and flag anything missing before building. After: npm run selftest, npm run i18n, screenshots at 375 and 1280 px.

**Data panels:**
> Read docs/award-plan.md Part B. Build B1 (How sharp is each dataset: fixed pixel box, the field shrinks as you step to coarser data, one sentence per dataset, resolutions read from field.sources) and B2 (How we checked: three facts with small charts from docs/data-validation.md and MODELS.md). Plain language, en.json and es.json, 375 px friendly. Show me before deploying.

**Small additions:**
> Read docs/award-plan.md A4 and A5. Add the "your field vs the county" percentile line to Field story and a "Download county data (CSV)" link using the precomputed county file. en/es text. Run selftest and i18n.

**Farmer voices (after the market):**
> Read docs/award-plan.md Part C1. Add the "What North Texas farmers told us" section with these clips and quotes: [paste]. YouTube embeds loaded only on tap, links to the related features, en/es text, no locations. Show me before deploying.
