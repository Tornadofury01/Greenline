"""Write the report cards for Models C, D and Calibration E, and refresh Model B's yield table, from metrics.json.
  python v2/models/write_reports.py
"""
import json, re
from pathlib import Path

H = Path(__file__).resolve().parent


def model_b():
    m = json.loads((H / "modelB/metrics.json").read_text())
    yl = "\n".join(f"| {c.title()} | months {', '.join(map(str, v['keyMonths']))} | {v['countyYears']} | {v['corr']:+.2f} | "
                   f"{v['r2_leaveOneYearOut']:.2f} | {v['yieldPctPerUnitZ']:+.1f}% |" for c, v in m["yieldLink"].items())
    p = H / "modelB/REPORT.md"
    t = p.read_text(encoding="utf-8")
    t = re.sub(r"(\| Crop \| Key months[^\n]*\n\|[-| ]+\|\n)(?:\|[^\n]*\n)+", lambda mm: mm.group(1) + yl + "\n", t)
    t = t.replace("- **Cotton and sorghum:** moderately tied.",
                  "- **Cotton:** about as strongly tied as corn.\n- **Sorghum:** moderately tied.")
    t = t.replace("using the 6 counties and every year NASS reports.",
                  "using the 6 counties and every year NASS reports. One clean NASS series per crop: per harvested acre, "
                  "all practices, winter wheat only (`v2/models/nass_yields.py`).")
    p.write_text(t, encoding="utf-8")


def model_c():
    c = json.loads((H / "modelC/metrics.json").read_text())
    ch = c["checks"]["byType"]
    g = lambda v, k, fmt: format(v[k], fmt) if v.get(k) == v.get(k) and v.get(k) is not None else "–"
    rows = "\n".join(
        f"| {k} | {len(c['years'][k])} | {', '.join(map(str, c['years'][k]))} | {g(v, 'usdm_d2plus_pct', '.0f')}% | "
        f"${g(v, 'rma_drought_heat_musd', '.1f')} M | {g(v, 'area_greenness_z', '+.2f')} | {g(v, 'yield_dev_wheat_pct', '+.0f')}% | "
        f"{g(v, 'yield_dev_corn_pct', '+.0f')}% | {g(v, 'yield_dev_sorghum_pct', '+.0f')}% | {g(v, 'yield_dev_cotton_pct', '+.0f')}% |"
        for k, v in ch.items())
    cen = "\n".join(f"| {k} | " + " | ".join(f"{x:g}" for x in v.values()) + " |" for k, v in c["centersRaw"].items())
    f40 = c["2040"]
    share = lambda sc, k: f"{f40[sc]['meanShare'].get(k, 0):.0%} ({f40[sc]['minShare'].get(k, 0):.0%}–{f40[sc]['maxShare'].get(k, 0):.0%})"
    futr = "\n".join(f"| {k} | {f40['observed1985_2025'].get(k, 0):.0%} | {share('ssp245', k)} | {share('ssp585', k)} |"
                     for k in ("normal", "wet", "hot", "drought"))
    txt = f"""# Model C: year types for North Texas (Field Shift v2)

**Season:** March–October, the 6-county study area, from gridMET daily weather averaged over the 1,711 fields, 1985–2025.

**Features (z-scored):** rain, heat days (≥ 35 °C), heavy-rain days (≥ 25 mm), mean daily high, water deficit (reference ET − rain), frost-free days.

**Method:** k-means with k = {c['k']}.
- **Silhouette by k:** {c['silhouetteByK']}. k = 4 is kept: it is close to the best score and matches the plan's four types.
- **Agreement:** a Gaussian mixture agrees almost exactly (ARI **{c['agreement']['kmeans_vs_gmm_ARI']}**), and so does a hidden Markov model over years (ARI **{c['agreement']['kmeans_vs_hmm_ARI']}**).
- **Persistence:** the HMM's probability of staying in the same type the next year is {c['hmmStayProbability']}, so year types barely carry over from one year to the next.

## Year types, checked against data the model never saw

| Type | Years | Which | Drought Monitor: % area in D2+ (Mar–Oct, 2000+) | RMA drought / heat payouts per year | Area greenness z (Model B) | Wheat yield | Corn | Sorghum | Cotton |
|---|---|---|---|---|---|---|---|---|---|
{rows}

**Yields** are the county yield's deviation from its trend, using one clean NASS series per crop.

**Drought** is one season (2011), the worst in 41 years. Everything else confirms the labels: three quarters of the area in severe drought, 2–3× the payouts of a hot year, greenness 0.7 z below normal, corn and cotton yields down about 45%.

**Hot** seasons are the second tier: 42% of the area in severe drought, cotton about −11%.

### Type centres (actual units)

| Type | Rain mm | Heat days | Heavy-rain days | Mean high °C | Deficit mm | Frost-free days |
|---|---|---|---|---|---|---|
{cen}

## 2040: how often each type comes

**Method:** NEX-GDDP-CMIP6, 8 models. Each model's change from its own 1985–2014 to 2030–2050 (rain ratio, warmer highs and lows, about 3% more reference ET per °C) is applied to every observed season, then classified with the same model. Each cell shows the mean share across the 8 models, with the range in brackets.

| Type | 1985–2025 | 2040, SSP2-4.5 | 2040, SSP5-8.5 |
|---|---|---|---|
{futr}

**More drought seasons than today:** {f40['ssp245']['modelsWithMoreDroughtThanToday']} of {f40['ssp245']['nModels']} models under SSP2-4.5, and {f40['ssp585']['modelsWithMoreDroughtThanToday']} of {f40['ssp585']['nModels']} under SSP5-8.5.

**Limit:** the delta method keeps today's year-to-year swings and only shifts their average. If the swings themselves grow, as many models suggest, drought and wet years would both be more frequent than shown.

**Files:**
- `year_types.csv`: each year's type, its probability, and the checks.
- `model3.joblib`: k-means + scaler, used to classify any season, including simulated 2040 ones.
- `metrics.json`
"""
    (H / "modelC/REPORT.md").write_text(txt, encoding="utf-8")


