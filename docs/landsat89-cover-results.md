# Landsat 8/9-only cover: results

*Branch `landsat89-cover`. Tables from `pipeline/compare_l89.py` (rerun it after a data refresh). Format of the new keys:
`/shared/data-format.md` "v3 additions". App changes: `/docs/app-changes-needed.md` §5.*

## Why
For the same field and month, Landsat 7 reads NDVI about **0.05 lower** than Landsat 8 (overlap test on branch
`landsat-harmonize`). A published correction (Roy et al. 2016) was tried and rejected (`/docs/datasets.md`). Our monthly
values blend Landsat 7 into the median until ~2023, so the old bare days are too high **after 2013 too**, not just before.

## What changed
- **New data:** `pipeline/data/fields/landsat_monthly_l89.csv`: Landsat 8 and 9 only, April 2013–2025, same cloud mask,
  45 m buffer and monthly median as before (`sample_fields.py landsat_l89`).
- **New keys** in every `shared/fields/<id>.json`: `ndviMonthlyL89`, `coverYearlyL89` (2013+, Jan–Mar 2013 `null`),
  `bareDaysPerYearL89` (2014+), `quality.cloudyMonthsPctL89`, and a `Landsat 8/9` source.
- **New file:** `shared/crop-calendars-l89.json`, per-crop bare-month calendars, 2014–2025.
- **Flags:** existing `coverYearly` / `bareDaysPerYear` entries gain `sensor` and `lowConfidence` (`true` before 2013,
  reason `sensorMismatch`). **No existing value changed.** `schemaVersion` 2 → 3.

## Headline numbers
- **All fields, 2014–2025** (same 2,351 field-years): median bare days **91 → 55** a year (mean 94 → 63). The new value is
  lower in 70% of field-years.
- **nt-103, 2014–2025:** mean **114 → 78** bare days a year. The biggest changes are 2015 (162 → 54) and 2016 (174 → 50).
- **The decline in MODELS.md was mostly the sensor.** Landsat 8/9-only medians are 53–62 in 2014–2015 and 56–66 in 2024–2025.
  The old record fell from ~130 to ~60 over the same years as Landsat 7 dropped out.
- **Per-crop calendars get much less bare.** Corn ≈ 133 → 94 bare days, winter wheat 88 → 60, cotton 95 → 54,
  sorghum 113 → 60. Same months, lower shares. The shape of each calendar is unchanged.
- **Cost: more cloudy months.** Missing months rise from 6.2% to 15.9% (2014–2021 is worst, up to 30%). Only **49 of
  2,400** field-years lose their bare-day number (fewer than 9 clear months even after filling gaps of up to 2 months). nt-103: 3 → 10 missing months.
- **Before 2013:** there's no Landsat 8/9, so those years keep their old values, now flagged low confidence.
  Old 2008–2012 median: 164 bare days.

_200 sampled fields (nt-001…nt-200). Demo field: nt-103._

## Cloudy / missing months

A month is missing when no clear Landsat pixel was seen that month. 2013 counts April–December only.

| year | missing old % | missing new % | scenes/month old | scenes/month new |
|---|---|---|---|---|
| 2013 | 10.7 | 25.3 | 28.8 | 14.3 |
| 2014 | 6.8 | 29.6 | 28.1 | 14.3 |
| 2015 | 6.2 | 24.1 | 27.8 | 14.2 |
| 2016 | 7.3 | 18.1 | 29.2 | 14.9 |
| 2017 | 4.1 | 14.5 | 29.8 | 15.6 |
| 2018 | 12.5 | 25.9 | 28.9 | 13.4 |
| 2019 | 3.6 | 12.0 | 31.3 | 15.2 |
| 2020 | 6.0 | 17.6 | 28.9 | 13.7 |
| 2021 | 11.7 | 26.7 | 30.4 | 16.2 |
| 2022 | 0.2 | 1.5 | 46.8 | 31.6 |
| 2023 | 3.2 | 4.1 | 43.6 | 29.2 |
| 2024 | 5.9 | 5.9 | 28.7 | 28.7 |
| 2025 | 3.5 | 3.5 | 30.0 | 30.0 |
| all | 6.2 | 15.9 | 31.8 | 19.4 | 

Dropping Landsat 7 adds **2,964 missing field-months** of 30,600 (6.2% → 15.9%).

Field-years 2014–2025 with a bare-day number (≥ 9 clear months): old **2,400**, new **2,351** of 2,400 (49 lost to clouds).

nt-103: 3 → 10 missing months of 153 (April 2013–2025). Years with a bare-day number 2014–2025: old 12, new 12.

## Bare days per year

Days with NDVI < 0.25 (monthly values interpolated to daily). Old = current `bareDaysPerYear` (mixed sensors). New = `bareDaysPerYearL89` (Landsat 8/9 only, from 2014). Before 2013 there is no new value; those years are now flagged `lowConfidence`.

**nt-103**

