# Field Shift v2: data contract

The handshake between Terminal A (app), Terminal B (engine) and Pranav (models). Source plan: `docs/fieldshift-v2.md`. Workflow: `docs/v2-workflow.md`.
Contract version: **schemaVersion 1**. If any shape below changes, bump it and update the sample and the validators together.

**Three parts**
1. **Model slot files**: what Pranav's models produce, one file per field. Until a file exists, a fixed PLACEHOLDER is used.
2. **Output files**: what the engine precomputes and the app reads.
3. **Crop library record**: one record per crop, read by the engine and the option builder.

```
content/model-placeholders.json     the placeholders (same for every field), the only place to edit them
content/v2-scores.json              the six scores, weights, priority boosts, grade cut-offs (provisional)
content/crop-library.json           crop library (built by scoring/tools/build_crop_library.mjs, format in section 3)
shared/v2/models/<field-id>.json    Pranav's model outputs (section 1)    <- plugged in later
shared/v2/fields/<field-id>.json    engine output the app reads (section 2)
shared/v2/validation.json           report card, eight checks (section 2.4)
shared/v2-sample/sample-field.json  sample of the output (invented numbers, isSampleData: true)
scoring/modelSlots.js               reads slots: model value if present, else placeholder
scoring/v2Contract.js               checks an output file against section 2
```

## Conventions (all files)
- Field ids: `ec-000` … `ec-299` (same as `shared/fields/<id>.json`). Crop ids: lowercase snake case, same ids as `content/crops.json` (`winter_wheat`, `corn`, `grain_sorghum`, `cotton`, `soybeans`, `sunflower`, `sesame`, `alfalfa`, `cowpea`, `sorghum_sudangrass`, `cereal_rye`, `crimson_clover`, `hairy_vetch`, `fallow`). The USDA map also gives `other` (a crop we have no record for); it is allowed in `cropByYear` and is never given a calendar.
- Dates are ISO `YYYY-MM-DD`. Day of year (`doy`) is 1 to 366. Months in forecasts are `YYYY-MM`.
- Temperatures °C. Water in mm unless the name says otherwise. Money in US dollars. Areas and yields in US units (the unit string travels with the number).
- Shares and probabilities are 0 to 1 (not percent). Scores are 0 to 100, higher is better.
- `null` means "not known". Never write a made-up number to avoid a null.
- Unknown extra keys are ignored. Keys starting with `_` are comments.
- **Rules return i18n keys and params, never English text** (`{ "key": "v2.fit.water.warn", "params": { "shortYears": 0.18 } }`). The app adds the keys to `en.json` / `es.json`.
- Every output says which slots were placeholders (`placeholderSlots`), so the app can tag those values "default value, field model coming".

---

## 1. Model slot files: `shared/v2/models/<field-id>.json`

One file per field. Each section is independent: a file with only `modelC` works, the other four slots stay placeholders. A section that fails the checks below is ignored (placeholder used, `problems` lists why); it never half-applies.

```jsonc
{
  "schemaVersion": 1,
  "fieldId": "ec-251",                 // must match the file name and the field
  "generatedAt": "2026-11-15T09:00:00Z",
  "modelVersions": { "A": "a-0.3", "B": "b-0.2", "C": "c-0.1", "D": null, "E": "e-0.1" },
  "modelA": { … }, "modelB": { … }, "modelC": { … }, "modelD": { … }, "calibrationE": { … }
}
```

### Model A: field history
| Key | Type | Meaning |
|---|---|---|
| `cropByYear[]` | `{ year, crop, confidence, labelSource }` | One row per year. `confidence` 0 to 1 or `null`. `labelSource`: `"usda-cdl"` (USDA label used as is), `"model"` (classifier, used 1985 to 2007 and the current season) |
| `cropDates{}` | keyed by crop id | Typical calendar of that crop **on this field** (see below) |
| `bareWindows[]` (optional) | `{ start, end }` ISO dates | Stretches with nothing growing. If left out, the engine derives them from `cropByYear` + `cropDates` (same rule as the placeholder) |

