# Greenline: Space Apps project page draft

Copy each section into the matching field on the Project tab (Edit → fill in → Save Progress → Submit for Judging).
Everything must be in English. **Replace every [bracket] with a real value from the live app or your notes, or delete that line.** Don't submit anything you can't back up.

Deadline: **Sunday Nov 15, 11:59 p.m. Central.** Aim for 8 p.m. "Save Progress" makes the page public.

---

## 1. Project name
Greenline: NASA satellite data for North Texas crop rotations

## 2. High-level summary (required; aim for 150–200 words)
In 2011, drought cost Texas agriculture a record $7.62 billion, and on the Blackland Prairie clays of Ellis County, fields left bare after harvest crack in drought and wash away in storms. Greenline is a free, bilingual (English/Spanish) phone app that helps North Texas farmers compare crop rotations using NASA Earth observations, USDA soil and crop data, and their own priorities.

A farmer picks one of 300 real Ellis County field outlines, enters what they grow, and sees what satellites recorded on that field: green, partly covered and bare months since 2014, drought years, and soil facts. Greenline then compares their current rotation with at least two alternatives and shows, for each, why it was suggested, the evidence (with the dataset behind every number), benefits, information gaps and risks to review with a local expert. Farmers can replay the 2011 drought on their own field, test "what if" rain and heat scenarios, and print a page for their county extension agent.

Greenline makes NASA data usable and honest: every number shows its source, how sharp the data is, and how confident we are. It supports farmer judgment and local experts. It doesn't replace them.

## 3. Link to project demo (required)
[YouTube or Google Drive link to the 30-second video with English subtitles. Public, no login. Test in incognito.]

