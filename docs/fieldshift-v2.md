# Field Shift v2: Complete Design Plan
Nov 14, 2026 · Pranav C

*(Saved from Pranav's design doc. The diagram "One engine turns a tapped field into a plan and a simulator" is described in text under "How it works end to end".)*

## Overview
Field Shift v2 lets a farmer tap any US field and get a crop rotation plan built for that field: what to plant, when, and why, with profit, soil, water, nutrients, pests and markets all weighed. It reads 40 years of NASA satellite and weather records for the field, learns how the field behaves, builds rotation options that fit it, tests each one through 40 real seasons and 2040 climate, and recommends the one that best matches the farmer's goals. Every answer says how sure it is and what to check with a local expert.

It also adds a farm simulator. The farmer starts from their farm as it is today, changes the choices (crops, planting dates, fertilizer, irrigation, cover crops, prices, weather), and watches profit, soil, water and nutrients change day by day and month by month.

### What changes from v1
| v1 (what we built) | v2 (this plan) |
|---|---|
| The trained models did not affect the recommendation | Every model feeds a specific step, or it is cut |
| One typical field for all of Ellis County | Every field gets its own answer from its own soil, slope, weather and history |
| 7 hand-picked rotations | Options built for each field from a crop library |
| Profit compared across a fixed list | Profit maximized over rotations and management choices, with risk limits |
| Water, disease and markets partly covered | Four fit checks on every option: water, disease, market, season |
| Ellis County only | Any US field, tested in several regions |
| Validation planned for later | Validation runs every time |
| No way to explore choices | Farm simulator, day by day and month by month |

### Design rules
- Every model output changes the recommendation, or it is cut.
- The unit is one field. No county averages.
- One simulation engine powers both the recommendation and the farm simulator, so they always agree.
- Every number comes with uncertainty and its source.
- The tool supports the farmer's judgment; it never replaces it.

## Terms explained
Every farming and science term used in this plan, in plain words.

### Crops and rotations
| Term | Plain meaning | Why it matters here |
|---|---|---|
| Crop rotation | The order of crops a field grows over the years, e.g. wheat one year, sorghum the next | The thing we recommend |
| Cash crop | A crop grown to sell (wheat, corn, sorghum, soybeans, cotton) | Earns the income |
| Cover crop | A crop grown to protect and feed the soil, not to sell (cowpea, clover, rye) | Fills bare periods; adds nitrogen; cuts erosion |
| Double crop | Two cash crops harvested from the same field in one year, e.g. wheat then soybeans | More income from the same land |
| Fallow / bare field | Land with nothing growing on it | Bare soil washes and blows away and loses organic matter |
| Crop residue | Stalks and leaves left on the field after harvest | Covers and protects the soil like a mulch |
| Tillage / no-till | Tillage = plowing or disking the soil; no-till = planting straight into the last crop's residue | No-till keeps residue on top and reduces erosion |
| Termination | Killing a cover crop (mowing, rolling or spraying) before planting the next crop | Timing decides how much water the cover uses |
| Crop family | Groups of related crops: grasses (wheat, corn, sorghum), legumes (soybeans, clover, cowpea), others (cotton) | Crops in the same family share pests and diseases |
| Legume | A plant (beans, peas, clover) whose roots host bacteria that pull nitrogen from the air | Free nitrogen fertilizer |
| Variety / maturity | The specific version of a crop; maturity = how many days it takes to finish | Must fit the season window |

### Growth and seasons
| Term | Plain meaning | Why it matters here |
|---|---|---|
| Growing season | The months a crop can grow, usually between the last spring frost and first fall frost | A crop must fit inside it |
| Growing degree days (GDD) | A running count of warmth: each day adds how far the average temperature is above a base, e.g. 10 °C | Predicts when crops come up, flower and mature better than calendar dates |
| Phenology | The timing of a crop's life stages | We measure it from satellites |
| Green-up, peak, senescence | When the crop turns green, when it is greenest, when it browns and dries down | Mark the start, middle and end of each crop |
| Yield | How much harvested crop one acre produces, e.g. 48 bushels per acre (bu/ac) | Drives revenue |
| Heat stress | Damage when it is too hot, especially during flowering | Cuts yield |
| Frost risk | Chance of a freeze after planting or before harvest | Can kill young or flowering crops |
| Drought | A period with too little water for crops | The biggest yield risk in Texas |

### Water
| Term | Plain meaning | Why it matters here |
|---|---|---|
| Evapotranspiration (ET) | Water leaving the field: evaporation from soil plus transpiration (water plants breathe out through their leaves) | How much water a crop uses |
| Reference ET (ET0) | How much water a standard grass would use given the day's sun, heat, wind and humidity | The starting point for any crop's water use |
| Crop coefficient (Kc) | A multiplier that turns reference ET into a specific crop's use at each stage | From FAO's published tables |
| Soil moisture | How much water is in the soil right now | Measured by SMAP; tracked by the simulator |
| Available water capacity | How much water the soil can hold for plants, like the size of a sponge | Clay holds more than sand |
| Water balance | Daily bookkeeping: water in (rain, irrigation) minus water out (ET, runoff, drainage) | The core of the simulator |
| Runoff | Rain that runs off the surface instead of soaking in | Carries soil away |
| Groundwater | Water stored underground in aquifers | Irrigation source; GRACE tracks its long-term trend |

### Soil and nutrients
| Term | Plain meaning | Why it matters here |
|---|---|---|
| Soil health | How well soil holds water, feeds plants and resists erosion | One of the farmer's main goals |
| Soil organic matter (SOM) | Decayed plant material in the soil, mostly carbon; usually 1–5% of the soil | Holds water and nutrients; rises with cover crops and residue, falls with bare soil and tillage |
| Soil erosion | Soil washed away by rain or blown by wind, measured in tons per acre per year | Lost topsoil does not come back in a lifetime |
| Soil loss tolerance (T) | The most erosion a soil can take each year without losing productivity; NRCS sets it at 1–5 tons/acre/year depending on the soil | Our limit for an acceptable rotation |
| RUSLE | The standard USDA formula for erosion: rain power × soil erodibility × slope × cover × practice | How we estimate soil loss |
| Erodibility | How easily a soil washes away | From the soil survey |
| Rain erosivity | How much eroding power the rain has; intense storms count most | From rainfall data |
| Nitrogen (N), phosphorus (P), potassium (K) | The three main plant nutrients; harvest removes them from the field | Must be replaced by fertilizer, legumes or manure |
| Nitrogen credit | Nitrogen a legume leaves behind for the next crop, so less fertilizer is bought | A big part of cover-crop profit |
| Leaching | Nutrients washed down below the roots by water | Wasted fertilizer; water pollution |
| Nutrient depletion | Soil losing nutrients faster than they are replaced | One of the brief's pressures |

### Pests and disease
| Term | Plain meaning | Why it matters here |
|---|---|---|
| Host | A crop a pest or disease can live on | Same host every year keeps the pest alive |
| Pest cycle | A pest or disease surviving and building up from one season to the next | Rotation breaks it |
| Green bridge | Plants (volunteers, weeds or covers) that keep a pest alive between crops | A wrong cover crop can create one |

### Money and programs
| Term | Plain meaning | Why it matters here |
|---|---|---|
| Variable costs | Costs that change with what you plant: seed, fertilizer, spraying, fuel, harvesting | Differ by rotation |
| Fixed costs | Costs that stay the same whatever you plant: land rent, machinery ownership | Same for every rotation |
| Return above variable costs | Revenue minus variable costs | The fair way to compare rotations |
| Cash rent | What a farmer pays per acre to rent land | A fixed cost |
| Local price / basis | The price a nearby buyer (grain elevator) actually pays, which differs from the national price | Market fit |
| Enterprise budget | Extension-published typical costs and yields for one crop in one region | Our default costs |
| NRCS / EQIP | USDA's Natural Resources Conservation Service and its program that pays farmers part of the cost of conservation practices | Possible extra income, not guaranteed |
| Extension agent | A local university expert who advises farmers (Texas A&M AgriLife in Texas) | The local expertise the tool points to |

### Data and models
| Term | Plain meaning | Why it matters here |
|---|---|---|
| NDVI | A satellite measure of greenness: how much living plant there is | Tracks crops over time |
| NDTI | A satellite measure of crop residue on the soil | Tells covered soil from bare soil |
| BSI | A satellite measure of bare soil | Tells bare soil from residue |
| Resolution | The size of one data cell (30 m for Landsat, 9 km for SMAP) and how often it is measured | Datasets must be matched before combining |
| Harmonize | Convert datasets of different sizes and schedules to one shared unit (field × day, field × month) | So they can be used together |
| Anomaly | How far a value is from its normal for that time of year | "Browner than normal for June" |
| Climate scenario (SSP2-4.5, SSP5-8.5) | Paths of future emissions: middle and high | Two versions of 2040 |
| Climate model ensemble | Several climate models run for the same scenario | Their spread shows uncertainty |
| Training / test data | Examples a model learns from / examples held back to check it | Honest accuracy |
| Calibration | Adjusting a model's settings until it matches real measurements | Makes simulated yields match real yields |
| Validation / backtest | Checking predictions against what really happened | Proves the tool works |
| Monte Carlo | Running the same calculation many times with random inputs to see the range of outcomes | How we measure confidence |
| Uncertainty / confidence | How wide the range of likely outcomes is | Shown on every result |
| Conformal prediction | A method that gives each prediction a range guaranteed to contain the true value a set share of the time, e.g. 90% | Honest ranges for Model B |

## The farmer's problem
The brief's core point: a crop that improves soil in one place can be wrong somewhere else, because it uses too much water, brings disease, has no market, or does not fit the season. So every option is judged on its benefits and on those four risks, for this field, under changing weather. The table maps each pressure in the brief to where the design handles it.

| Pressure | What it means for the farmer | How Field Shift handles it | Main data |
|---|---|---|---|
| Temperatures shifting | Hotter summers, milder winters, earlier springs | Warming trend from 40 years of data; 2040 projections; heat and frost checks in the simulator; season windows recalculated for 2040 | NASA POWER, Daymet, CMIP6 |
| Rainfall less predictable | Wetter and drier years swing further apart | Every option tested in every past season, including the worst; year-to-year rain variability now vs 2040; year types (Model C) | Daymet, GPM IMERG, CMIP6 |
| Water shortages | Less stored soil water; falling groundwater where farms irrigate | Daily water balance; water cost to the next crop; groundwater trend flag; irrigation as a simulator choice | SMAP, GRACE, ECOSTRESS |
| Soil health decline | Organic matter falling; soil holding less water | Soil organic matter tracked year by year in the simulator; bare days and residue | Landsat, HLS, soil survey |
| Erosion | Topsoil washed off by storms | Daily erosion from this field's soil and slope; compared with the soil's tolerance (T) | SSURGO, 3DEP/SRTM, IMERG |
| Nutrient depletion | Harvests remove N, P and K faster than they are replaced | Nitrogen balance (fixed, applied, taken up, leached); P and K removed per harvest | Crop library, extension rates |
| Extreme weather | Heat waves, flash droughts, downpours | Heat-wave days, heavy-rain days and drought years in the simulator; worst-10% results scored | Daymet, IMERG, Drought Monitor |
| New crop uses too much water | A cover crop can dry the soil before the next cash crop | Water fit check | Simulator, SMAP, ECOSTRESS |
| New crop brings disease | Shared hosts and green bridges keep pests alive | Disease fit check | Crop library host table, weather |
| No local market | Nobody nearby buys it, or the price is poor | Market fit check | NASS acreage, USDA market reports, farmer input |
| Outside the growing season | Does not fit between harvests, or frost and heat hit it | Season fit check | Model A dates, GDD, frost and heat risk |
| Profit | The farm must pay its bills | Profit maximized over rotations and management choices, with risk and soil limits | Budgets, prices, simulator |

## How it works end to end
Nine steps turn one tap on a map into a recommendation. Steps 1–3 learn about the field, steps 4–7 find the best plan for it, step 8 explains it, and step 9 checks the work. The farm simulator reuses steps 2, 3 and 6.

Diagram ("One engine turns a tapped field into a plan and a simulator"): 1. Farmer taps a field → 2. Field data cube (satellites, weather, soil, crop maps into field × day and field × month) → models A. Field history (crops, bare days, crop dates), B. Field response (heat and drought sensitivity, yields), C. Climate regimes (drought, wet years, today and 2040), D. Soil moisture (field-scale SMAP, optional) → 4. Build options (crop library to 10–30 rotations) → 5. Four fit checks (water, disease, market, season) → 6. Field simulator engine, daily (crop, water, nitrogen, soil carbon, erosion, pests, money) → 7. Optimize profit (planting date, N rate, within risk and soil limits), 8. Score and recommend (six scores, confidence, check-locally list), and the Farm simulator (farmer changes choices, day by day, month by month) → 9. Validate every run (vs measured bare days, NASS yields, erosion, neighbor fields). Models A–D feed both the option builder and the simulator engine; the same engine powers the recommendation and the farm simulator, and every run ends in validation.

1. **Pick the field.** The farmer taps a field. USDA's Crop Sequence Boundaries give its outline and crop history. Outside those outlines, the farmer draws it.
2. **Build the field data cube.** Every dataset is fetched for that outline and converted to one row per field per day and one row per field per month, each value labeled with its quality. (Section: Data.)
3. **Learn the field.** Trained models read the cube:
   - Model A, field history: what grew each year since 1985, which days were green, residue-covered or bare, crop dates, cover crops.
   - Model B, field response: how this field's crops react to heat and drought, tied to real yields.
   - Model C, climate regimes: this place's drought, hot, wet and normal years, today and in 2040.
   - Model D, soil moisture downscaling (optional): SMAP's 9 km moisture turned into this field's moisture.
4. **Build the options.** A crop library is screened for crops that can grow here, then fitted into the field's bare windows using basic rotation rules. Result: 10–30 rotation options plus the current one.
5. **Run the four fit checks.** Water, disease, market and season: pass, warn or fail, with the evidence.
6. **Simulate.** The field simulator runs every option day by day through all 40 past seasons and the 2040 climate, on this field's soil and slope, using Models A–C. It tracks crop growth, water, nitrogen, soil organic matter, erosion, pests, costs and revenue.
7. **Optimize profit.** For each option, the simulator tries management choices (planting date, nitrogen rate, cover termination date) and keeps the most profitable set that stays within the farmer's risk and soil limits.
8. **Score, explain and recommend.** Six scores, weighted by the farmer's priorities; 1,000 what-if runs for confidence; real neighbor fields as evidence; a list of things to check locally.
9. **Validate.** Simulated results are compared against measured bare days, real county yields, measured erosion and neighbor outcomes. The results go on a report card.

The key design choice is one simulation engine for everything. The recommendation, the bad-year replay and the farm simulator all call the same daily model, so a number in a rotation card always matches what the farmer sees when they open that rotation in the simulator.

## Data
We keep everything already exported and add twelve sources: per-field weather, field-scale soil, radar, plant water stress, field outlines, real yields, regional costs, markets and measured erosion. GEDI is dropped: it measures tree canopy in sparse footprints and adds little for crop fields.

### Satellite data
| Dataset | What it is | Resolution, years | Used for | Status |
|---|---|---|---|---|
| Landsat 5/7/8/9 | NASA/USGS satellite imagery; we compute NDVI, NDTI, BSI | 30 m, every 8–16 days, 1985 on | Model A history; Model B target | Have |
| HLS (Landsat + Sentinel-2) | Same indices, combined satellites, more frequent | 30 m, every 2–3 days, 2013 on | Model A, B | Have |
| HLS red-edge bands | Sentinel-2 colors sensitive to leaf chlorophyll | 20–30 m, 2015 on | Tells look-alike crops apart (corn vs sorghum) | Add |
| Sentinel-1 radar | Radar that sees through clouds; senses plant structure and wetness | 10 m, every 6–12 days, 2015 on | Field state on cloudy days; soil wetness | Add |
| MODIS | Daily NASA imagery: evapotranspiration, surface temperature | 500 m–1 km, 2000 on | Model B; fills Landsat cloud gaps | Have |
| ECOSTRESS | Plant temperature and water stress from the space station | 70 m, irregular, 2018 on | Independent water-stress check; water fit check | Add |
| SMAP | Soil moisture satellite | 9 km, daily, 2015 on | Starting soil moisture for the simulator; Model B; Model D | Have |
| GPM IMERG | Rainfall from satellites | 10 km, half-hourly, 2000 on | Storm intensity for erosion; Model B | Have |
| GRACE / GRACE-FO | Changes in total water stored underground | ~300 km, monthly, 2002 on | Long-term water trend flag | Add (export pending) |
| SRTM / USGS 3DEP | Elevation | 30 m / 10 m | Slope for erosion and runoff | Have SRTM; 3DEP optional |

### Weather and climate
| Dataset | What it is | Resolution, years | Used for | Status |
|---|---|---|---|---|
| Daymet V4 | NASA daily weather on a fine grid | 1 km, daily, 1980 on, US | Each field's own weather in the simulator | Add |
| NASA POWER | Daily weather incl. sunlight and wind | ~50 km, daily, 1981 on, global | Reference ET; backup outside the US | Have |
| NEX-GDDP-CMIP6 | NASA's downscaled climate projections | 25 km, daily, to 2100 | 2040 climate | Have |
| US Drought Monitor | Weekly drought ratings | County, 2000 on | Checks Model C | Add |

### Ground data and labels
| Dataset | What it is | Used for | Status |
|---|---|---|---|
| USDA Cropland Data Layer | Crop map of the US every year | Crop history 2008 on; Model A training labels | Have |
| USDA Crop Sequence Boundaries | Outlines of ~16 million US fields with 8-year crop sequences | Tap-to-select; neighbors for evidence and backtests | Add |
| gSSURGO soil survey | USDA's detailed soil map: texture, water holding, organic matter, erodibility, soil tolerance T | Simulator soil; erosion | Add |
| OpenLandMap soil | Global soil estimates | Backup outside the US | Have |
| NASS county yields and acreage | USDA's official yields and planted acres by county and year | Calibrate and check yields; market fit check | Add |
| USDA ERS costs and returns | Typical costs per acre by crop and region | Default costs nationwide | Add |
| Extension enterprise budgets | Local costs and yields (Texas A&M AgriLife) | Default costs in Texas | Have |
| USDA WASDE / AMS market reports | National price forecasts; local cash prices | Prices; market fit check | Have WASDE; add AMS |
| FAO ECOCROP | Growing limits for 2,500+ crops | Crop library | Add |
| FAO-56 and FAO-33 / AquaCrop tables | Published crop water use and drought sensitivity | Crop library; simulator | Have |
| USDA-ARS Riesel and LTAR sites | Decades of measured erosion and soil outcomes | Validation | Add |

### From the farmer (all optional; defaults are used if skipped)
- Their field outline, if it is not in USDA's outlines
- What they actually grow, if the crop map is wrong
- A soil test (organic matter, pH, P, K)
- Their prices, costs and buyers
- Irrigation: whether they have it, and how much water
- Equipment, e.g. a no-till drill
- Their priorities: income, soil, risk, water

### Harmonizing: one shared unit
The datasets come in very different sizes (10 m to 300 km) and schedules (half-hourly to monthly). Everything is converted to field × day for the simulator and field × month for the models.

| Kind of data | How it is converted |
|---|---|
| Fine grids (Landsat, HLS, radar, ECOSTRESS) | Average of the pixels inside the field, 45 m in from the edges so roads and grass borders don't mix in; count of clear views kept |
| Coarse grids (SMAP, IMERG, MODIS, Daymet) | Area-weighted average of the grid cells the field overlaps; number of fields sharing a cell kept |
| Very coarse (GRACE, CMIP6) | Value at the field's location; used for trends and changes, never for field differences |
| Irregular passes (ECOSTRESS, Landsat in cloudy months) | Monthly composites with observation counts; gaps marked as missing, never filled with zeros |
| Daily from sub-daily (IMERG) | Daily totals plus peak intensity, which matters for erosion |
| Soil polygons (SSURGO) | Area-weighted average of soil properties over the field |

Every value carries two labels: its native resolution and how many observations it is based on. Models can then trust a month with six clear Landsat views more than a month with one.

## Models to train
Four models are trained with machine learning, plus one calibration. Each is trained where real labels exist, compared against simpler methods, and feeds a named step. The simulator, fit checks and scoring are not trained: they use published agronomy so a farmer can see why each answer came out.

### Model A: field history
- **Question it answers:** What has this field been doing, day by day, since 1985?
- **Inputs:** NDVI, NDTI, BSI, red-edge and radar time series; soil; growing degree days.
- **Learns from:** USDA crop maps (2008 on) for crop type; clear-sky satellite days for field state.
- **Outputs:** each day's chance of being green, residue-covered or bare; crop each year with confidence; green-up, peak and harvest dates with a ± range; cover-crop detection.
- **Feeds:** the current rotation (step 4); real crop dates for the simulator (step 6); measured bare windows for building options (step 4); the current rotation's soil-cover score (step 8); the bare-days check (step 9).
- **Note:** USDA labels are used wherever they exist; the classifier only fills 1985–2007 and the current season.

### Model B: field response
- **Question:** How do this field's crops react to heat and drought?
- **Inputs:** weather, soil moisture, rain, ET, surface temperature, crop, soil, the field's condition last month.
- **Learns from:** thousands of fields across several regions: how far greenness fell below normal under each kind of stress. Greenness loss is then linked to yield loss using NASS county yields.
- **Outputs:** next 1–3 months' stress chance with a 90% range; each crop's drought and heat sensitivity on this field; the reasons behind each prediction (e.g. "June rain 60% below normal").
- **Feeds:** the simulator's yield response, replacing the textbook factor with this field's own (step 6); the stress calendar in the app.

### Model C: climate regimes
- **Question:** What kinds of years does this place get, and how will that change?
- **Inputs:** this location's yearly weather anomalies (rain, heat days, heavy-rain days, frost dates, water deficit) and area-wide greenness.
- **Learns from:** no labels (it finds groups); checked against the US Drought Monitor and NASS yields.
- **Outputs:** each past year's type with a probability; how often each type occurs in 2040.
- **Feeds:** the simulator's scenarios and how heavily each year counts in 2040 (step 6); "replay a bad year" presets.

### Model D: soil moisture downscaling (optional)
- **Question:** How wet is this field, not just its 9 km SMAP cell?
- **Inputs:** SMAP, terrain wetness, Landsat thermal, ECOSTRESS, radar, soil.
- **Learns from:** relationships between fine-scale data and SMAP over many cells.
- **Outputs:** daily field soil moisture.
- **Feeds:** the simulator's starting soil moisture (the farm's current state); the water fit check.