`cropDates.<crop>`:
| Key | Unit | Meaning |
|---|---|---|
| `plantYearOffset` | 0 or -1 | -1 = planted the autumn before the harvest year (winter wheat, rye) |
| `plantDoy` | day of year | Planting date, in year + offset |
| `greenUpDoy`, `peakDoy` | day of year | Green-up and peak greenness (harvest year). Optional |
| `endDoy` | day of year | Harvest (cash crops) or termination (cover crops) |
| `endKind` | `"harvest"` or `"terminate"` | |
| `rangeDays` | days | Plus or minus spread (about 90% of years). Optional |
| `perennial` | boolean | Optional. Perennial crops (alfalfa) have no bare window |

Feeds: the current rotation, crop dates in the simulator, bare windows for the option builder, the current rotation's cover score, the bare-days validation check.

### Model B: field response
| Key | Type | Meaning |
|---|---|---|
| `crops.<crop>.droughtKy` | number ≥ 0 | Yield-response factor to water shortage (FAO-33 style: 1.0 = yield falls as fast as water supply; bigger = more sensitive) |
| `crops.<crop>.heatLossPerDay` | 0 to 1 | Share of yield lost per day above the threshold during the sensitive stage (0.01 = 1%) |
| `crops.<crop>.heatThresholdC` | °C | Daily maximum that starts to hurt |
| `crops.<crop>.droughtKyRange90` (optional) | `[low, high]` | 90% range (conformal) |
| `stressOutlook` (optional) | `{ asOf, months[] }` | Next 1 to 3 months. Each month: `{ month: "YYYY-MM", chance, low, high, reasons[] }` with `low <= chance <= high` (0 to 1, 90% range); `reasons[]` = `{ key, params }` (e.g. rain 60% below normal) |

A crop the file does not list uses the placeholder default crop. If `stressOutlook` is missing the placeholder calendar outlook is used.
Feeds: the simulator's yield response (replaces the textbook factor) and the stress calendar.

### Model C: year types
| Key | Type | Meaning |
|---|---|---|
| `yearTypes[]` | `{ year, type, probability }` | One per past year, 1985 to 2025. `type`: `drought`, `hot`, `wet`, `normal`. `probability` 0 to 1 = how sure the model is of that type |
| `frequencies2040.ssp245`, `.ssp585` | `{ drought, hot, wet, normal }` | Share of years of each type in 2040 under the middle and high scenario; each adds up to 1 (within 0.02) |

Feeds: simulator scenarios, how heavily each past year counts in 2040, "replay a bad year".

### Model D: field soil moisture (optional model)
| Key | Type | Meaning |
|---|---|---|
| `rootZoneFraction` | 0 to 1 | Starting root-zone moisture as a share of the soil's plant-available water (0 = wilting point, 1 = field capacity) for "your farm today" |
| `asOf` | ISO date or null | Date the value is for |
| `daily[]` (optional) | `{ date, fraction }` | Daily series, same unit |

Feeds: the simulator's starting soil moisture and the water fit check.

### Calibration E: yields
| Key | Type | Meaning |
|---|---|---|
| `crops.<crop>.typicalYield` | number ≥ 0 | Typical yield on this field, in `unit` |
| `crops.<crop>.unit` | string | e.g. `bu/acre`, `lb lint/acre`, `lb/acre`, `tons hay/acre`; cover crops: `lb biomass/acre` |
| `crops.<crop>.wpScale` (optional) | number > 0 | Multiplier on the engine's crop water productivity (1 = textbook) |
| `crops.<crop>.heatThresholdOffsetC` (optional) | °C | Added to the heat threshold (0 = textbook) |
| `wpScale`, `heatThresholdOffsetC` (optional, top level) | | Defaults for crops that do not list their own |
| `regionId`, `fitYears`, `testYears`, `metrics` (optional) | | Provenance of the fit, shown in Evidence |

Feeds: every profit number.