def calib_e():
    e = json.loads((H / "calibrationE/metrics.json").read_text())
    rows = "\n".join(
        f"| {k.title()} ({v['unit']}) | {v['countyYears']['train']} / {v['countyYears']['test']} | {v['testYears'][0]}–{v['testYears'][1]} | "
        f"{v['scores']['greennessLine']['r2_deviation']:.2f} | {v['scores']['ridge']['r2_deviation']:.2f} | {v['scores']['trees']['r2_deviation']:.2f} | "
        f"{v['scores']['trendOnly']['mae_yield']} → {v['scores'][v['best']]['mae_yield']} | {v['targets']['yieldPctPerGreennessZ']:+.1f}% |"
        for k, v in e.items())
    txt = f"""# Calibration E: yields (Field Shift v2, North Texas)

**What it is:** the yield targets the simulator must hit. It predicts county yields from satellite greenness (Model B) plus weather.

**Fit and test:** fitted on 1985–2012, tested once on 2013–2025.

**Target:** each county-crop's % deviation from its yield trend. The trend is fitted on the training years only and extrapolated, so test years never shape it.

**Yield data:** one clean NASS series per crop (`../nass_yields.py`): per harvested acre, all practices, winter wheat only.

**Inputs per county-year:**
- **Greenness:** z in the crop's key months (mean and worst month), from the fields Model 1 says grew the crop.
- **Weather:** season rain and hot days.
- **Water:** SPEI-90 and TerraClimate deficit at the end of the season, MODIS ET/PET.

| Crop | Train / test county-years | Test years | R² (deviation): greenness line | Ridge | Trees | Yield error (trend → best) | Yield per +1 greenness z |
|---|---|---|---|---|---|---|---|
{rows}

**Reading the R² columns:** R² of the deviation from trend. 0 is "trend only"; below 0 is worse than the trend.

**Results:**
- **Corn and cotton:** calibrated. Greenness alone explains about 38–45% of their year-to-year swings in unseen years and cuts yield error by about a quarter.
- **Wheat:** weak. A small tree model beats the trend, but greenness alone doesn't. Blackland wheat yields are set by freezes, disease and harvest rain as much as by spring growth.
- **Sorghum:** not predictable from these inputs. NASS stops sorghum county yields in 2023, leaving few test county-years.

**Ridge and trees vs the greenness line:** with about 150 training county-years, the extra weather inputs often overfit. The single greenness line is the most reliable target.

**How the simulator uses this:**
- **Corn and cotton:** the engine's per-crop settings (water productivity, heat thresholds) are tuned until its simulated yield deviations match these targets year by year (`metrics.json` → `targets`).
- **Wheat and sorghum:** the published FAO-33 response is kept and reported as uncalibrated.

**The engine itself isn't built yet:** this step supplies the targets and the test protocol.

**Files:** `calibrationE.joblib` (per-crop ridge + trees + training-year trends), `metrics.json`.
"""
    (H / "calibrationE/REPORT.md").write_text(txt, encoding="utf-8")