### Calibration E: yields
- **Question:** Do simulated yields match real ones?
- **Method:** adjust a few simulator settings per region (crop water productivity, heat thresholds) until simulated county yields track NASS yields year by year. Fit on early years; test on later years.
- **Feeds:** every profit number.

### Comparing methods
Each model is tested against simpler options, and the winner is used. That comparison is a slide for the judges.

| Task | Simple baseline | Statistical | Machine learning |
|---|---|---|---|
| A: crop type | Most common crop | Rules on curve shape | Gradient-boosted trees; 1D neural network on raw series |
| A: daily field state | Fixed NDVI/NDTI thresholds | Hidden Markov model (handles clouds) | Same, with radar added |
| B: stress | Last month's condition only | Logistic regression | Gradient-boosted trees, with SHAP explanations |
| C: year types | Fixed drought/wet rules | Gaussian mixture | k-means; hidden Markov model over years |
| Long-term trends | — | Mann-Kendall test with Sen's slope | — |
| D: soil moisture | SMAP cell value | Regression on terrain wetness | Random forest or gradient boosting |

Terms: gradient-boosted trees combine many small decision rules; hidden Markov model guesses a hidden state (green/residue/bare) from noisy observations, using what came before and after; SHAP shows how much each input pushed a prediction up or down; Mann-Kendall tests whether a trend is real or noise.