### What the slot code returns
`scoring/modelSlots.js` gives each slot as `{ source: "model" | "placeholder", problems: [], …values }`:

| Function | Returns (besides `source`, `problems`) |
|---|---|
| `slotModelA` | `cropByYear[]`, `cropDates{}`, `bareWindows[] {start,end,days}`, `bareDaysByYear{}` |
| `slotModelB` | `crops{}`, `defaultCrop`, `stressOutlook`; helpers `sensitivityFor(slot, crop)`, `stressOutlookFrom(slot, dateISO, n)` |
| `slotModelC` | `yearTypes[]`, `todayFrequencies`, `frequencies2040{ssp245,ssp585}`; helper `yearTypeOf(slot, year)` |
| `slotModelD` | `rootZoneFraction`, `asOf`, `daily` |
| `slotCalibrationE` | `crops{}` each with `typicalYield`, `unit`, `wpScale`, `heatThresholdOffsetC` filled in |
| `makeSlots({field, modelFile, placeholders})` | all five + `sources`, `placeholderSlots[]`, `problems[]` |

Placeholders (`content/model-placeholders.json`, same for every field): A = fixed typical calendar per crop, crop per year taken straight from the USDA crop map in the field file (confidence `null`); B = one fixed sensitivity per crop and a fixed calendar-month stress chance; C = 2000 and 2011 drought, 2015 wet, all other years normal, 2040 same as today; D = 0.5; E = one fixed typical yield per crop, `wpScale` 1.

---

## 2. Output files the app reads

### 2.1 Per-field file: `shared/v2/fields/<field-id>.json`
Built by the engine (step B3). Sample: `shared/v2-sample/sample-field.json` (invented numbers). Checked by `validateFieldOutput()` in `scoring/v2Contract.js`.

| Key | Type | Meaning |
|---|---|---|
| `schemaVersion` | 1 | |
| `isSampleData` | boolean | `true` only in the sample; the app shows "Sample data for testing" |
| `field` | `{ id, county, state, gridCell, lat, lon }` | Cell centre, never a farmer's tap |
| `generatedAt`, `engineVersion` | string | |
| `slots` | `{ sources{modelA..calibrationE}, placeholderSlots[], modelVersions{} }` | `sources` each `"model"` or `"placeholder"`; `placeholderSlots` lists exactly the placeholders |
| `priorities` | `{ selected[], weights{} }` | Priorities used (`income`, `soil`, `lowRisk`, `saveWater`) and the six resulting weights (add to 1) |
| `current` | Option | The current rotation (kind `current`) |
| `options` | Option[] (at most 30) | Generated options that passed the fit checks or only warn (kind `generated`) |
| `bestPlans` | see 2.3 | Three answers |
| `fieldRisks` | see 2.3 | Stress calendar, erosion, water, climate |
| `validation` | `{ reportFile, bareDays{}, cropDates{} }` | Field-level validation; `status` `pending-model` until Model A is plugged in |
| `sources` | `{ id, name, resolution, scale }[]` | Datasets behind the numbers (`scale`: `field`, `regional`, `placeholder`) |

