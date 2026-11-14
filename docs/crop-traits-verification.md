# Crop trait verification (content/crops.json)

Checked 2026-11-14 against published sources. **Status key:** ✅ supported by a source · ✏️ changed to match a source · ⚠️ still unverified (no source found yet; a human should check with Texas A&M AgriLife or NRCS)

The 1–5 scales are **our own scoring scales**. The sources give real numbers (mm of water, meters of root depth, lb of nitrogen), and the mappings below turn those into 1–5. Say so if a judge asks.

## How the scales map to sources

| Trait | Source | Mapping |
|---|---|---|
| `waterUse` (1–5) | FAO *Irrigation Water Management*, Table 5: seasonal crop water need (mm) [1] | ≤500 → 1 · 450–650 → 2 · 500–800 or 600–1000 → 3 · 700–1300 → 4 · 800–1600 → 5 |
| `rootDepth` | FAO-56, Table 22: max effective rooting depth Zr (m) [2] | max Zr ≥ 1.8 m → `deep` · 1.0–1.7 m → `medium` · ≤ 1.0 m → `shallow` |
| N fixed (lb/acre/yr) | SARE *Managing Cover Crops Profitably*, Chart 2 [3] | New field `nFixLbPerAcre`, used for the fertilizer-saved estimate |

## Results

| Crop | Trait | Was | Proposed | Status | Source |
|---|---|---|---|---|---|
| winter_wheat | waterUse | 2 | 2 | ✅ 450–650 mm | [1] |
| | rootDepth | medium | **deep** | ✏️ Zr 1.5–1.8 m | [2] |
| | forage / erosion | 4 / 4 | 4 / 4 | ⚠️ (grazeout wheat is common in TX; add an AgriLife cite) | |
| grain_sorghum | waterUse | 2 | 2 | ✅ 450–650 mm | [1] |
| | rootDepth | deep | deep | ✅ Zr 1.0–2.0 m | [2] |
| | heatTolerance | 5 | 5 | ⚠️ standard agronomy; add a cite | |
| cotton | waterUse | 3 | **4** | ✏️ 700–1300 mm (long season) | [1] |
| | rootDepth | deep | **medium** | ✏️ Zr 1.0–1.7 m | [2] |
| corn | waterUse | 5 | **3** (see note A) | ✏️ 500–800 mm | [1] |
| | rootDepth | medium | medium | ✅ Zr 1.0–1.7 m | [2] |
| cowpea | waterUse | 1 | 1 | ✅ bean 300–500 mm (closest FAO entry) | [1] |
| | rootDepth | medium | medium | ✅ Zr 0.6–1.0 m (borderline shallow) | [2] |
| | nitrogenFixing | true | true, **100–150 lb N/ac** | ✅ | [3] |
| | drought tolerance | — | very good | ✅ | [4] |
| | forageValue | 3 | **4** | ✏️ "Grazing quality: very good" | [4] |
| | erosionProtection | 3 | 3 | ✅ "Erosion control: good" | [4] |
| cereal_rye | erosionProtection | 5 | 5 | ✅ 3,000–10,000 lb dry matter/ac | [3] |
| | rootDepth | deep | deep | ⚠️ no FAO entry for rye grain | |
| hairy_vetch | nitrogenFixing | true | true, **90–200 lb N/ac** | ✅ | [3] |
| | other traits | | | ⚠️ | |
| sorghum_sudangrass | forageValue | 5 | 5 | ✅ 8,000–10,000 lb dry matter/ac | [3] |
| | rootDepth | deep | **medium** | ✏️ Sudan grass hay Zr 1.0–1.5 m | [2] |
| alfalfa | waterUse | 4 | **5** | ✏️ 800–1600 mm, highest of all crops | [1] |
| | rootDepth | deep | deep | ✅ Zr 1.0–3.0 m | [2] |
| sunflower | waterUse | 2 | **3** | ✏️ 600–1000 mm | [1] |
| | rootDepth | deep | **medium** (see note B) | ✏️ Zr 0.8–1.5 m | [2] |
| sesame | waterUse | 1 | 1 | ✅ "suitable for dryland production in Texas" | [5] |
| | heatTolerance | 5 | 5 | ✅ "drought tolerant, heat tolerant crop" | [5] |
| | rootDepth | deep | **medium** | ✏️ Zr 1.0–1.5 m | [2] |
| | market | oilseed | oilseed, **contract only** | ✏️ "All sesame in Texas is grown by contract" | [5] |

## Notes and risks to fix

**A. Split water use into two traits.** FAO's seasonal total puts corn (500–800 mm) *below* cotton (700–1300 mm), because cotton's season is longer. Texas farmers still think of corn as the thirsty, drought-sensitive crop, since corn is very sensitive to drought at pollination. One number can't capture both ideas. Recommendation:
- `seasonalWaterMm`: FAO range (how much water over the season)
- `droughtSensitivity` (1–5): how badly a dry spell hurts yield (corn high; sorghum, sesame, cowpea low). ⚠️ Needs an AgriLife cite.

**B. Sunflower roots.** FAO's 0.8–1.5 m is a conservative irrigation figure. Great Plains research often reports sunflower roots reaching deeper. Keep `medium` unless you find a cite.

**C. Sesame regional fit.** AgriLife lists dryland sesame for the High Plains, Rolling Plains, Concho Valley and Lower Rio Grande Valley, **not the Blackland Prairie** (Ellis County). Add a risk on sesame cards: "Grown by contract only; not a common crop in this region. Check with a buyer and your county agent."

**D. Side effect on scoring.** Changing root depths changes the `deepRoots` tag (it needs 2+ deep crops in the rotation). Run `npm run selftest` after applying these changes.

**E. Still unverified (⚠️):** heat tolerance scores (except sesame and cowpea), forage and erosion scores for wheat, sorghum, cotton, corn and sunflower, and most hairy vetch traits. Leave `"verified": false` at the top of crops.json, but mark each checked value. A per-trait `sources` field is the cleanest way to do that.

## Sources

1. FAO, *Irrigation Water Management Training Manual No. 3: Crop Water Needs*, Tables 4–5. https://www.fao.org/3/s2022e/s2022e02.htm
2. FAO Irrigation and Drainage Paper 56, Chapter 8, Table 22. https://www.fao.org/3/x0490e/x0490e0e.htm
3. SARE, *Managing Cover Crops Profitably*, Chart 2: Performance and Roles. https://www.sare.org/wp-content/uploads/chart2-performance-and-roles.pdf
4. USDA NRCS, Cowpea Crop Fact Sheet. https://www.nrcs.usda.gov/sites/default/files/2024-04/Cowpea%20Crop%20Fact%20Sheet.pdf
5. Texas A&M AgriLife, "Expanded Sesame Opportunities in Texas" (2022). https://agrilife.org/texasrowcrops/2022/03/04/expanded-sesame-opportunities-in-texas/