### How each model is tested
- Held-out years: train on 1985–2019, test once on 2020–2025.
- Held-out regions: train on some counties, test on counties the model never saw.
- Grouped cross-validation: splits by year or county, so the model is never tested on data from the same year it learned from.

## Building rotation options and the four fit checks
Options are built for each field, not picked from a fixed list, and each one must pass four fit checks before it is scored.

### The crop library
One record per crop, starting with the 25–30 most common US cash and cover crops, then extended from FAO ECOCROP.

| Field in the record | Example (cowpea) | Source |
|---|---|---|
| Kind and family | Cover or cash; legume | Agronomy references |
| Temperature limits | Grows 20–35 °C; killed by frost | ECOCROP |
| Season length | GDD or days to maturity | Extension guides |
| Planting window | Earliest and latest planting by region | Extension guides |
| Water use by stage (Kc) and drought sensitivity | FAO table values | FAO-56, FAO-33, AquaCrop |
| Ground cover by stage | For erosion | RUSLE tables |
| Nitrogen fixed; N, P, K removed per unit of yield | e.g. lb per bushel | Extension rates |
| Residue left and its carbon | For soil organic matter | Agronomy references |
| Pests and diseases it hosts, and which crops break them | Host table | Extension pest guides |
| Market type | Sold (needs a buyer) or not sold (cover) | — |
| Default cost and price | Per acre / per bushel | ERS, budgets, WASDE |

