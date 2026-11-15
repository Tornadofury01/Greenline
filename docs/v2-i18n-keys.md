# Field Shift v2: i18n keys the engine emits (for Terminal A)

The engine (`/scoring/v2`) returns **keys and numbers, never English**. Terminal A adds each key below to `content/i18n/en.json` and `es.json`. A parameter written as a crop id (`winter_wheat`) or cover id (`hairy_vetch`) is a **crop id**: show the crop's name from the crop names the app already has. `share`, `shortYears`, `ratio` are 0 to 1 (show as percent where it reads better). `pct` is already a percent. `month` is 1 to 12.
`node scoring/selftest-v2.js` fails if the engine emits a key that is not listed here.

## 1. Four fit checks (`options[].fitChecks.<water|disease|market|season>.evidence`)
One line each. `status` (pass / warn / fail) comes next to it; a fail never reaches the app (the option is removed), so `fail` keys appear only in `removedOptions` and for the current rotation.

| Key | Params | Meaning (suggested English) |
|---|---|---|
| `v2.fit.water.pass` | `shortYears`, `extraVsCurrent`, `waterCostMm` | "The next crop starts with enough water in {shortYears} of years short." (pass: under 1 year in 10 short) |
| `v2.fit.water.warn` | same | "The next crop starts short of water in about {shortYears} of years ({waterCostMm} mm less than today's rotation)." (1 year in 10 to 1 in 4) |
| `v2.fit.water.fail` | same | "The next crop starts short of water in more than 1 year in 4." |
| `v2.fit.disease.pass` | none | "No shared pests between crops that follow each other." |
| `v2.fit.disease.warnFamilyRepeat` | `crop`, `nextCrop` | "{crop} is followed by {nextCrop}, the same crop family, which keeps pests alive." |
| `v2.fit.disease.warnSharedHost` | `crop`, `nextCrop`, `pest` | "{crop} and {nextCrop} share {pest}." (`pest` is a pest id: `cereal-rust`, `grass-foliar-disease`, `cotton-root-rot`, `root-knot-nematode`, `charcoal-rot`, `sugarcane-aphid`) |
| `v2.fit.disease.warnGreenBridge` | `cover`, `nextCrop`, `pest` | "{cover} can carry {pest} over to {nextCrop} (a small risk)." |
| `v2.fit.disease.failGreenBridge` | `cover`, `nextCrop`, `pest` | "{cover} would carry {pest}, a serious pest, over to {nextCrop}." |
| `v2.fit.disease.warnWeatherRisk` | `ratio` | "Weather-driven pest losses are {ratio} times higher in 2040 conditions." |
| `v2.fit.market.pass` | `crops` | "All {crops} cash crops are grown nearby." |
| `v2.fit.market.warnFewAcres` | `crop`, `share` | "Few fields nearby grow {crop} ({share} of the study fields)." |
| `v2.fit.market.warnNoCountyRecord` | `crop`, `share` | "No county yield record for {crop}; a few fields nearby grow it." |
| `v2.fit.market.warnWeakPrice` | `crop`, `ratio` | "The latest {crop} price is {ratio} of its 10-year median." |
| `v2.fit.market.fail` | `crop`, `share` | "Almost nobody nearby grows {crop}, there is no county record and no buyer was entered." |
| `v2.fit.season.pass` | none | "Every crop finishes before the next one or the frost." |
| `v2.fit.season.warnTight` | `crop`, `share`, `share2040` | "{crop} did not finish (or froze) in {share} of the 40 seasons: tight timing." |
| `v2.fit.season.warn2040` | same | "Fits today, but would not finish in {share2040} of seasons under 2040 conditions." |
| `v2.fit.season.fail` | same | "{crop} does not finish in more than 1 season in 5." |

## 2. Option names, best plans, confidence
| Key | Params | Meaning |
|---|---|---|
| `v2.option.current` | `crops` (list of crop ids) | "Your rotation today: {crops}" |
| `v2.option.rotation` | `crops` (cash crops in order), `covers` (list, empty), `doubleCrop` (bool), `cashAll` (every cash crop including a double crop) | "{crops joined by then}" |
| `v2.option.rotationWithCover` | same, `covers` not empty | "{crops} with {covers}" |
| `v2.best.mostProfitable` | `usd`, `limitsMet` | "Best expected profit within your limits: ${usd}/acre/year typical." If `limitsMet` is false, say "no option stays within the soil and risk limits; this is the closest." |
| `v2.best.bestBalance` | `total`, `grade`, `limitsMet` | "Best balance for your priorities: {grade} ({total})." |
| `v2.best.safest` | `usd`, `limitsMet` | "Safest: the best worst-year result, ${usd}/acre." |
| `v2.conf.isCurrent` | none | "Your current rotation: not compared with itself." |
| `v2.conf.beatsOften` | `share` | "Beats your current rotation in {share} of what-if runs." |
| `v2.conf.beatsSometimes` | `share` | same, 60 to 80 % |
| `v2.conf.beatsRarely` | `share` | same, under 60 % |
| `v2.conf.climateDisagree` | `agree`, `of` | "Holds in only {agree} of {of} 2040 climate scenarios." (these are simple warming and drier-rain offsets, **not** climate-model runs: do not say "climate models") |
| `v2.conf.warnedChecks` | `n` | "{n} fit check(s) show a warning." |
| `v2.conf.cappedByPlaceholders` | `slots` (list of slot names) | "Confidence is held at medium because {slots} still use default values." |
| `v2.conf.currentRotationGuess` | `known` (0 to 2) | "The crop map names only {known} crop(s) on this field in recent years, so \"your rotation today\" is a guess; check it." (0 known = confidence is held at low) |
| `v2.conf.placeholderSlots` | `n` | "{n} of 5 model inputs are default values, field model coming." |

