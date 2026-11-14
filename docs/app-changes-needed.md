# App changes needed (from the `datasets` branch)

The data session edits only `/pipeline`, `/shared` and `/docs`. These are the app, text (i18n) and Sources
changes needed to use the new data. Every new key is **additive and nullable**, so the current app keeps working
without any change.

## 1. Soil: erosion, water and land capability (SSURGO)
New keys in `field.soil`: `kFactor`, `tFactor`, `awcCmPerCm`, `waterStorage100Cm`, `landCapabilityClass`
(see `/shared/data-format.md`).
- **Field / Expert handoff screen:** show "Erosion risk (K)", "Tolerable soil loss (T)", "Water the soil holds
  (top 1 m)" in inches (`waterStorage100Cm / 2.54`) and "Land capability class".
- **i18n (en + es):** labels for the 4 values, plus the subclass letters for `landCapabilityClass`:
  `e` erosion, `w` wetness, `s` soil limits (shallow, stony, droughty), `c` climate. Suggested plain text:
  K < 0.20 "low", 0.20–0.35 "moderate", > 0.35 "high" erodibility.
- **Scoring (optional, later):** the erosion rule could weight bare days by `kFactor × slopePct`, and the
  drought rule could use `waterStorage100Cm`. Add `"USDA SSURGO"` to `src` on those reasons.

## 2. PRISM climate and frost dates
New keys: `climateYearly[].precipMmPrism`, `stormDaysPrism`, `lastSpringFrostPrism`, `firstFallFrostPrism`,
`frostFreeDaysPrism`; new `climateMonthly[]` (PRISM, 2008–2025); `quality.rainVsPrism`.
- **Frost dates:** the app can show the typical last spring / first fall frost from PRISM (4 km, gauge-based),
  e.g. the median of the last 10 years, in place of the POWER-only `frostFreeDays`. Keep POWER `frostFreeDays`
  as is, because model 3 (year types) is built on it.
- **Confidence score:** `quality.rainVsPrism.power.pct` / `.imerg.pct` can replace or add to
  `rainAgreement` ("NASA rain agrees with ground-based PRISM within X%").
- **Monthly chart (optional):** `climateMonthly` gives rain and temperature by month for a "this field's
  weather" chart.
- **Sources:** the new `PRISM` entry is already in `field.sources`. Add `"PRISM"` to `src` on any reason
  that uses it. `/scoring/scoreRotation.js` `EVIDENCE` may need a `PRISM` name.
- **i18n (en + es):** "Last spring frost", "First fall frost", "Ground-station rain (PRISM)".
- **Validation slide:** numbers are in `/docs/data-validation.md`.

## 3. Dollar estimates from NASS (county yields, Texas prices)
New `field.market` (see `/shared/data-format.md`).
- **Rotation cards:** ground the dollar estimate in `market.recent[]`. For each crop it has a 2021–2025
  yield, price and `grossPerAcreUsd` (already unit-converted). Show it as "≈ $X/acre gross (Ellis County yields,
  Texas prices, 2021–2025)". It is **gross revenue, not profit**; say so.
- **Show the level:** when `yieldLevel` is `district` or `state`, say "regional / Texas average yield". Texas
  state yields include irrigated High Plains fields and read high for dryland North Texas.
- **Crop ids:** `soybeans` and `oats` have NASS data but aren't in `crops.json`. `cowpea`, `cereal_rye`,
  `hairy_vetch`, `sorghum_sudangrass`, `sesame` and `fallow` have no NASS yield or price (cover crops: $0 or
  a forage value from experts). `alfalfa` has a hay price (`$/ton`) but no county yield.
- **Units:** sorghum yield is bu/acre but its price is $/cwt (1 bu = 56 lb = 0.56 cwt). Sunflower is lb/acre
  and $/cwt. `grossPerAcreUsd` already handles this; any app math on `yields[]`/`pricesTx[]` must too.
- **Oklahoma fields** (nt-056, nt-081, nt-148) use Oklahoma yields but Texas prices (`market.priceState`).
- **What-if sliders:** `pricesTx[]` gives the 2008–2025 price range for a realistic price slider.
- **Sources:** new `NASS Quick Stats` entry in `field.sources`; add it to `src` on money reasons and to
  `EVIDENCE` in `/scoring/scoreRotation.js`.
- **i18n (en + es):** "gross per acre", "county average yield", "regional average", "Texas average",
  "not profit: costs not included".

## 4. Sources metadata
`field.sources[]` keeps `dataset`, `variable`, `resolution`, `dateRange` unchanged (strings), so the Expert
handoff table and `<Receipt>` keep working. New optional keys: `id`, `name`, `product`, `provider`, `scale`
(`patch` | `area` | `county` | `state` | `model`), `resolutionM`, `startYear`, `endYear`.
- **Expert handoff / Receipt (optional):** show `scale` as "measured on your field" (`patch`) vs "regional
  value for your area" (`area`) vs "county average". This is the honest "what's local vs regional" message.
- New entries now in the list: `PRISM`, `NASS Quick Stats`. The SSURGO `variable` text now mentions erosion
  factors, available water and land capability.
- `/scoring/scoreRotation.js` `EVIDENCE`: add `PRISM` and `NASS Quick Stats` if reasons cite them.