### The option generator
1. **Screen crops.** Keep only crops whose temperature, frost and water limits fit this location today, and flag those that stop fitting by 2040.
2. **Find the gaps.** From Model A, the months this field sits bare in its current rotation.
3. **Fill the gaps.** Try fitting crops into those windows, e.g. a summer cover after wheat or a winter cover after sorghum.
4. **Change the sequence.** Try swapping or alternating cash crops, e.g. wheat, then sorghum, then soybeans.
5. **Apply rotation rules.** Switch crop families at least every other year; include a legume at least once per cycle; no overlapping seasons; respect a minimum gap before planting.
6. **Keep the best.** Up to 30 options plus the current one.

### The four fit checks
Each option gets pass, warn or fail on each check, with the evidence in one line. A fail removes the option unless the farmer overrides it; a warn stays, with the reason shown.

**1. Water fit: does it use too much water?**
- Measures: the simulator's soil water at the next cash crop's planting, in every simulated season. Water cost to the next crop = how much less water the next crop starts with than in the current rotation.
- Fail: the next crop starts short of water in more than 1 of every 4 years. Warn: 1 in 10 to 1 in 4. (Thresholds to confirm with an agronomist.)
- Also shows: GRACE groundwater trend for irrigated farms; ECOSTRESS stress in past dry spells.
- Local check: irrigation and water rights.

