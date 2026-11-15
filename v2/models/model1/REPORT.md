# Model 1: crop per field per year (Field Shift v2, North Texas)

## Current model (round 2): tuned gradient-boosted trees + 1D CNN, averaged

**Headline:** on unseen years 2020–2025 the model is right **83.0%** of the time across 9 crop classes, and **87.3%** across the 6 grouped classes. On fields where the USDA label is at least 95% pure it reaches **88.8%**. On the unseen county (Hill) it reaches **94.7%**. The "same crop as last year" baseline scores 43%.

**Test protocol (same as round 1, each step scored on the same rows):**
- **Training:** 2008–2019 in five counties.
- **Tests:** never trained on. Unseen years 2020–2025 (n = 7,418 clean / 8,309 all) and Hill County (n = 4,993).

| Step | Unseen years, clean | Unseen years, all labels | Very clean (≥ 95%) | Grouped | Balanced | Hill |
|---|---|---|---|---|---|---|
| 1 round-1 features | 78.4% | 74.5% | 84.3% | 85.2% | 53.7% | 92.8% |
| 2 dense series + phenology | 80.4% | 76.2% | 86.4% | 85.6% | 53.9% | 92.9% |
| 3 + weather (GDD, rain) | 80.3% | 76.2% | 86.5% | 86.0% | 54.2% | 93.5% |
| 4 all features | 81.1% | 76.8% | 87.1% | 86.5% | 56.6% | 94.0% |
| 5 + train on purity >= 0.9 | 81.0% | 76.8% | 87.2% | 86.1% | 53.5% | 94.1% |
| 6 + balanced class weights | 78.7% | 74.6% | 84.8% | 85.1% | 57.0% | 93.5% |
| 7 + rotation context | 81.6% | 77.3% | 87.5% | 86.5% | 56.3% | 94.6% |
| 8 tuned | 81.9% | 77.6% | 88.0% | 86.7% | 56.9% | 94.8% |
| 9 1D CNN | 81.0% | 76.3% | 86.8% | 85.8% | 65.0% | 93.6% |
| 10 ensemble (tuned trees + CNN) | 83.0% | 78.6% | 88.8% | 87.3% | 59.8% | 94.7% |

**What helped:**
- **Dense series:** NDVI / NDTI / BSI gap-filled onto a 10-day grid from October of the year before, using Landsat plus HLS L30 and S30. Fields average 72 clear views a year since 2013 instead of 29.
- **Combining feature sets:** the round-1 features plus the dense curve features together.
- **Rotation context:** crop probabilities for the year before, the year after and two years before. They come from models that never saw that field, so no USDA label leaks in.
- **Tuning:** chosen by cross-validation grouped by year on 2008–2019 only (`{'learning_rate': 0.04, 'max_leaf_nodes': 63, 'min_samples_leaf': 60, 'l2_regularization': 1.0}`).
- **Averaging with a 1D CNN:** the CNN catches rare crops (balanced accuracy 65%) that the trees miss.

**What didn't help:**
- **Weather timing (degree days at green-up and peak, seasonal rain):** helped only in combination with other features.
- **Training only on purity ≥ 0.9:** no gain, so purity ≥ 0.7 is kept.
- **Balanced class weights:** −2 points overall.

**What limits it:** the USDA labels themselves. Accuracy rises steadily with label purity: 52% on 70–80% pure fields, 84% on fields at least 95% pure (round 1). CDL is least reliable on the same classes the model finds hardest: fallow vs grass, sorghum vs corn, oats vs wheat.

**Final model:** refit on every clean USDA label in all 6 counties, 2008–2025 (`final.py`).
- **`model1_v2_trees.joblib`** and **`model1_v2_cnn.pt`**: the two halves of the ensemble.
- **`predictions_v2.csv.gz`**: every field-year 1985–2025, with:
  - `pred`, `confidence`, `pred_group`
  - per-class probabilities `p_*`
  - `final`: the USDA label where it is clean, the model's crop otherwise
  - `source`: which of the two `final` came from

**Build order:** `features.py` → `features_v2.py` → `train_v2.py` (ablation, all test numbers) → `final.py`.

---

## Round 1 (kept for comparison)

Gradient-boosted trees (scikit-learn `HistGradientBoostingClassifier`) on Landsat season-curve features + SSURGO soil.
1,711 fields in 6 Blackland counties, 1985–2025. Built by `features.py` → `train.py` from the v2 Earth Engine exports.

