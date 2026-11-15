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


# Model C and Calibration E write their own REPORT.md (modelC/train.py, calibrationE/train.py).


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
    model_b(); model_d()
    print("reports written: modelB (refreshed), modelD")