**2. Disease fit: does it bring in pests or disease?**
- Measures: shared hosts between consecutive crops; green bridges (a cover that hosts the next crop's pests); how often the same family repeats; weather-driven pest risk today and in 2040.
- Fail: a cover that hosts a serious pest of the next cash crop. Warn: the same family two years in a row, or rising weather risk.
- Local check: which pests the county actually has, with the extension agent.

**3. Market fit: can they sell it?**
- Measures: whether the crop is grown nearby (NASS county acreage and USDA crop maps); local cash prices from USDA market reports; the farmer's own buyers.
- Fail: almost no acres in the county or its neighbors, and no buyer entered. Warn: few acres, or a weak local price.
- Cover crops: no market needed; their value comes from savings (nitrogen, soil, cost-share).
- Local check: always; the farmer knows their elevator and contracts.

**4. Season fit: does it fit the growing season?**
- Measures: the field's real calendar from Model A; the crop's GDD needs; frost and heat risk from 40 years of weather; the same with 2040 temperatures.
- Fail: does not finish before the next crop or frost in more than 1 in 5 years. Warn: fits today but not in 2040, or tight timing.
- Local check: the planting dates the farmer actually uses; equipment timing.

## Profit: estimating and maximizing it
The tool searches over rotations and management choices for the plan with the highest expected profit that stays within the farmer's risk and soil limits. It reports a range, not a promise.

### What counts in profit
- Revenue: simulated yield × price, for each harvest in each season.
- Variable costs: seed, fertilizer, spraying, fuel, harvest, cover-crop seed and planting, termination.
- Savings: fertilizer not bought thanks to legume nitrogen credits.
- Fixed costs and rent: shown, but the same for every option, so they don't change the ranking.
- Cost-share (EQIP): shown separately and never scored, because it is not guaranteed.

The main number is return above variable costs per acre. A second number, net after fixed costs and rent, tells the farmer whether the farm makes money overall.

### Management choices the optimizer tries
| Choice | Options tried | Why it moves profit |
|---|---|---|
| Planting date | Early, normal, late within the crop's window | Avoids heat at flowering; uses stored water |
| Nitrogen rate | 4–6 rates from none to the full extension rate | The economic optimum N rate: the point where one more pound of fertilizer earns less than it costs |
| Variety maturity | Short or full season | Short season fits a double crop; full season yields more |
| Cover termination date | 2–4 weeks before planting vs at planting | Earlier saves water for the cash crop; later adds more nitrogen and cover |
| Double crop or not | Plant a second crop after wheat, or leave a cover / fallow | Extra income vs water risk |
| Irrigation (if available) | None, limited, full | Yield vs water cost |
| Tillage | Conventional, reduced, no-till | Cost, erosion, residue |

The search runs each combination through the simulator in all 40 seasons. That's tens to hundreds of runs per option, fast enough for one field because each season takes a fraction of a second. If the search grows too large, a smarter search method (Bayesian optimization) tries the most promising combinations first.

### The goal it optimizes
By default: maximize median return above variable costs, subject to:
- Risk limit: the worst 10% of seasons must not lose more than the farmer allows (default: no worse than the current rotation).
- Soil limit: average erosion must stay under the soil's tolerance (T) from the soil survey.
- Fit checks: no failed check.

The app then shows three answers side by side, so the farmer sees the trade-off:
1. Most profitable within the limits
2. Best balance under the farmer's priorities
3. Safest: best worst-year result

### Prices and uncertainty
Prices are not one number. Each run draws prices from a range based on the last 10 years and current USDA forecasts, or the farmer's own prices. Profit is shown as a likely range, e.g. "$60–130/acre, typically $95," plus the chance of beating the current rotation.

### How to say it
"Field Shift finds the rotation and management with the best expected profit on your field, within the risk and soil limits you set, and shows how sure it is." Not: "guarantees maximum profit."

## Farm simulator
The farm simulator lets a farmer start from their field as it is today, change any choice, and watch what happens day by day and month by month, for one season or up to 30 years. It runs on the same engine as the recommendation, so the two always agree. It shows what would happen under a chosen kind of weather. It is not a forecast of actual future weather.

### Starting state: "your farm today"
Filled in automatically; the farmer can correct any value.

| Starting value | Where it comes from |
|---|---|
| What is growing now and its stage | Model A, from the latest satellite views |
| Soil moisture in the root zone | SMAP (or Model D's field value), checked against recent rain |
| Soil type, water holding, erodibility | Soil survey (gSSURGO) |
| Soil organic matter | Soil survey, or the farmer's soil test |
| Nitrogen left in the soil | Estimated from last crop, yield and fertilizer; or a soil test |
| Residue on the surface | NDTI from the latest satellite views |
| Recent weather | Daymet for the last 90 days |
| Prices and costs | Current USDA forecasts and regional budgets, or the farmer's own |

### What the farmer can change
- Plan: crops and their order, planting dates, variety maturity, cover crops and termination dates, double cropping
- Inputs: nitrogen rate and timing, irrigation (none, limited, full, or a water budget), tillage
- Money: crop prices, input prices, land rent, cost-share on or off
- Weather: typical year; a specific past year ("2011 again"); a random draw of past years; the 2040 middle or high scenario; a wetter or drier, hotter or cooler slider
- Length and speed: one season to 30 years; play, pause, step a day, jump a month

### What it shows
| Category | Day by day | Month by month / season summary |
|---|---|---|
| Weather | Rain, high and low temperature, heat and frost days | Monthly totals vs normal |
| Crop | Stage (planted, emerged, flowering, mature, harvested); how green; growth so far | Yield at harvest (bu/ac) and vs typical |
| Water | Root-zone soil water (inches); water stress; irrigation applied; runoff; drainage | Water used vs available; water left for the next crop |
| Soil | Bare or covered; residue cover %; erosion from each storm | Soil lost (t/ac) vs tolerance T; soil organic matter trend per year |
| Nutrients | Soil nitrogen; uptake; fixation by legumes; fertilizer applied; leaching | Nitrogen balance; P and K removed |
| Pests | Daily weather risk for key pests and diseases | Seasons at high risk |
| Money | Costs on the day they occur (seed, fertilizer, harvest); revenue at sale | Running profit per acre; cash flow by month; season and multi-year totals |
| Events | A log: "Jun 8: wheat harvested, 46 bu/ac", "Jul 22: heat stress during sorghum flowering" | Key events per season |

- Views: a timeline of the field's state (green, residue, bare), line charts for each category, a monthly summary table, and side by side for two plans run on the same weather.
- Uncertainty view: run the same plan through all 40 past seasons and show the typical result with a shaded band from the worst to the best 10% of years.

### The engine: what it calculates every day
The simulator keeps a daily state for the field and updates it in this order:
1. Weather in: that day's rain, temperatures, sunlight and reference ET (from Daymet and POWER, or a chosen scenario).
2. Crop growth: add growing degree days; move the crop through its stages; grow canopy and biomass from transpired water (the method of FAO's AquaCrop model); apply heat, frost and water stress.
3. Water balance: rain and irrigation in; evaporation, crop water use, runoff and drainage out; update root-zone water.
4. Nitrogen: mineralization from organic matter, fixation by legumes, fertilizer, crop uptake, leaching with drainage.
5. Soil cover and erosion: ground cover from the crop and residue; erosion from that day's storm intensity, soil, slope and cover (daily RUSLE).
6. Soil organic matter: residue and roots added at harvest or termination; slow decay each day, faster with tillage and warmth (a simple two-pool carbon model).
7. Pests: add to each pest's weather-risk counter.
8. Money: book any operation's cost on its date; book revenue at harvest.

Field-specific settings come from the learned models: crop dates from Model A, drought and heat sensitivity from Model B, scenario years from Model C, yield settings from Calibration E.

Build choice: write the engine as a small Python module with a state object and a step(day) function, so the web app can stream results day by day. An open-source Python version of AquaCrop (AquaCrop-OSPy) is a candidate for the crop-growth step; check its speed and license before choosing it over our own simpler version. *(Team decision Nov 14: the engine is written in JavaScript in /scoring so the browser and Node use the same code; see docs/v2-workflow.md.)*

Speed target: one season under 0.1 seconds, so 40 seasons × several plans takes a few seconds and the farmer can change a slider and see the result right away.

## Uncertainty and local expertise
Uncertainty comes from four places, each measured a different way, and the app combines them into one confidence badge (high, medium, low) with the reason shown.

| Source | Example | How it is measured | What the farmer sees |
|---|---|---|---|
| The models | Model A unsure of the 1994 crop; Model B's stress forecast | Model A's own probabilities, checked so 90% really means 90%; conformal ranges for Model B | "Wheat (94% sure)"; "next month: slightly to moderately below normal" |
| The data | Clouds hid the field in May; SMAP's 9 km cell covers 200 fields | Observation counts; agreement between independent sensors (SMAP, ECOSTRESS, Daymet, Landsat) | "5 sources agree: dry" or "sources disagree: check locally" |
| The future | Climate models differ on 2040 rain | Spread across the climate models | "Pick holds under 8 of 8 climate models" |
| Assumptions | Clover nitrogen credit, seed price, prices | 1,000 what-if runs with each assumption drawn from a range | "This plan beats your current one in 87% of runs" |

Confidence badge rule: high = beats the current rotation in at least 80% of what-if runs and under most climate models, with no warned fit checks; medium = at least 60%, or one warned check; low = otherwise. (Thresholds to tune.)

### Where local expertise is needed
Each rotation card lists the items below that apply, under "Check locally."

| Item | Why the tool can't settle it | Who checks |
|---|---|---|
| Legume nitrogen credit | Varies with stand, soil and termination; the assumption that most often flips the pick | Extension agent, soil test |
| Cover-crop establishment | Seeds may not take on heavy clay or in dry falls | Extension agent, neighbors |
| Seed price and availability | Local and changes yearly | Seed dealer |
| Buyers and local price | Elevators, contracts and basis are local | The farmer |
| Equipment | A no-till drill or a second planter may be needed | The farmer |
| Local pests | Which pests are present, and how bad | Extension agent |
| Water rights and irrigation | Legal and local | The farmer, water district |
| Field quirks | Wet spots, drainage, past management the satellites miss | The farmer |
| Cost-share eligibility | Competitive and rule-based | Local NRCS office |

The tool also asks for a blind ranking: a local agent ranks the options without seeing our scores. Agreement is reported; disagreement is a lead to investigate.

## Validation
Eight checks compare what the tool says against what really happened; their results go on a report card, failures included. No check can prove a future profit, but together they show each part of the answer rests on measurements.

| # | Check | Compares | Passes if (target to confirm) | Data |
|---|---|---|---|---|
| 1 | Model accuracy | Models A–D on held-out years and regions | Reported per region; A crop type ≥ 85% where labels are clean | USDA crop maps, satellite |
| 2 | Bare days | Simulated vs measured bare days for the current rotation | Within about 15 days a year on most fields | Model A |
| 3 | Crop dates | Simulated vs measured green-up and harvest dates | Within about 10 days | Model A |
| 4 | Yields | Simulated vs NASS county yields, year by year, on years not used for calibration | Clear year-to-year correlation; error reported | NASS |
| 5 | Erosion | Simulated vs measured soil loss by land use | Same ranking and similar size as measurements | Riesel, LTAR |
| 6 | Soil moisture | Simulated vs SMAP (and Model D) | Rises and falls together | SMAP |
| 7 | Neighbor backtest | Fields that really run the recommended type of rotation vs similar fields that don't | Fewer bare days, more residue, smaller drought drops | USDA field outlines, crop maps, Landsat |
| 8 | Expert ranking | Our ranking vs a local agent's blind ranking | Agreement reported | Interview |

- Multi-region test. Run checks 1–7 in 8–10 counties across the US: Texas Blackland, Kansas wheat, Corn Belt, Northern Plains, Delta, Southeast, Pacific Northwest, irrigated West. Report results by region, including where the tool does poorly.
- Robustness. For every recommendation: 1,000 what-if runs, the spread across climate models, and whether the pick changes when the farmer's priorities change. These feed the confidence badge.

## App screens
Seven screens, in the order a farmer meets them. Plain words on every screen; every number taps open to show where it came from.
1. **Pick your field.** A map with USDA field outlines; tap one, or draw your own. Optional: set priorities (income, soil, low risk, save water) and add your prices, soil test or irrigation. A progress bar while the data loads ("Reading 40 years of satellite data…", about a minute).
2. **Field story.** A 40-year timeline, one row per year, colored by crop, with green, residue and bare days. Headline: "Wheat in 31 of 40 years; bare about 150 days a year, mostly June–October." Farmers can pin their own memories to a year.
3. **Field risks.** The stress calendar (when this field is most vulnerable, next month's risk with its reason), erosion hotspots, water and groundwater trend, frost and heat risk now vs 2040.
4. **Options.** Cards for the top options against the current rotation: grade, six scores, the four fit checks (pass, warn, fail with one-line evidence), profit range, soil saved, nitrogen saved, confidence badge, "Check locally" list, and neighbor evidence ("14 fields within 20 miles do this").
5. **Best plans.** Three answers side by side: most profitable, best balance, safest, with the management choices that go with each (planting dates, nitrogen rate, cover termination).
6. **Farm simulator.** Start from your farm today, change any choice, pick a weather scenario, press play. Charts for crop, water, soil, nutrients, pests and money, plus an event log. Compare two plans side by side.
7. **Evidence and sources.** For any number: the datasets, their resolution and dates, the model that used them, and the validation results for this region. Export a one-page field report (PDF) to bring to the extension agent or NRCS office.

## Build plan
Build the simulator engine first, on Ellis County with the data we already have, because the recommendation, optimizer and farm simulator all depend on it. Start the slow data exports in parallel on day 1. The multi-region test and on-demand fields come last.

| Component | Depends on | Rough effort |
|---|---|---|
| New Earth Engine exports (field outlines, gSSURGO, Daymet, Sentinel-1, red-edge, ECOSTRESS, GRACE) for Ellis + 8 counties | — | 1 hr to write; several hours to run |
| Data cube builder (harmonize to field × day / month) | Exports | 3–4 hrs |
| Crop library (25–30 crops) | — | 3–4 hrs |
| Simulator engine (water, crop, N, soil carbon, erosion, pests, money) | Crop library | 6–8 hrs |
| Model A (history) | Data cube | 3–4 hrs (reuses v1 code) |
| Model B (response) + Calibration E | Data cube, NASS yields | 4–5 hrs |
| Model C (climate regimes) | Daymet / POWER | 1–2 hrs (reuses v1) |
| Option generator + four fit checks | Library, engine, Model A | 3–4 hrs |
| Optimizer + scoring + confidence | Engine, fit checks | 3–4 hrs |
| Validation suite (checks 1–7) | Engine, models | 4 hrs |
| Backend API (pick field → results; simulator stream) | Everything above | 3–4 hrs |
| App screens 1–7 | API | 8–12 hrs (app team, in parallel) |
| Model D (soil moisture downscaling) | Data cube | 3 hrs, optional |

### Day 1: data and engine
- Write and start the new Earth Engine exports
- Upload existing v1 exports and models
- Download NASS county yields and acreage (QuickStats)
- Build the crop library for Ellis County crops first
- Build the simulator engine; test one field, one season, against v1's replay
- Rebuild Model A on the existing data
- App team: map and field-pick screen, field story screen

### Day 2: models, options and profit
- Data cube builder with the new exports
- Model B with Calibration E; Model C
- Option generator and the four fit checks
- Optimizer, scoring and confidence
- Validation checks 1–7 on Ellis County
- Backend API
- App team: options, best plans and simulator screens

### Day 3 and after (if time)
- Multi-region test in 8–10 counties
- On-demand analysis for any tapped field
- Model D (soil moisture downscaling)
- Expert blind ranking
- Report card and pitch slides

If time runs short, cut in this order: Model D, then multi-region test (keep 2–3 counties), then on-demand fields (keep precomputed). Never cut: simulator engine, fit checks, validation on Ellis County.

## Risks, open questions and honest limits

### Risks to the build
| Risk | Effect | Fallback |
|---|---|---|
| Earth Engine exports slow or fail | No new data by day 2 | Run on v1 data (POWER, OpenLandMap) with v1 resolution |
| Simulator engine takes longer than planned | Everything downstream waits | Start from v1's replay code and add nitrogen, carbon and money step by step |
| On-demand field analysis too slow (> 2 min) | Live demo drags | Precompute demo fields; show one live run |
| Crop library data gaps for some crops | Fewer options | Start with the 10 crops that matter in the demo counties |
| Model B doesn't transfer across regions | Weak yields elsewhere | Fall back to textbook factors outside tested regions, and say so |

### Open questions for the team
- Which 8–10 counties for the multi-region test?
- Can we reach a Texas A&M AgriLife agent for the blind ranking and the nitrogen-credit check?
- Use AquaCrop-OSPy for crop growth, or our own simpler version?
- Who on the team owns the app screens and the simulator UI?

### Honest limits to state in the pitch
- It estimates expected outcomes from past weather and projections; it can't forecast next year's actual weather or prices.
- Profit uses regional costs unless the farmer enters their own.
- Soil organic matter change over decades is modeled, not measured; only soil tests over time can confirm it.
- Crop labels are only reliable where USDA (or WorldCereal) has mapped crops; outside the US the farmer says what they grow.
- It supports the farmer's judgment and local expertise; it doesn't replace them.
