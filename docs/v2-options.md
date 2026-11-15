# Field Shift v2: options, fit checks, optimizer, scores (`/scoring/v2/`)

Step B3. Pure JavaScript on top of the daily engine (`docs/v2-engine.md`), no React, no DOM, no fs (only `scoring/tools/precompute_v2.mjs` touches files). The app can call the same code in the browser; the Node script precomputes every field.
Checks: `node scoring/selftest-v2.js` (about 40 s). Keys the engine emits: `docs/v2-i18n-keys.md`. Output format: `docs/v2-data-contract.md` section 2.

```js
import { analyzeField, pickBestPlans, weightsFor, weightedTotal } from '@scoring/v2/index.js';
const { out, meta } = analyzeField({ field, slots, library, economics, scoresConfig, priorities: ['soil'], regional, buyers, constraints, neighborsFor });
// out = shared/v2/fields/<id>.json (checked by validateFieldOutput); meta = timing and counts
pickBestPlans(out.options, out.current, weightsFor(['income'], scoresConfig), scoresConfig); // the app re-picks when priorities change
```

## What happens for one field (`analyzeField.js`)
1. **Current rotation**: the last 3 years the crop map names a crop with a calendar (slot A), run with `constraints.currentTillage` (default `reduced`, an assumption: the farmer's tillage is not in any dataset). If the crop map names no such crop (55 of the 300 fields are pasture, hay or unknown) the current rotation is a fallow year and confidence is capped at low (`v2.conf.currentRotationGuess`).
2. **Screen crops** (`options.js screenCrops`): heat available between the crop's usual dates >= 85 % of its heat need; crops with no county yield record, almost no acres nearby and no buyer are dropped (sesame, in Ellis County); crops whose season-mean daily maximum comes within 3 C of their growth limit in 2040 are flagged.
3. **Generate** (`generateSpecs`): every 2- and 3-crop cycle of the kept cash crops that follows the rotation rules (family switches at least every other year, no crop twice in a row, a legume cash crop or legume cover in the cycle, no overlapping seasons, a minimum gap), with up to four cover patterns (legume covers, grass covers, one legume cover, mixed) and an optional double crop after winter wheat. A cover that hosts a serious pest of the next cash crop is never offered. Dates come from `plans.js` on one timeline (so a winter cover, a double crop and the gap rule share one arithmetic).
4. **Screen in the engine**: each candidate runs through the engine (12 seasons), gets the six scores, and the best by the farmer's weights (plus the best by profit and by soil) go on, at most 36.
5. **Optimize** (`optimizer.js`): coordinate descent over tillage, double crop, cover termination, maturity, planting date, nitrogen rate (and irrigation when `constraints.irrigationAvailable`), through 18 seasons with real monthly weather. Goal: the highest **median return above variable costs per acre per year**, inside the limits: worst 10 % of seasons no worse than the current rotation's, mean erosion under the soil's T. If nothing is inside both, the setting with the smallest violation is kept and the option says so (`limits.soilMet / riskMet`).
6. **Final run**: 41 seasons (1985-2025), the 4 fit checks, the six scores, 1,000 what-if worlds, 4 climate scenarios. A failed check removes the option (listed in `removedOptions`); the rest are ranked by the weighted total, at most 30.
7. **Best plans** (`pickBestPlans`): most profitable, best balance, safest, among options inside the limits (if none is, among all, and `bestPlans.limits.relaxed` is true).
8. **Field risks** (`risks.js`) and **field validation** (`validate.js`).

## Four fit checks (`fitChecks.js`; all thresholds in `constants.js`, "to confirm with an agronomist")
| Check | pass / warn / fail |
|---|---|
| Water | share of cash plantings that start with under 30 % of the soil's plant-available water: under 10 % pass, 10-25 % warn, over 25 % **and** 5 points worse than the current rotation = fail (the same shortfall as today is a warning) |
| Disease | fail: a cover hosting a serious pest (loss >= 15 %) of the next cash crop; warn: minor green bridge, same family twice in a row, shared host, weather-driven pest loss 1.25 times higher in 2040 |
| Market | fail: under 1 % of the study fields grew it in 8 years, no county yield record, no buyer; warn: no county record or under 5 % of fields, or latest price under 80 % of the 10-year median |
| Season | share of seasons a cash crop did not reach 95 % of its heat sum or froze: under 10 % pass, 10-20 % warn ("tight"), over 20 % fail; warn if it fits today but would fail under the 2040 scenarios |

## Six scores (names, weights, boosts, grades: `content/v2-scores.json`, decided Nov 14 2026)
Each 0-100, higher is better; the maps from measurements to 0-100 are named constants. Profit: median return (-$50 = 0, $350 = 100). Risk: 50 + 50 x (worst-10 % result - the current rotation's) / $150. Soil: erosion vs T (50 %), bare days (30 %), organic matter trend (20 %). Water: water at planting and water supply of the crops. Nutrients: nitrogen bought (60 %) and balance (40 %). Pests: simulated pest loss, family repeats, green bridges. Weighted total with `weightsFor(priorities)`; grade from the cut-offs.

## Confidence and what-if runs (`whatIf.js`)
One what-if world draws every assumption from a range: each crop's price (spread from the last 10 years of Texas prices), each crop's yield (+/- 10 %), input costs, nitrogen price, the legume nitrogen credit (0.5 to 1.5 times), and whether a cover crop fails to establish (1 world in 4). The same worlds are applied to the option and to the current rotation. Profit range = 10th / 50th / 90th percentile over worlds of the median-season return. `chanceBeatsCurrent` = share of worlds the option wins. Confidence: high = beats the current rotation in at least 80 % of worlds, holds under at least 75 % of the climate scenarios, no warned check; medium = at least 60 %; low otherwise. **Capped at medium while calibration E or model B is a placeholder**, and at low when the current rotation is a guess.
The "climate scenarios" are 4 simple offsets (+1.4 or +1.9 C, rain unchanged or 8 % lower), **not climate-model output**: say "climate scenarios" in the app, never "climate models". Replace them with NEX-GDDP-CMIP6 when it is exported.

## Extra keys in the output (not in the contract's required list; older readers ignore them)
`simulation` (years, assumed tillage, scenarios, what-if runs), `cropScreen` (kept, dropped, flagged for 2040), `removedOptions` (options a fit check removed, with the failed checks), `bestBalanceByPriority` (the best-balance option id for each of the four priorities), `current.basisYears` / `knownCropYears`, `options[].limits` (`soilMet`, `riskMet`), `options[].riskDetail` (worst-10 % result, and the current rotation's), `profit.medianAtBaseAssumptionsUsd`, `profit.fixedCostsUsd` (**placeholder**, `fixedCostsVerified: false`), `confidence.climateModels.kind` (`warming-offsets`), `fieldRisks.climateNowVs2040.scenario`.

## Honest limits
- Every number rests on the placeholders for models A to E and on an engine whose yields are not calibrated (`docs/v2-engine.md`, "State of calibration"). The output says so: `placeholderSlots` on every option.
- Weather days are generated inside real monthly totals; storms are not observed.
- Fixed costs (rent, machinery) are a placeholder, not sourced; cost-share is shown as 0 (not estimated) and never scored.
- The "current rotation" tillage is assumed (`reduced`). Part of an option's gain over the current rotation is the management change (no-till, covers, N rate); the optimizer starts from the same tillage as the current rotation.
- Neighbours ("14 fields within 20 miles do this") count the other study fields whose last 6 crop-map years include every cash crop of the option.
- Alfalfa (a multi-year stand) is not built into rotations in this version.

## Precompute (`scoring/tools/precompute_v2.mjs`)
`node scoring/tools/precompute_v2.mjs [--ids ec-251,ec-000] [--workers 7] [--out dir] [--no-report]` writes `shared/v2/fields/<id>.json` for every study field (each checked with `validateFieldOutput`) and the report card `shared/v2/validation.json`, in worker threads. Model files in `shared/v2/models/<id>.json` are picked up automatically; rerun it and the placeholders are replaced everywhere.
