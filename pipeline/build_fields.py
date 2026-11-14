"""Build the app's field files: /shared/fields/<fieldId>.json (data-format v2) + /shared/fields/index.json.

Combines the per-field pipeline CSVs (pipeline/data/fields/) with the SI model results (shared/si/).
Run after sample_fields.py and pipeline/models/*:
    pipeline/.venv/Scripts/python pipeline/build_fields.py
"""
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
F = ROOT / "pipeline" / "data" / "fields"
SI = ROOT / "shared" / "si"
OUT = ROOT / "shared" / "fields"
CROPS = {c["id"] for c in json.loads((ROOT / "content" / "crops.json").read_text())["crops"]}
SCHEMA = 2
GREEN_NDVI, BARE_NDVI = 0.40, 0.25
# Model 1 held-out recall/precision per crop class (the app uses it for confidence: "hard to recognise" crops).
PER_CLASS = json.loads((ROOT / "pipeline" / "models" / "results" / "season_crop.json").read_text())["perClass"]

# CDL code -> crops.json id. Anything else is "other" and keeps its CDL group in `cdlClass`.
CDL_TO_CROP = {1: "corn", 2: "cotton", 4: "grain_sorghum", 24: "winter_wheat", 61: "fallow", 6: "sunflower",
               36: "alfalfa", 58: "hairy_vetch", 27: "cereal_rye"}

SOURCES = [
    {"dataset": "NASA POWER", "variable": "rain, temperature, heat stress days, frost dates", "resolution": "0.5° × 0.625° (~50 km)", "dateRange": "1984-2025"},
    {"dataset": "GPM IMERG", "variable": "rain, heavy storm days (≥ 25 mm)", "resolution": "0.1° (~11 km)", "dateRange": "2008-2025"},
    {"dataset": "SMAP L4", "variable": "root-zone soil moisture", "resolution": "~11 km", "dateRange": "2015-2025"},
    {"dataset": "Landsat 5/7/8/9", "variable": "NDVI (green cover), NDTI, BSI", "resolution": "30 m", "dateRange": "1984-2025"},
    {"dataset": "USDA Cropland Data Layer", "variable": "crop grown each year", "resolution": "30 m", "dateRange": "2008-2025"},
    {"dataset": "USDA SSURGO", "variable": "soil series, texture, drainage, organic matter", "resolution": "map unit (1:24,000)", "dateRange": "current"},
    {"dataset": "SRTM", "variable": "slope", "resolution": "30 m", "dateRange": "2000"},
    {"dataset": "MODIS MOD16A2GF", "variable": "evapotranspiration (tested, not used in scores)", "resolution": "500 m", "dateRange": "2008-2025"},
    {"dataset": "NASS Crop Progress", "variable": "planting and harvest dates (Texas)", "resolution": "state", "dateRange": "2008-2025"},
    {"dataset": "Greenline SI models", "variable": "crop and cover classifier, weather risk signal, year types", "resolution": "per field", "dateRange": "2008-2025"},
]


def nn(v, nd=None):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if isinstance(v, (np.floating, float)):
        return round(float(v), nd) if nd is not None else float(v)
    if isinstance(v, np.integer):
        return int(v)
    return v


def texture(clay, sand):
    """Topsoil texture class in the 4 buckets the app translates."""
    if clay is None or sand is None or pd.isna(clay) or pd.isna(sand):
        return None
    clay, sand = float(clay), float(sand)
    if clay >= 40:
        return "clay"
    if clay >= 27:
        return "clay_loam"
    if sand >= 52:
        return "sandy_loam"
    return "loam"


def state(v):
    if v is None or pd.isna(v):
        return None
    return "green" if v >= GREEN_NDVI else "bare" if v < BARE_NDVI else "residue"


