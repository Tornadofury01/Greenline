# Crop trait verification, round 2: drought sensitivity and cover-crop water

Checked 2026-11-14. Fills the gaps Claude listed after round 1. Apply to `content/crops.json`.

## Drought sensitivity (`droughtSensitivity`, 1–5)

**Main source [A]:** FAO, *Irrigation Water Management*, Ch. 2 "The influence of water shortages on yields", Table 1, "Sensitivity of various field crops to water shortages". It sorts crops into four classes.
**Backup numbers [B]:** FAO yield response factor Ky for the whole season. A higher Ky means yield drops more for the same water shortfall.

**Mapping:** FAO Low → 1 · Low-Medium → 2 · Medium-High → 4 · High → 5

| Crop | Was | New | Status | Evidence |
|---|---|---|---|---|
| winter_wheat | 2 | 2 | ✅ | FAO Low-Medium [A]; Ky 1.00 [B] |
| grain_sorghum | 1 | 1 | ✅ | FAO Low [A] |
| cotton | 2 | **1** | ✏️ | FAO Low [A]; Ky 0.85 [B] |
| corn | 5 | **4** | ✏️ | FAO Medium-High [A]; Ky 1.25, the highest of our crops [B] |
| alfalfa | 3 | **2** | ✏️ | FAO Low-Medium [A] |
| sunflower | 2 | 2 | ✅ | FAO Low-Medium [A]; Ky 0.95 [B] |
| cereal_rye | 2 | **1** | ✏️ | "More cold- and drought-tolerant than wheat"; germinates in fairly dry soil [C] |
| sorghum_sudangrass | 1 | 1 | ✅ | Waxy leaves, less leaf area than corn; "can withstand drought by going nearly dormant" [D] |
| hairy_vetch | 3 | 3 | ⚠️ partial | "More drought tolerant than other vetches" but needs moisture to establish [E]. This only compares it to other vetches, so there's no absolute class. Keep 3 and mark it as an estimate |
| cowpea, sesame | — | — | ✅ (round 1) | |

Note on corn: FAO puts corn in "Medium-High", not "High". It's still the most drought-sensitive crop in our library, which matches what farmers expect.

## Seasonal water for cover crops (`seasonalWaterMm`)

FAO has no seasonal water table entries for these cover crops.

| Crop | Value | Status | Reasoning |
|---|---|---|---|
| cereal_rye | [450, 650] | ✅ proxy | FAO Table 5 lists "Barley/Oats/Wheat" as one small-grain group, and rye is a small grain. Cite it as "FAO small-grain category (proxy)" |
| sorghum_sudangrass | [450, 650] | ✅ proxy | FAO "Sorghum/Millet" 450–650 mm, the same species group |
| hairy_vetch | [450, 650] | ⚠️ estimate | No FAO entry or close relative. A Texas Tech SARE study [F] found winter cover crops (including vetch and rye) needed no more water than winter fallow and didn't reduce soil water for the next summer crop. That supports "not a big water user", but not a number |

## Useful finding for the pitch and the rotation cards

The Texas Tech study [F], run in drought-stricken West Texas, found **rye was the most successful winter cover crop: consistent yields even in a dry year, without reducing soil water for the following summer crop.** That's direct evidence for the "wheat → cover crop" style rotations. Put it on cereal rye cards as evidence. Also note SARE's warning that **killing rye late can deplete soil moisture** [C]. That's a good "risk" line.

## Sources

- [A] FAO, Irrigation Water Management (document T7202E), Ch. 2, Table 1. https://www.fao.org/4/t7202e/t7202e05.htm
- [B] FAO, yield response factors (Ky). https://www.fao.org/3/Y3655E/y3655e04.htm
- [C] SARE, *Managing Cover Crops Profitably*: Cereal Rye. https://www.sare.org/publications/managing-cover-crops-profitably/nonlegume-cover-crops/cereal-rye/
- [D] SARE, *Managing Cover Crops Profitably*: Sorghum-Sudangrass. https://www.sare.org/publications/managing-cover-crops-profitably/nonlegume-cover-crops/sorghum-sudangrass/
- [E] SARE, *Managing Cover Crops Profitably*: Hairy Vetch. https://www.sare.org/publications/managing-cover-crops-profitably/legume-cover-crops/hairy-vetch
- [F] Southern SARE, "In Drought-stricken Texas, Researchers are Finding Water Conservation Solutions in Cover Crops" (project GS15-152). https://southern.sare.org/news/in-drought-stricken-texas-researchers-are-finding-water-conservation-solutions-in-cover-crops/
- Already in crops.json: FAO Crop Water Needs Table 5 (`fao-cwn`) for the small-grain and sorghum proxies.