## 4. Link to final project
https://greenline-psi.vercel.app
(Optionally add the GitHub repo: https://github.com/Tornadofury01/Greenline)

## 5. Detailed project description

### The problem in Ellis County
Ellis County, just south of Dallas, has 2,563 farms and 203,455 acres of cropland (2022 Census of Agriculture): mostly corn, wheat, cotton, sorghum and hay on Houston Black clay. These soils crack when dry and seal and run off in heavy rain, so months of bare soil after harvest mean erosion and lost water. Cover crops and diverse rotations help, but only about 4% of cropland in the Southern and Central Plains used cover crops (NRCS CEAP, 2013–2016). Farmers have to weigh water use, drought risk, markets and equipment, and generic advice doesn't show what would happen on *their* field.

### What farmers told us
[2–4 sentences: who you talked to (first name or "a cotton and wheat farmer in Ellis County"; N people at the X farmers market), 1–2 quotes, and **what you changed because of their feedback**. Delete this section if it didn't happen. Never invent quotes.]

### What Greenline does
1. **Pick your field** on a satellite map of 300 USDA field outlines in Ellis County, by tapping it or using your location (never stored or sent).
2. **Tell it about your farm:** current rotation, priorities (water, erosion, soil health, income, cattle) and limits (dryland or irrigated, equipment, budget, market).
3. **See your field's story:** months it was green, partly covered or bare since 2014 (Landsat 8/9), the crop detected each year, drought/hot/normal/wet years since 1985, soil facts (erodibility, water held in the top meter, land capability class) and frost dates.
4. **Compare rotations:** your current rotation vs. at least two suggestions and any rotation you build. For each: a score for your priorities, bare days a year, why it was suggested, evidence with dataset receipts, benefits, gaps, risks needing expert review, confidence (with the reasons it goes up or down), tags (nitrogen-fixing, cover crop, drought-tolerant, pest-cycle break) and gross revenue estimates from USDA county yields.
5. **Replay a bad year:** re-score every rotation under the real weather of 2011 or 2000 on your field, or try "what if" rain and heat. Clearly labeled hypothetical, not a forecast.
6. **Farm simulator (a game):** split your field into 4 plots, try a different plan on each, and play 5 seasons of real past weather to see which plot holds up. Free play or three challenges (Survive 2011, Keep the soil, Beat your current rotation). Replays the past, not a forecast. [Before submitting: the game still runs on mock numbers until the engine is wired in `game/runSource.js`; describe it as a preview or wire it first.]
7. **Take it to an expert:** a printable page for the county extension agent with the evidence, confidence and questions to ask.
8. **How we know:** plain-language explanations of NDVI, evapotranspiration, soil moisture, bare days, confidence and why each dataset is as sharp (or coarse) as it is.
[Add one line per feature the team actually ships tonight, e.g. the county map views, "Where would a cover crop help most?", the help guide.]

**Example (demo field ec-251, 100 acres of Houston Black clay):** [current rotation] scores [X] with about [N] bare days a year; [Option A] scores [Y] with about [M]. In a 2011 replay, [current] falls to "[verdict]" while [Option A] is "[verdict]". *(Read these from the live app.)*

### How it works
- **Ahead of time:** NASA and USDA data are processed in Google Earth Engine and Python into one small data file per field.
- **Three AI models, tested only on years they never saw** (trained before 2023, tested on 2023–2025):
  - **Crop and season detector** (gradient boosting on 40 years of Landsat greenness curves): correct 83% of the time on all fields vs. 58% for "same crop as last year"; 92% on fields with a clear USDA label. It is weakest on cotton and can't detect fallow yet, and the app shows its confidence.
  - **Vegetation stress model** (NASA weather, SMAP soil moisture, IMERG rain, MODIS): flags browner-than-normal months with AUC 0.94 on unseen years. Most of its skill comes from recent greenness; the app says so.
  - **Year types** (k-means on 40 seasons of NASA POWER weather): sorts years into drought, hot, normal and wet for the bad-year replay.
- **Transparent rules compare rotations.** Scores come from published agronomy and crop traits (FAO, SARE, NRCS, Texas A&M AgriLife), one small rule at a time, so every point has a reason a farmer and an agent can check. The AI reads the field; the rules compare rotations; the farmer decides.
- **The app runs on the phone:** no account, works offline after the first visit, English and Spanish.

### How we checked the data
- NASA POWER and GPM IMERG rainfall agree with PRISM ground-station-based estimates (r = 0.92 and 0.93 across 201 North Texas sample points, 2008–2024); all three name 2011 the driest year.
- The crop detector's green-up dates match USDA crop progress reports (corn within about 2 days).
- We found that Landsat 7 reads greenness lower than Landsat 8, which overstated bare soil by about a third. We tested a published correction, rejected it when it failed our pre-set checks, and now use Landsat 8/9 only for bare days, with older years shown as low confidence.

### Honest limits
The crop detector can't find fallow yet and is less sure about cotton. Whole-field averages may undercount bare soil [delete if the field-interior fix landed]. Weather is one series for the county; what differs field to field is soil, slope and ground cover. Models are tested on the same fields in new years, not new places. Crop trait values still need review by Texas A&M AgriLife or NRCS. Dollar figures are gross revenue, not profit.

### What we hope to achieve
A tool a farmer and their county extension agent can use together at the kitchen table. Next steps: [we shared Greenline with the Ellis County AgriLife Extension office on Nov 15 — only if true], verify crop traits with AgriLife/NRCS, measure bare soil from field interiors, and expand county by county: USDA field outlines and Landsat cover the whole United States, so the same pipeline can run anywhere.

### Tools
React, Vite, Leaflet, Recharts and vite-plugin-pwa (app); Python, scikit-learn and Google Earth Engine (data and models); Vercel (hosting); GitHub.

## 6. Use of AI (SI) (not shown to judges, but required)
We used Claude (Anthropic) and Claude Code as AI coding assistants to write and debug the app and data pipeline code under our direction, to research crop traits and datasets (every value cited to its source), and to draft documentation. The idea, design decisions, validation choices and agronomy rules were ours. The project's own models (gradient boosting, k-means) are standard scikit-learn models we trained on public NASA and USDA data. No AI-generated images, video or audio are used [confirm], and no NASA branding is used.

## 7. NASA data (required for Global Awards)
- Landsat 5, 7, 8 and 9 surface reflectance (NASA/USGS): greenness (NDVI), bare and partly covered months, crop detection
- [Harmonized Landsat Sentinel-2 (HLS), NASA: confirm it's used]
- NASA POWER: daily weather 1985–2025 for year types, replay and stress model
- SMAP soil moisture: stress model
- GPM IMERG precipitation: rain and heavy-rain days
- MODIS evapotranspiration and land surface temperature: stress model
- SRTM elevation: slope for erosion risk
- NASA NEX-GDDP-CMIP6: climate scenarios in the Ellis County season study
- Google Earth Engine was used to access and process these datasets.

## 8. Space Agency partner data and other references
- [ESA Copernicus Sentinel-2, through HLS: only if HLS is used]
- USDA NASS Cropland Data Layer (crop labels 2008–2025) and USDA Crop Sequence Boundaries (field outlines)
- USDA NRCS SSURGO (soil erodibility, water storage, capability class); OpenLandMap soil
- PRISM Climate Group (rain check, frost dates)
- USDA NASS Quick Stats (county yields, Texas prices) and Crop Progress reports; USDA WASDE
- USDA AMS Illinois Production Cost Report (fertilizer price)
- USDA 2022 Census of Agriculture; NRCS CEAP; NRCS EQIP
- Crop traits: FAO Irrigation and Drainage Papers 33 and 56, SARE "Managing Cover Crops Profitably", NRCS plant guides, Texas A&M AgriLife Extension
- RUSLE (soil loss)
- Texas A&M AgriLife Extension economists (2011 drought losses)
- USGS National Map imagery (map tiles)
- Open-source code: React, Vite, Leaflet, Recharts, vite-plugin-pwa, scikit-learn, pandas, Lucide icons [add any others in package.json]

## 9. Images to add to the page (JPG/PNG/GIF up to 10 MB)
1. Satellite map with the field outlines
2. Field story (stripe timeline and big number)
3. Compare scoreboard
4. 2011 replay result
5. "How sharp is each dataset" panel or the How we checked card
6. Farmer test photo (hands and phone only, unless the adult agreed to show their face)

## Before you click "Submit for Judging"
- Every [bracket] is replaced or deleted
- Video is 30 seconds or less, has English subtitles, is public, and opens in incognito
- Live site opens in incognito on a phone
- No people under 18 in any photo or video; adults agreed to NASA's use of their likeness
- No NASA logo anywhere
- Both checkboxes ticked (Terms, original work)
- Click **Submit for Judging** and wait for the confirmation banner