## 3. Score reasons (`scores.<id>.reasons[]`, each also has `tone` up / down / note and `src` dataset ids)
| Key | Params |
|---|---|
| `v2.reason.profit.median` | `usd` (median return above variable costs per acre per year) |
| `v2.reason.profit.vsCurrent` | `usd` (difference from the current rotation, may be negative) |
| `v2.reason.profit.nCredit` | `usd` (fertilizer money saved by legume nitrogen, counted in profit) |
| `v2.reason.risk.worst10` | `usd` (result in the worst 10 % of seasons) |
| `v2.reason.risk.vsCurrent` | `usd` (worst-10 % result minus the current rotation's) |
| `v2.reason.soil.erosionOverT` | `erosion`, `t` (tons per acre per year; T = soil loss tolerance) |
| `v2.reason.soil.erosionUnderT` | `erosion`, `t` |
| `v2.reason.soil.bareDays` | `days` (bare days a year) |
| `v2.reason.soil.somUp` | `pct` (organic matter, percentage points per decade) |
| `v2.reason.soil.somDown` | `pct` (negative) |
| `v2.reason.water.atPlanting` | `share` (water in the soil at planting, share of what it can hold) |
| `v2.reason.water.supply` | `ratio` (water the crops got vs what they needed) |
| `v2.reason.nutrients.bought` | `lb` (lb N bought per acre per year) |
| `v2.reason.nutrients.noneBought` | `lb` (0) |
| `v2.reason.nutrients.fixed` | `lb` (lb N fixed by legumes per acre per year) |
| `v2.reason.nutrients.mining` | `lb` (lb N a year more leaves the field than goes in) |
| `v2.reason.pests.lowLoss` | `pct` (simulated pest loss, percent of yield) |
| `v2.reason.pests.loss` | `pct` |
| `v2.reason.pests.familiesRotate` | none |
| `v2.reason.pests.familyRepeat` | `share` (share of crop changes that stay in one family) |
| `v2.reason.pests.greenBridge` | `cover`, `nextCrop`, `pest` |

## 4. Field risks (`fieldRisks`)
| Key | Params |
|---|---|
| `v2.risk.dryMonths` | `share` (share of years this month was dry, under 60 % of normal rain) |
| `v2.risk.hotMonths` | `share` (share of years this month was 1.5 C hotter than normal) |
| `v2.risk.calmMonth` | none |
| `v2.risk.noData` | none |
| `v2.risk.peakErosionMonth` | `month`, `share` (the month with the most simulated erosion and its share of the year) |
| `v2.risk.warmingOffset` | `warmC` (the 2040 comparison adds this much warming; an estimate, not a climate-model run) |
| `v2.risk.rainVariabilitySame` | none (rain variability in 2040 is shown equal to today: no projection yet) |
| `v2.zone.wholeField` | none (one zone: the whole field; no per-zone data yet) |
| `placeholder.noOutlook` | none (comes from model slot B's placeholder: "no field outlook yet, default calendar") |

## 5. Report card (`shared/v2/validation.json`)
Names and targets: `v2.val.check1.name` ... `v2.val.check8.name` and `v2.val.check1.target` ... `v2.val.check8.target`; notes: `v2.val.check2.note`, `v2.val.check3.note`, `v2.val.check4.note`, `v2.val.check1.needsModels`, `v2.val.check5.needsMeasurements`, `v2.val.check6.needsModelD`, `v2.val.check7.needsModelA`, `v2.val.check8.needsInterview`. Params of the targets: check 2 `days`, `share`; check 3 `days`; check 4 `correlation`, `ratioError`.
Eight checks as in `docs/fieldshift-v2.md`: 1 model accuracy, 2 bare days, 3 crop dates, 4 yields, 5 erosion, 6 soil moisture, 7 neighbor backtest, 8 expert ranking.

## 6. Other ids
- Check-locally ids (plain ids, no params): `legumeNitrogenCredit`, `coverEstablishment`, `seedPriceAvailability`, `buyersLocalPrice`, `equipment`, `localPests`, `waterRights`, `fieldQuirks`, `costShareEligibility`.
- Management values: `plantingDate` early / normal / late, `maturity` short / full, `coverTermination` early / at-planting / none, `tillage` conventional / reduced / no-till, `irrigation` none / limited / full.
- Dataset ids in `src` and `sources[].id`: the field file's ids (`power`, `imerg`, `prism`, `smap`, `landsat`, ...) plus `simulator`, `crop-library`, `ssurgo`, `nass`, `placeholder`.
- Scores and priorities keep their existing keys: `v2.scores.<id>`, `v2.priorities.<id>`.
