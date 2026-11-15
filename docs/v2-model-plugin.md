# Plugging in your models (for Pranav)

You write one JSON file per field. The engine reads it. **Nothing else needs to change**: no app code, no engine code, no placeholder edits. Until a file exists, the engine uses fixed placeholders and the app tags those values "default value, field model coming".

The six scores the engine reports are final (decided by the team, Nov 14 2026): Profit, Risk, Soil, Water, Nutrients, Pests (`content/v2-scores.json`).

Full format and meaning of every key: `docs/v2-data-contract.md`, section 1. This page is the short version.

## 1. Where the file goes and what it is called
```
shared/v2/models/<field-id>.json        e.g. shared/v2/models/ec-251.json
```
One file for each of the 300 fields `ec-000` … `ec-299`. The `fieldId` inside the file must match the file name. A copy of the exact format with invented numbers: `shared/v2-sample/model-example.json`.

## 2. The five sections
Put in only the sections you have. A missing section keeps its placeholder; a section with an error is ignored and reported (never half used).

```jsonc
{
  "schemaVersion": 1,
  "fieldId": "ec-251",
  "generatedAt": "2026-11-15T09:00:00Z",
  "modelVersions": { "A": "a-0.3", "B": "b-0.2", "C": "c-0.1", "D": null, "E": "e-0.1" },
  "modelA": { "cropByYear": [...], "cropDates": {...}, "bareWindows": [...] },
  "modelB": { "crops": {...}, "stressOutlook": {...} },
  "modelC": { "yearTypes": [...], "frequencies2040": {...} },
  "modelD": { "rootZoneFraction": 0.38, "asOf": "2026-11-13" },
  "calibrationE": { "crops": {...} }
}
```

| Section | What you give | Units and ranges |
|---|---|---|
| `modelA` | `cropByYear[]` `{year, crop, confidence, labelSource}`; `cropDates.<crop>` `{plantYearOffset, plantDoy, greenUpDoy, peakDoy, endDoy, endKind, rangeDays}`; optional `bareWindows[]` `{start, end}` | `confidence` 0 to 1 or `null`; days are day of year 1 to 366; `plantYearOffset` 0 or -1 (-1 = planted the autumn before); `endKind` `harvest` or `terminate`; dates `YYYY-MM-DD`. Leave `bareWindows` out and the engine derives them from your crops and dates |
| `modelB` | `crops.<crop>` `{droughtKy, heatLossPerDay, heatThresholdC}`; optional `stressOutlook` `{asOf, months[{month, chance, low, high, reasons}]}` | `droughtKy` ≥ 0 (1.0 = FAO-33 style: yield drops as fast as water supply); `heatLossPerDay` 0 to 1 (share of yield lost per day over the threshold); `heatThresholdC` in °C; `chance`, `low`, `high` 0 to 1 with `low <= chance <= high` (90% range); `month` is `YYYY-MM` |
| `modelC` | `yearTypes[]` `{year, type, probability}` (1985 to 2025); `frequencies2040` `{ssp245, ssp585}` each `{drought, hot, wet, normal}` | `type` is exactly `drought`, `hot`, `wet` or `normal`; probabilities 0 to 1; each 2040 mix adds up to 1 |
| `modelD` | `rootZoneFraction`, `asOf`, optional `daily[{date, fraction}]` | 0 to 1 = share of the soil's plant-available water (0 wilting point, 1 field capacity) |
| `calibrationE` | `crops.<crop>` `{typicalYield, unit, wpScale?, heatThresholdOffsetC?}`; optional top-level `wpScale`, `heatThresholdOffsetC`, `regionId`, `fitYears`, `testYears`, `metrics` | `typicalYield` ≥ 0 in the stated `unit` (`bu/acre`, `lb lint/acre`, `lb/acre`, `tons hay/acre`, `lb biomass/acre`); `wpScale` > 0 (1 = textbook); `heatThresholdOffsetC` in °C |

Crop ids (same everywhere): `winter_wheat`, `corn`, `grain_sorghum`, `cotton`, `soybeans`, `sunflower`, `sesame`, `alfalfa`, `cowpea`, `sorghum_sudangrass`, `cereal_rye`, `crimson_clover`, `hairy_vetch`, `fallow`. The USDA label `other` may appear in `cropByYear`; give it no calendar. A crop you do not list in B or E keeps the default (B) or has no typical yield (E): list every crop you want the engine to use on that field.

## 3. Test that your file is read
From the repo root:
```
node scoring/tools/checkModelFile.mjs shared/v2/models/ec-251.json
```
It prints one line per slot, `MODEL` or `placeholder`, lists every problem found, and ends with `OK` (exit code 0) or `FAIL` (exit code 1):
```
MODEL        modelA
MODEL        modelB
MODEL        modelC
placeholder  modelD  (section not in file)
MODEL        calibrationE

OK: 4 slot(s) read from the file for ec-251. Placeholders left: modelD.
```
To see that the engine really uses it, change one value (say `modelD.rootZoneFraction` from 0.5 to 0.1) and rerun the precompute (step B3 script): the field's output file `shared/v2/fields/ec-251.json` then has `slots.sources.modelD: "model"` and `modelD` is no longer in `slots.placeholderSlots`. Code check of the whole slot layer: `node scoring/selftest-modelslots.js`.

Common reasons a section is ignored (all reported by the tool): wrong `schemaVersion` (must be 1), `fieldId` does not match the field, a number out of range (percent instead of 0 to 1), a year type spelled differently, 2040 mix not adding to 1, a date not in `YYYY-MM-DD`.

## 4. What happens next, and what does not need to change
1. Write your files into `shared/v2/models/`.
2. Run the precompute script (Terminal B, step B3). Every output that used a placeholder now uses your values, and `placeholderSlots` shrinks.
3. The app shows the new numbers and drops the "default value, field model coming" tag for the slots you delivered.

Not needed: any change in `/app`, `/scoring`, `content/model-placeholders.json` or the crop library. Do not edit the placeholders to "plug in" a model; put the file in `shared/v2/models/`. The placeholders stay as the fallback for fields without a file.

Please do not use these numbers for claims before the report card (`shared/v2/validation.json`) shows the checks for your model. Tell the team when a model is plugged in, so the submission text can say which slots are real.