def bare_days(monthly):
    """Days with NDVI < 0.25 from 12 monthly values interpolated to daily (same as model 1)."""
    mid = np.array([15, 45, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349])
    v = np.asarray(monthly, dtype=float)
    ok = ~np.isnan(v)
    if ok.sum() < 9:  # too cloudy to count
        return None
    d = np.interp(np.arange(365), mid[ok], v[ok])
    return int((d < BARE_NDVI).sum()), int((d >= GREEN_NDVI).sum())


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    fields = pd.read_csv(F / "fields.csv")
    cdl = pd.read_csv(F / "cdl.csv")
    ls = pd.concat([pd.read_csv(F / "landsat_monthly_1984_2007.csv"), pd.read_csv(F / "landsat_monthly.csv")])
    ls = ls.sort_values(["fieldId", "year", "month"])
    py = pd.read_csv(F / "power_yearly.csv")
    sm = pd.read_csv(F / "smap_monthly.csv")
    st = pd.read_csv(F / "imerg_storms_monthly.csv")
    im = pd.read_csv(F / "imerg_monthly.csv")
    terr = pd.read_csv(F / "terrain.csv").set_index("fieldId")
    soil = pd.read_csv(F / "ssurgo.csv").set_index("fieldId")

    # Growing-season (Apr-Sep) SMAP anomaly vs. each field's 2015-2025 mean
    gs = sm[sm.month.between(4, 9)].groupby(["fieldId", "year"]).sm_rootzone.mean()
    sm_anom = (gs / gs.groupby(level="fieldId").transform("mean") - 1).round(2)
    storms = st.groupby(["fieldId", "year"]).stormDays.sum()
    imy = im.groupby(["fieldId", "year"]).precipMm.sum()

    index = []
    for f in fields.itertuples():
        fid = f.fieldId
        si = json.loads((SI / f"{fid}.json").read_text())
        ytype = {y["year"]: y["yearType"] for y in si["yearTypes"]}
        si_years = {y["year"]: y for y in si["years"]}

        c = cdl[cdl.fieldId == fid].sort_values("year")
        crop_hist = []
        for r in c.itertuples():
            crop = CDL_TO_CROP.get(int(r.code), "other")
            crop = crop if crop in CROPS else "other"
            crop_hist.append({"year": int(r.year), "crop": crop, "cdlCode": int(r.code),
                              "cdlClass": si_years.get(int(r.year), {}).get("cdlClass")})

        p = py[(py.fieldId == fid) & (py.completeYear.astype(str) == "True")].sort_values("year")
        climate = [{
            "year": int(r.year), "precipMm": nn(r.precipMm, 0), "heatStressDays": nn(r.heatStressDays),
            "frostFreeDays": nn(r.frostFreeDays), "soilMoistureAnomaly": nn(sm_anom.get((fid, r.year))),
            "heavyStormDays": nn(storms.get((fid, r.year))), "precipMmImerg": nn(imy.get((fid, r.year)), 0),
            "yearType": ytype.get(int(r.year)),
        } for r in p.itertuples()]

        L = ls[ls.fieldId == fid]
        ndvi_monthly = [{"year": int(r.year), "month": int(r.month), "ndvi": nn(r.ndvi, 3)} for r in L.itertuples() if not pd.isna(r.ndvi)]
        cover, bare = [], []
        for y, g in L.groupby("year"):
            vals = g.set_index("month").ndvi.reindex(range(1, 13))
            filled = vals.interpolate(limit=2, limit_area="inside")
            if int(y) in si_years:   # 2008+: the same states model 1 exported
                months = si_years[int(y)]["months"]
            else:
                months = [state(v) for v in filled]
            cover.append({"year": int(y), "months": months, "cloudyMonths": int(vals.isna().sum())})
            b = bare_days(filled.values)
            if b is not None:
                bare.append({"year": int(y), "days": b[0], "greenDays": b[1], "score": int(round(100 * (1 - b[0] / 365)))})

        s = soil.loc[fid] if fid in soil.index else None
        soil_obj = {
            "seriesName": nn(s.compname) if s is not None else None,
            "texture": texture(s.clay, s.sand) if s is not None else None,
            "drainageClass": (s.drainagecl.lower() if s is not None and isinstance(s.drainagecl, str) else None),
            "organicMatterPct": nn(s.om, 1) if s is not None else None,
            "hydrologicGroup": (s.hydgrp[0] if s is not None and isinstance(s.hydgrp, str) else None),
            "clayPct": nn(s.clay, 0) if s is not None else None,
        }
        t = terr.loc[fid]

        # Do the datasets agree? (used by the confidence score)
        both = [(x["precipMm"], x["precipMmImerg"]) for x in climate if x["precipMm"] and x["precipMmImerg"]]
        if len(both) >= 5:
            a, b = np.array(both).T
            rain_agree = {"years": len(both), "corr": round(float(np.corrcoef(a, b)[0, 1]), 2),
                          "imergVsPowerPct": round(float((b.mean() - a.mean()) / a.mean() * 100), 0)}
        else:
            rain_agree = None
        yrs = si["years"]
        scored = [y for y in yrs if y["correct"] is not None]
        quality = {
            "rainAgreement": rain_agree,
            "modelAgreesWithCdlPct": round(100 * sum(y["correct"] for y in scored) / len(scored)) if scored else None,
            "cloudyMonthsPct": round(100 * float(L.ndvi.isna().mean()), 0),
            "climateYears": len(climate), "cropYears": len(crop_hist),
        }

        out = {
            "schemaVersion": SCHEMA, "isSampleData": False,
            "field": {"id": fid, "county": f.county, "state": f.state, "gridCell": f"L30-{fid}",
                      "lat": round(f.lat, 5), "lon": round(f.lon, 5)},
            "soil": soil_obj,
            "terrain": {"slopePct": nn(t.slopePct, 1), "elevationM": nn(t.elevationM, 0)},
            "cropHistory": crop_hist,
            "climateYearly": climate,
            "ndviMonthly": ndvi_monthly,
            "coverYearly": cover,
            "bareDaysPerYear": bare,
            "quality": quality,
            "si": {"models": {**si["models"], "seasonCrop": {**si["models"]["seasonCrop"], "perClass": PER_CLASS}},
                   "years": si["years"], "replayPresets": si["replayPresets"]},
            "sources": SOURCES,
        }
        (OUT / f"{fid}.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False, allow_nan=False), encoding="utf-8")
        index.append({"id": fid, "county": f.county, "state": f.state, "lat": round(f.lat, 5), "lon": round(f.lon, 5)})
    (OUT / "index.json").write_text(json.dumps({"schemaVersion": SCHEMA, "fields": index}, indent=0), encoding="utf-8")
    print(f"wrote {len(index)} field files to shared/fields/")


if __name__ == "__main__":
    main()