| year | CDL crop | old | new | change | flag |
|---|---|---|---|---|---|
| 2008 | cotton | 127 | – | – | low confidence (L5/L7) |
| 2009 | winter_wheat | 147 | – | – | low confidence (L5/L7) |
| 2010 | grain_sorghum | 223 | – | – | low confidence (L5/L7) |
| 2011 | cotton | 231 | – | – | low confidence (L5/L7) |
| 2012 | winter_wheat | 230 | – | – | low confidence (L5/L7) |
| 2013 | other | 110 | – | – | partial year, no new value |
| 2014 | corn | 165 | 156 | -9 |  |
| 2015 | cotton | 162 | 54 | -108 |  |
| 2016 | corn | 174 | 50 | -124 |  |
| 2017 | cotton | 117 | 74 | -43 |  |
| 2018 | corn | 150 | 93 | -57 |  |
| 2019 | cotton | 31 | 20 | -11 |  |
| 2020 | grain_sorghum | 149 | 92 | -57 |  |
| 2021 | corn | 145 | 139 | -6 |  |
| 2022 | cotton | 77 | 61 | -16 |  |
| 2023 | corn | 101 | 103 | 2 |  |
| 2024 | cotton | 0 | 0 | 0 |  |
| 2025 | corn | 93 | 93 | 0 |  | 

nt-103, 2014–2025, years with both: mean old **114**, new **78** bare days/yr. (Old 2008–2012 mean: 192.)

**All fields** (median across fields; 'same field-years' = only field-years that have both numbers)

| year | median old | median new | median old (same field-years) | median new (same field-years) | field-years old | field-years new |
|---|---|---|---|---|---|---|
| 2008 | 176 | – | – | – | 200 | 0 |
| 2009 | 143 | – | – | – | 200 | 0 |
| 2010 | 137 | – | – | – | 200 | 0 |
| 2011 | 192 | – | – | – | 200 | 0 |
| 2012 | 168 | – | – | – | 200 | 0 |
| 2013 | 130 | – | – | – | 200 | 0 |
| 2014 | 127 | 62 | 125 | 62 | 200 | 187 |
| 2015 | 115 | 53 | 114 | 53 | 200 | 191 |
| 2016 | 94 | 36 | 94 | 36 | 200 | 200 |
| 2017 | 85 | 37 | 85 | 37 | 200 | 200 |
| 2018 | 113 | 62 | 113 | 62 | 200 | 199 |
| 2019 | 118 | 60 | 118 | 60 | 200 | 200 |
| 2020 | 60 | 32 | 61 | 32 | 200 | 197 |
| 2021 | 68 | 39 | 68 | 39 | 200 | 177 |
| 2022 | 122 | 100 | 122 | 100 | 200 | 200 |
| 2023 | 79 | 64 | 79 | 64 | 200 | 200 |
| 2024 | 66 | 66 | 66 | 66 | 200 | 200 |
| 2025 | 56 | 56 | 56 | 56 | 200 | 200 | 

All fields 2014–2025, same field-years (n = 2,351): median old **91**, new **55**; mean old 94, new 63; new lower in 70% of field-years. For comparison, old 2008–2012 median: 164.

Check: 2024–2025 (almost no Landsat 7 left), old vs new median 62 vs 62, identical in 100% of field-years.

## Per-crop bare-month calendars

Share of field-years each month was bare, for field-years where CDL says that crop. Old = how `scoring/tools/build_calendars.mjs` computes `bareShare` today (`coverYearly`, 2013–2025, mixed sensors; 2013+ cover comes from model 1). New = `shared/crop-calendars-l89.json` (`coverYearlyL89`, 2014–2025). '≈ bare days' = Σ share × days in month.

**All fields**