**Features (per field-year, 70):**
- Median NDVI / NDTI / BSI for each month from October of the year before through December, so fall-planted wheat is seen.
- Winter, spring and summer greenness, peak day, green-up and dry-down days, greenness range.
- Summer surface temperature.
- Clear-scene count.
- Soil: clay, sand, organic matter, water holding, pH, Ksat, slope, K factor.

**Clear scenes:** each scene must have at least 70% of the field's pixels clear and under 5% snow.

**Labels:** the USDA CDL majority class per field-year, 2008–2025. Training uses only field-years where at least 70% of pixels agree (purity), and the "other" and "noncrop" classes are dropped.

**Training:** 2008–2019, five counties, 14,784 field-years. **Hill County is never used for training.**

## Results (each test scored once)

| Test | Field-years | Model | Grouped (6 classes) | Balanced | Same as last year | Curve rules | Most common crop |
|---|---|---|---|---|---|---|---|
| Unseen years 2020–2025, clean labels | 7,418 | **78.4%** | 85.2% | 53.7% | 43.2% | 46.5% | 22.5% |
| Unseen years 2020–2025, all labels | 8,309 | **74.5%** | 81.4% | 51.1% | 42.9% | 43.8% | 22.4% |
| Unseen county (Hill), clean | 4,993 | **92.8%** | 96.2% | 57.8% | 33.0% | 62.6% | 22.8% |
| Unseen county (Hill), all | 5,400 | **90.9%** | 94.9% | 55.9% | 33.2% | 60.3% | 22.9% |
| Hill and 2020–2025 (unseen both ways) | 1,722 | **90.6%** | 95.0% | 67.4% | 44.9% | 65.1% | 19.1% |

**Grouped classes:** winter grain (wheat + oats), summer grain (corn + sorghum), cotton, grass/hay, fallow, soybeans.

**Baseline caveat:** "Same as last year" uses the previous year's USDA label. The model never sees a label for the year it predicts, so this baseline is stronger than what the model gets.

**Grouped cross-validation by year (2008–2019):** 74.9%, 77.0%, 83.3%, 74.3%, mean **77.4%**.

**Why Hill scores higher than the unseen years:** this is crop mix, not leakage. In 2020–2025 Hill's clean fields are 62% corn, the easiest class, against 37% in the other counties. The other counties have more hay, fallow and sorghum, which are harder.

### Per class (unseen years, clean labels)

| Class | Recall | Precision | n |
|---|---|---|---|
| corn | 90% | 90% | 2,728 |
| wheat | 92% | 78% | 1,668 |
| hay_grass | 75% | 84% | 1,134 |
| cotton | 74% | 82% | 703 |
| sorghum | 64% | 42% | 429 |
| fallow | 15% | 40% | 357 |
| small_grain | 34% | 62% | 293 |
| soybeans | 40% | 24% | 85 |
| sunflower | 0% | 0% | 21 |

**Weak spots:**
- **Fallow:** recall 15%. It is mistaken for corn, cotton and wheat, so a "fallow" CDL label often has weeds or volunteers on it.
- **Oats → wheat:** oats are called wheat, a confusion that doesn't matter in the grouped classes.
- **Sorghum ↔ corn:** sorghum precision is 42%; corn is called sorghum.
- **Soybeans and sunflower:** too few fields to learn well.

## Does Sentinel-2 red-edge help?

Both versions use the same rows: trained on 2016–2019, tested on 2020, 2021, 2022, 2023, 2025. There is no 2024 Sentinel-2 file, so 2024 is left out.

| | Accuracy | Grouped | Balanced | Corn vs sorghum (n=2,706) |
|---|---|---|---|---|
| Landsat only | 77.7% | 85.0% | 54.3% | 84.8% |
| + Sentinel-2 red-edge | 78.7% | 85.9% | 54.0% | 85.6% |

Red-edge adds about 1 point. The main model stays Landsat-only, because Landsat covers every year 1985–2025 and red-edge exists only from 2016.

## Outputs

- **`model1.joblib`:** the final model, refit on every clean labelled field-year in all 6 counties, 2008–2025.
- **`predictions.csv.gz`:** one row per field-year, 1985–2025, with these columns:
  - `pred` (the model's crop), `confidence` (its probability), `pred_group` (grouped class)
  - `cdl` (USDA label) and `purity`
  - `final`: the USDA label where it is clean, the model's crop otherwise
  - `source`: which of the two `final` came from
- **`metrics.json`:** every number above, plus the confusion matrix.

**Honest use:** in the app, show the USDA label where it exists. Before 2008, show `pred` with its confidence and the unseen-year accuracy above.
