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