### 2.2 Option
| Key | Type | Meaning |
|---|---|---|
| `id`, `kind` | string | `current` or `opt-01` …; kind `current` / `generated` |
| `name` | `{ key, params }` | |
| `sequence[]` | `{ year, crops[] }` | Rotation year 1…n; `crops[]` = `{ crop, role: cash/cover/fallow, plantDoy, endDoy, plantYearOffset }` (a double crop or cover = more than one entry) |
| `management` | object | The optimized choices: `plantingDate` early/normal/late, `nitrogenLbPerAcre`, `maturity` short/full, `coverTermination` early/at-planting/none, `doubleCrop` boolean, `tillage` conventional/reduced/no-till, `irrigation` none/limited/full |
| `scores` | `{ profit, risk, soil, water, nutrients, pests }` each `{ value 0-100, reasons[] }` | **Six scores, provisional** (names and weights: `content/v2-scores.json`). `reasons[]` = `{ key, params, tone: up/down/note, src? }` |
| `weightedTotal`, `grade` | 0-100, A/B/C/D/F | Weighted by `priorities.weights`; cut-offs in `v2-scores.json` |
| `fitChecks` | `{ water, disease, market, season }` each `{ status: pass/warn/fail, evidence: { key, params } }` | The four fit checks, one line of evidence each |
| `profit` | see below | |
| `soilSaved` | `{ erosionTonsPerAcreYear, toleranceT, bareDaysPerYear, somTrendPctPerDecade, savedVsCurrentTonsPerAcreYear }` | `savedVsCurrent…` is `null` for the current rotation |
| `nitrogenSaved` | `{ balanceLbPerAcreYear, fertilizerBoughtLbPerAcreYear, savedVsCurrentLb, savedVsCurrentUsd }` | `savedVsCurrent…` `null` for current |
| `confidence` | `{ level: high/medium/low, whatIfRuns, beatsCurrentShare, climateModels{agree,of}, reasons[] }` | Rule from the plan; reasons include `v2.conf.placeholderSlots` when slots are placeholders |
| `checkLocally` | id[] | From: `legumeNitrogenCredit`, `coverEstablishment`, `seedPriceAvailability`, `buyersLocalPrice`, `equipment`, `localPests`, `waterRights`, `fieldQuirks`, `costShareEligibility` (the plan's list) |
| `placeholderSlots` | slot[] | Slots that were placeholders when this option was run |
| `neighbors` | `{ count, radiusMiles }` or null | "14 fields within 20 miles do this" |

`profit`: `returnAboveVariable` and `netAfterFixed` are each `{ low, typical, high, unit: "usd/acre/year" }` with `low` = 10th percentile, `typical` = median, `high` = 90th percentile of the what-if runs; `chanceBeatsCurrent` 0 to 1 (`null` for the current rotation); `nitrogenCreditUsd` (counted in profit); `costShareUsdShown` (EQIP, shown separately, **never scored**).

### 2.3 Best plans and field risks
`bestPlans`: `limits` (the risk, soil and fit-check limits used) and `mostProfitable`, `bestBalance`, `safest`, each `{ optionId, why: { key, params } }`. Management choices come from the referenced option. Wording in the app: "best expected profit within your limits", never "guaranteed".

`fieldRisks`:
- `stressCalendar[12]`: `{ month 1-12, risk 0-1, reasons[] }`
- `nextMonths[]`: Model B outlook, `{ month, low, chance, high, reasons[] }`
- `erosionHotspots[]`: `{ zoneKey, areaShare, tonsPerAcreYear, reasons[] }`
- `water.groundwaterTrend`: `{ status: falling/steady/rising/unknown/not-applicable, source }`
- `climateNowVs2040`: `frostFreeDays`, `heatDays`, `rainVariability`, each `{ today, y2040 }`

### 2.4 Report card: `shared/v2/validation.json`
`{ schemaVersion, generatedAt, checks[8] }`; check ids 1 to 8 as in the plan (model accuracy, bare days, crop dates, yields, erosion, soil moisture, neighbor backtest, expert ranking). Each: `{ id, nameKey, status: pass/fail/partial/pending-model/not-run, region, n, measured, target, noteKey }`. Failures are shown. Anything that needs a model not plugged in yet is `pending-model`.

### 2.5 Six scores: provisional
`content/v2-scores.json` is the single place for the names, weights, priority boosts and grade cut-offs. **Provisional, confirm with Pranav.** Current definitions: 1 Profit (median return above variable costs), 2 Risk (worst-10%-of-seasons result vs the current rotation), 3 Soil (erosion vs T, bare days, organic matter trend), 4 Water (water left for the next crop, water stress), 5 Nutrients (nitrogen balance, fertilizer bought, legume credit), 6 Pests (shared hosts, green bridges, family repeats).

---

## 3. Crop library record: `content/crop-library.json` (built in step B2; engine guide: `docs/v2-engine.md`)

`content/crops.json` (v1 traits) stays as it is. The library is a new file. One record per crop; every value carries a source and `"verified": false` until checked with AgriLife / NRCS.

```jsonc
{
  "id": "cowpea",
  "kind": "cover",                       // "cash" | "cover"
  "family": "legume",                    // grass | legume | other (cotton, sunflower, sesame…); decides rotation rules
  "marketType": "not-sold",              // "sold" | "not-sold"
  "temperature": { "minGrowthC": 20, "maxGrowthC": 35, "killTempC": 0, "frostTolerant": false },     // ECOCROP
  "season": { "baseTempC": 10, "gddToMaturity": 1200, "daysToMaturity": { "short": 70, "full": 90 } }, // extension guides
  "plantingWindow": { "earliestDoy": 140, "latestDoy": 200 },
  "water": { "kc": { "ini": 0.4, "mid": 1.05, "end": 0.55 }, "droughtKy": 0.7, "seasonalMm": [250, 400] },  // FAO-56, FAO-33. droughtKy is the textbook value; Model B replaces it per field
  "groundCover": { "ini": 0.1, "mid": 0.85, "end": 0.6 },          // 0-1, for erosion (RUSLE cover factor)
  "nitrogen": { "fixesLbPerAcre": [40, 80], "removalPerYieldUnit": { "n": 0, "p2o5": 0, "k2o": 0 } },  // lb per yield unit
  "residue": { "lbPerAcre": 2500, "carbonFraction": 0.4, "cnRatio": 18 },
  "pests": { "hosts": ["root-knot-nematode"], "breaks": ["soybean-cyst-nematode"] },   // host table
  "defaults": { "yieldUnit": "lb biomass/acre", "costUsdPerAcre": { "seed": 14, "planting": 9, "termination": 8 }, "priceUsdPerUnit": null },
  "sources": { "temperature": ["ecocrop"], "water": ["fao-56", "fao-33"], "nitrogen": ["sare"] },
  "verified": false
}
```
**Added in B2 (the engine needs them; unknown keys are ignored by older readers):**
- `kind` also takes `"fallow"` (a minimal record: pests, costs only; `family: "none"`).
- `temperature.optMinC`, `optMaxC` (ECOCROP optimum), `flowerFrostC` (freeze that hurts flowering of frost-tolerant crops, or null).
- `season.stageFractions` { emerge, canopyFull, flowerStart, flowerEnd, senescence } as shares of the heat sum; `season.perennial`, `maxCuts`, `regrowthCanopyShare` (alfalfa: `gddToMaturity` is one cutting cycle).
- `water.droughtKyBasis` (`"listed"` or `"analog:<crop>"` when FAO-33 does not list the crop), `rootDepthM`, `depletionFractionP` (FAO-56 Table 22).
- `growth` { wpStarGPerM2 (AquaCrop WP*), harvestIndex, heightM, rootShootRatio }. `groundCover.ini/mid/end` is the canopy cover curve.
- `nitrogen.fixFractionOfUptake`, `nContentOfBiomass`; `residue.stoverFraction`, `coverCoeffPerLb` (Gregory residue cover).
- `defaults.lbPerYieldUnit`, `harvestMoisture`, `turnout` (cotton lint), `nRateLbPerAcre`, `harvestUsdPerYieldUnit`; `defaults.costUsdPerAcre` keys: seed, chemicals, plantingOps / planting, harvestOps, other, termination, weedControl. `priceUsdPerUnit` is per yield unit.
- Top level: `sourceRefs` (full citation per source id; each group's `sources` lists ids from it).

Field-specific values (calendar, sensitivity, typical yield) do **not** live here; the engine gets them through `scoring/modelSlots.js`, so replacing a placeholder with a model never touches the library.

## Cross-checks that run in the selftests
`node scoring/selftest-modelslots.js` (slots: placeholders, model file, partial file, bad file, wrong field) and `node scoring/selftest-v2contract.js` (the sample and report card follow section 2, and the validator catches broken files).
