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