def model_d():
    d = json.loads((H / "modelD/metrics.json").read_text())
    uc, uy, pl = d["unseenCells"], d["unseenYears"], d["plausibility"]
    txt = f"""# Model D: field soil moisture from SMAP (Field Shift v2, optional)

**Target:** SMAP L3 enhanced (9 km) surface soil moisture, 2015–2025, the mean of the AM and PM retrievals.

**Cells:** fields reading identical SMAP series share a cell. That gives {d['cells']} cells with 3 or more fields, and {d['cellDates']:,} cell-dates that have a Sentinel-1 radar pass.

**Inputs, averaged over each cell's fields:**
- **Radar:** VV / VH backscatter (dB), their ratio, incidence angle.
- **Greenness:** that month's NDVI.
- **Weather:** rain over the last 1 / 3 / 7 / 14 days, 7-day mean high.
- **Season:** day of year.
- **Terrain:** wetness index, height above drainage, slope.
- **Soil:** clay, sand, water holding.

## Tests at SMAP's own scale (R²)

| | Model | Rain + season only | Radar only | Monthly average |
|---|---|---|---|---|
| Cells it never saw (grouped 5-fold) | **{uc['model']['r2']:.2f}** | {uc['rainSeasonOnly']['r2']:.2f} | {uc['radarOnly']['r2']:.2f} | {uc['cellClimatology']['r2']:.2f} |
| Years it never saw (2023–2025) | **{uy['model']['r2']:.2f}** | {uy['rainSeasonOnly']['r2']:.2f} | {uy['radarOnly']['r2']:.2f} | {uy['cellClimatology']['r2']:.2f} |

**Mean error:** {uy['model']['mae']:.3f} m³/m³ on the unseen years.

## What this says, honestly

1. **Recent rain does nearly all the work.** In this flat 6-county area, rain + season alone gets R² {uc['rainSeasonOnly']['r2']:.2f} on unseen cells. Radar, terrain and soil add about +0.05 R² on unseen years and almost nothing across cells.
2. **The field-scale detail is small and only weakly physical.**
   - **Spread:** after downscaling, fields in the same cell differ from SMAP by a standard deviation of {pl['fieldSpreadWithinCell_sd']:.3f} m³/m³.
   - **Terrain:** that difference barely follows terrain wetness (r = {pl['corr_fieldWetness_vs_TWI']:+.2f}) or height above drainage (r = {pl['corr_fieldWetness_vs_heightAboveDrainage']:+.2f}).
   - **Clay:** it follows clay content somewhat (r = {pl['corr_fieldWetness_vs_clay']:+.2f}).
3. **Field-scale accuracy can't be measured here.** No soil-moisture ground station sits in the 6 counties.

**Recommendation:**
- **Gap-filler:** use Model D to estimate SMAP-scale moisture on any day, including days with no SMAP retrieval, from rain + radar.
- **Simulator start:** start the simulator from SMAP / Model D at the cell level. Don't present the per-field values as measured field moisture.
- **To make it truly field-scale:** you would need in-situ stations (TxSON, SCAN) or a wetter, hillier area. This matches the plan's "optional" label.

**Files:**
- `modelD.joblib`
- `field_soil_moisture.csv.gz`: per field, per radar pass. Columns: SMAP, downscaled.
- `metrics.json`
"""
    (H / "modelD/REPORT.md").write_text(txt, encoding="utf-8")


if __name__ == "__main__":
    model_b(); model_c(); calib_e(); model_d()
    print("reports written: modelB (refreshed), modelC, calibrationE, modelD")
