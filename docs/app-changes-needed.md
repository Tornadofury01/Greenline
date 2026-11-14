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

## 5. Bare days and cover from Landsat 8/9 only (`landsat89-cover`)
**Why:** Landsat 7 reads NDVI about 0.05 lower than Landsat 8 for the same field and month. It's mixed into the monthly
values until ~2023, so the current bare days for **2013–2023 are also too high**, not just pre-2013. A published correction was
tried and rejected (`/docs/datasets.md`). The new keys use Landsat 8/9 only. Across all fields, 2014–2025 median bare
days go from **91 to 55** a year. Numbers: `/docs/landsat89-cover-results.md`. Format: `/shared/data-format.md` "v3 additions".
All changes are additive, so the app keeps working untouched.

**Switch to the new keys**
- **Bare days** (headline "about N months bare", `climateStats().avgBareDays` in `display.js`, the FieldStory bare-day
  chart and score, and `recentBareDays()` in `scoring/rules/helpers.js`): read `field.bareDaysPerYearL89` instead of
  `bareDaysPerYear`. Fall back to the old key when the L89 key is missing (the fake sample has both).
- **Cover timeline / shares** (`coverShares()`, FieldStory timeline rows, `typicalBareMonths()`): use
  `field.coverYearlyL89` for 2013+ and `field.coverYearly` only for years before 2013. In 2013, Jan–Mar are `null` in the
  L89 key (before Landsat 8). Show them as "no image", not as cloudy.
- **`usuallyBareMonths()`:** read `field.ndviMonthlyL89` instead of `ndviMonthly` filtered by `SENSOR_YEAR`.
- **Per-crop calendars (`scoring/tools/build_calendars.mjs` → `crops.json` `bareShare`):** read
  `/shared/crop-calendars-l89.json` (`crops.<cdlClass>.bareShare`, 2014–2025) instead of counting `coverYearly`. Or keep
  the script and switch it to `coverYearlyL89` with `FROM = 2014`. It's the same counting, and the results match the file.
  Then rerun `node scoring/selftest.js`. Data-driven calendars get much less bare, e.g. corn ≈ 133 → 94 bare days,
  sorghum 113 → 60, cotton 95 → 54, wheat 88 → 60. **Rotation scores that use `bareShare` will change.** The
  `gl-landsat-cdl` source text should say "Landsat 8/9, 2014–2025".
- **Sources / receipts:** cite `"Landsat 8/9"` (new `sources[]` entry `id: "landsat89"`) on bare-day reasons. Add it to
  `EVIDENCE` in `/scoring/scoreRotation.js` if reasons cite it.

**Show pre-2013 values as low confidence**
- Entries in `coverYearly[]` and `bareDaysPerYear[]` now have `lowConfidence` (`true` before 2013), `sensor`
  (`"L5/L7"` / `"L7+L8/L9"`) and `lowConfidenceReason: "sensorMismatch"`. Where pre-2013 years are shown (the 40-year
  timeline, "replay a bad year" for 2011), use a muted style or hatch, plus a "low confidence: older satellite" tag that
  links to the glossary note. Don't mix those years into averages or scores. The sample field has the same flags.
- `SENSOR_YEAR` (2013) can stay as the visual line. Bare-day numbers now really start in **2014** (2013 is a partial year).
- **Expect more cloudy months.** Dropping Landsat 7 raises missing months from 6% to 16% (2013–2021 is worst).
  `quality.cloudyMonthsPctL89` can replace `cloudyMonthsPct` in the confidence score for bare-day reasons.

**Text (i18n, en + es).** Suggested wording, adjust freely:
- `glossary.sensor2013.text` ("Why 2013 matters"):
  - en: "Landsat 7 sees plant greenness lower than Landsat 8 and 9, by about 0.05 NDVI on the same field and month. With a
    fixed cutoff for “bare”, that alone adds bare days. So every bare-day number here uses Landsat 8 and 9 only, from 2014
    on. Years before 2013 had only the older satellites. We show them, marked low confidence, but don't use them in scores.
    Older years are still used for rain and heat history."
  - es: "Landsat 7 ve el verdor de las plantas más bajo que Landsat 8 y 9, unos 0,05 de NDVI en la misma parcela y mes.
    Con un límite fijo para “desnudo”, eso solo suma días desnudos. Por eso todos los días desnudos aquí usan solo
    Landsat 8 y 9, desde 2014. Los años antes de 2013 solo tenían los satélites antiguos. Los mostramos marcados como de
    baja confianza, pero no los usamos en los puntajes. Los años anteriores se siguen usando para el historial de lluvia y calor."
- `story.timelineNote`:
  - en: "Crop names start in 2008 (USDA crop maps). Bare and green time before 2013 comes from older satellites and is low confidence."
  - es: "Los nombres de cultivos empiezan en 2008 (mapas de cultivos del USDA). El tiempo desnudo y verde antes de 2013 viene de satélites antiguos y es de baja confianza."
- `story.sensorNote`:
  - en: "Before 2013 only older satellites were flying. They read fields as less green, so bare time looks higher than it was. Treat those years as rough."
  - es: "Antes de 2013 solo había satélites antiguos. Ven las parcelas menos verdes, así que el tiempo desnudo parece mayor de lo que fue. Tome esos años como aproximados."
- `reasons.sensorChange` (or wherever the `"Bare-day numbers use satellite data from 2013 on…"` key lives):
  - en: "Bare-day numbers use Landsat 8 and 9 only, from 2014 on, so all years are measured the same way."
  - es: "Los días desnudos usan solo Landsat 8 y 9, desde 2014, así que todos los años se miden igual."
- New label for the low-confidence tag: en "Low confidence: older satellite" / es "Baja confianza: satélite antiguo".