| crop | version | field-years (max clear) | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec | ≈ bare days |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| corn | old (2013-25) | 1003 | 0.61 | 0.56 | 0.47 | 0.07 | 0.01 | 0.01 | 0.12 | 0.41 | 0.52 | 0.63 | 0.49 | 0.48 | 133 |
| corn | new (2014-25) | 934 | 0.43 | 0.35 | 0.32 | 0.03 | 0.01 | 0.01 | 0.08 | 0.29 | 0.36 | 0.51 | 0.38 | 0.34 | 94 |
| winter_wheat | old (2013-25) | 818 | 0.06 | 0.05 | 0.02 | 0.01 | 0.05 | 0.21 | 0.31 | 0.48 | 0.47 | 0.55 | 0.33 | 0.35 | 88 |
| winter_wheat | new (2014-25) | 743 | 0.03 | 0.03 | 0.01 | 0.01 | 0.04 | 0.08 | 0.23 | 0.34 | 0.32 | 0.43 | 0.22 | 0.22 | 60 |
| cotton | old (2013-25) | 187 | 0.61 | 0.54 | 0.51 | 0.31 | 0.25 | 0.04 | 0.00 | 0.00 | 0.03 | 0.20 | 0.28 | 0.36 | 95 |
| cotton | new (2014-25) | 173 | 0.42 | 0.38 | 0.35 | 0.16 | 0.09 | 0.02 | 0.00 | 0.00 | 0.01 | 0.09 | 0.16 | 0.13 | 54 |
| grain_sorghum | old (2013-25) | 187 | 0.58 | 0.57 | 0.48 | 0.25 | 0.04 | 0.01 | 0.01 | 0.10 | 0.37 | 0.47 | 0.45 | 0.41 | 113 |
| grain_sorghum | new (2014-25) | 158 | 0.31 | 0.28 | 0.22 | 0.09 | 0.01 | 0.00 | 0.00 | 0.05 | 0.13 | 0.29 | 0.29 | 0.31 | 60 |
| soybeans | old (2013-25) | 66 | 0.52 | 0.44 | 0.38 | 0.17 | 0.08 | 0.02 | 0.03 | 0.14 | 0.26 | 0.42 | 0.29 | 0.29 | 91 |
| soybeans | new (2014-25) | 61 | 0.36 | 0.24 | 0.25 | 0.08 | 0.02 | 0.00 | 0.02 | 0.10 | 0.10 | 0.28 | 0.22 | 0.20 | 56 |
| small_grain | old (2013-25) | 69 | 0.01 | 0.04 | 0.01 | 0.03 | 0.10 | 0.13 | 0.17 | 0.33 | 0.38 | 0.39 | 0.25 | 0.14 | 61 |
| small_grain | new (2014-25) | 65 | 0.00 | 0.03 | 0.00 | 0.00 | 0.10 | 0.08 | 0.14 | 0.28 | 0.20 | 0.31 | 0.15 | 0.13 | 43 |
| fallow | old (2013-25) | 179 | 0.40 | 0.35 | 0.21 | 0.12 | 0.11 | 0.11 | 0.17 | 0.30 | 0.28 | 0.44 | 0.30 | 0.24 | 92 |
| fallow | new (2014-25) | 178 | 0.31 | 0.21 | 0.08 | 0.06 | 0.07 | 0.04 | 0.11 | 0.19 | 0.15 | 0.32 | 0.21 | 0.16 | 58 |
| other | old (2013-25) | 78 | 0.51 | 0.50 | 0.44 | 0.06 | 0.03 | 0.03 | 0.01 | 0.04 | 0.19 | 0.12 | 0.12 | 0.33 | 72 |
| other | new (2014-25) | 65 | 0.44 | 0.38 | 0.26 | 0.06 | 0.00 | 0.00 | 0.00 | 0.00 | 0.05 | 0.06 | 0.12 | 0.30 | 50 | 

**nt-103** (one field: 2–6 years per crop, so read these as anecdotes)

| crop | version | field-years (max clear) | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec | ≈ bare days |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| corn | old (2013-25) | 6 | 0.50 | 0.50 | 0.67 | 0.33 | 0.00 | 0.00 | 0.00 | 0.50 | 0.50 | 0.67 | 0.67 | 0.67 | 152 |
| corn | new (2014-25) | 6 | 0.50 | 0.50 | 0.67 | 0.00 | 0.00 | 0.00 | 0.00 | 0.50 | 0.50 | 0.67 | 0.50 | 0.33 | 127 |
| cotton | old (2013-25) | 5 | 0.60 | 0.40 | 0.60 | 0.20 | 0.40 | 0.00 | 0.00 | 0.00 | 0.00 | 0.40 | 0.00 | 0.40 | 92 |
| cotton | new (2014-25) | 5 | 0.20 | 0.40 | 0.40 | 0.40 | 0.20 | 0.00 | 0.00 | 0.00 | 0.00 | 0.20 | 0.00 | 0.00 | 54 |
| grain_sorghum | old (2013-25) | 1 | 1.00 | 0.00 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 | 1.00 | 123 |
| grain_sorghum | new (2014-25) | 1 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 | 1.00 | 92 |
| other | old (2013-25) | 1 | 1.00 | 1.00 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 | 0.00 | 0.00 | 0.00 | 120 | 
## Checks
- **SI models untouched:** `pipeline/models/results/*` and `shared/si/*` (207 files) are **byte-identical** before and after
  (sha256). Model 1 still reads 0.773 accuracy, 0.543 balanced accuracy. Nothing was retrained.
- **Old keys untouched:** in all 202 field files, removing the new keys, flags, source and `schemaVersion` gives JSON
  **identical** to before. Before starting, the unchanged `build_fields.py` reproduced the committed files byte for byte.
- **Method check:** in 2024–2025, when almost no Landsat 7 is left, the old (model 1) and new (direct) monthly cover states agree in
  **4,788 of 4,788** months, and bare days agree in 100% of field-years. The only method difference is 12 cloudy
  months that the new key leaves `null` and model 1 gap-filled.
- **Sanity:** 2013 Jan–Mar are `null` in `coverYearlyL89` for every field. The calendars file matches the counting in
  `build_calendars.mjs`.

## Caveats
- **12 full years** (2014–2025) for calendars and averages. Fewer than the mixed record's 18, but all from one sensor family.
- **Model 1 still uses the mixed record.** Its crop calls and `coverYearly.months` are unchanged. Retraining it on
  Landsat 8/9 only would be a separate decision with a new accuracy report.
- **The 0.25 cutoff is still fixed.** Bare North Texas soil reads close to 0.25, so bare days stay sensitive to small shifts.
