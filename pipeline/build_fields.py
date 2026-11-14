"""Build the app's field files: /shared/fields/<fieldId>.json (data-format v3) + /shared/fields/index.json,
plus /shared/crop-calendars-l89.json (per-crop bare-month calendars from Landsat 8/9 only).

Combines the per-field pipeline CSVs (pipeline/data/fields/) with the SI model results (shared/si/).
Fields: the 300 Field Shift study fields (ec-000 ... ec-299, Ellis County). Run after
pipeline/fieldshift/build_app_inputs.py and pipeline/fieldshift/export_si.py (see pipeline/fieldshift/README.md):
    python pipeline/build_fields.py
/shared/crop-calendars-l89.json is only rebuilt from the old 200 North Texas sample fields (nt-*); with the study
fields it is left as it is (the calendars use the old crop classes and more fields).
"""
import json
import math
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
F = ROOT / "pipeline" / "data" / "fields"
SI = ROOT / "shared" / "si"
OUT = ROOT / "shared" / "fields"
CROPS = {c["id"] for c in json.loads((ROOT / "content" / "crops.json").read_text())["crops"]}
SCHEMA = 3
# Landsat 8/9-only cover (`*L89` keys). Landsat 7 reads NDVI ~0.05 below Landsat 8 here and is mixed into the monthly
# medians until ~2023, so the mixed record over-counts bare days (docs/landsat-harmonization-results.md).
L89_FROM = (2013, 4)        # first L8/9 month; 2013 Jan-Mar are null
L89_BARE_FROM = 2014        # first full L8/9 year: bare days per year and calendars start here
LOW_CONF_BEFORE = 2013      # cover / bare days before this year: Landsat 5/7 only -> low confidence (sensor mismatch)
GREEN_NDVI, BARE_NDVI = 0.40, 0.25
# Model 1 held-out recall/precision per crop class (the app uses it for confidence: "hard to recognise" crops).
PER_CLASS = json.loads((SI / "index.json").read_text())["models"]["seasonCrop"]["perClass"]

# CDL code -> crops.json id. Anything else is "other" and keeps its CDL group in `cdlClass`.
CDL_TO_CROP = {1: "corn", 2: "cotton", 4: "grain_sorghum", 24: "winter_wheat", 61: "fallow", 6: "sunflower",
               36: "alfalfa", 58: "hairy_vetch", 27: "cereal_rye"}

# Datasets behind every field file. `dataset`, `variable`, `resolution`, `dateRange` are what the app shows (keep them
# strings; `dataset` must match EVIDENCE names in /scoring). Extra keys (additive):
#   id, name (full product name), product (catalog id / API), provider,
#   scale: "patch" (30-70 m, read over the field itself), "area" (km-scale grid cell the field sits in, same value for
#          the whole field), "county", "state", "model" (our own outputs),
#   resolutionM (approx. pixel size in metres, null for county/state/model), startYear/endYear (null if not a time series).
# Time ranges marked `per_field` are replaced with the years this field actually has data for.
SOURCES = [
    {"id": "power", "dataset": "NASA POWER", "name": "NASA POWER daily agroclimatology (MERRA-2 based)", "product": "power.larc.nasa.gov API, community AG",
     "provider": "NASA LaRC", "variable": "rain, temperature, heat stress days, frost dates", "resolution": "0.5° × 0.625° (~50 km)",
     "scale": "area", "resolutionM": 50000, "years": (1984, 2025), "per_field": "power"},
    {"id": "imerg", "dataset": "GPM IMERG", "name": "GPM IMERG Final V07 (monthly + half-hourly)", "product": "NASA/GPM_L3/IMERG_MONTHLY_V07, NASA/GPM_L3/IMERG_V07",
     "provider": "NASA GSFC", "variable": "rain, heavy storm days (≥ 25 mm)", "resolution": "0.1° (~11 km)",
     "scale": "area", "resolutionM": 11000, "years": (2001, 2025), "per_field": "imerg"},
    {"id": "prism", "dataset": "PRISM", "name": "PRISM daily and monthly climate (AN)", "product": "OREGONSTATE/PRISM/ANd, OREGONSTATE/PRISM/ANm",
     "provider": "PRISM Group, Oregon State University", "variable": "monthly rain and temperature, frost dates, heavy rain days (gauge-based), study-area cell", "resolution": "4 km",
     "scale": "area", "resolutionM": 4000, "years": (1984, 2025), "per_field": "prism"},
    {"id": "smap", "dataset": "SMAP L4", "name": "SMAP surface soil moisture (AM + PM passes)", "product": "NASA SMAP L3 (Field Shift Earth Engine export)",
     "provider": "NASA", "variable": "surface soil moisture", "resolution": "~9 km",
     "scale": "area", "resolutionM": 9000, "years": (2015, 2025), "per_field": "smap"},
    {"id": "landsat", "dataset": "Landsat 5/7/8/9", "name": "Landsat Collection 2 Level-2 surface reflectance", "product": "LANDSAT/LT05, LE07, LC08, LC09 /C02/T1_L2",
     "provider": "USGS / NASA", "variable": "NDVI (green cover), NDTI, BSI", "resolution": "30 m",
     "scale": "patch", "resolutionM": 30, "years": (1984, 2025), "per_field": "landsat"},
    {"id": "landsat89", "dataset": "Landsat 8/9", "name": "Landsat 8/9 Collection 2 Level-2 surface reflectance (OLI only, no Landsat 7)", "product": "LANDSAT/LC08, LC09 /C02/T1_L2",
     "provider": "USGS / NASA", "variable": "bare days and green / residue / bare cover (one sensor family)", "resolution": "30 m",
     "scale": "patch", "resolutionM": 30, "years": (2013, 2025), "per_field": "landsat89"},
    {"id": "cdl", "dataset": "USDA Cropland Data Layer", "name": "USDA NASS Cropland Data Layer", "product": "USDA/NASS/CDL",
     "provider": "USDA NASS", "variable": "crop grown each year", "resolution": "30 m",
     "scale": "patch", "resolutionM": 30, "years": (2008, 2025), "per_field": "cdl"},
    {"id": "ssurgo", "dataset": "USDA SSURGO", "name": "Soil Survey Geographic Database (SSURGO)", "product": "Soil Data Access (sdmdataaccess.sc.egov.usda.gov)",
     "provider": "USDA NRCS", "variable": "soil series, texture, drainage, organic matter, erosion factors (K, T), available water, land capability class",
     "resolution": "map unit (1:24,000)", "scale": "patch", "resolutionM": None, "years": None, "dateRange": "current"},
    {"id": "srtm", "dataset": "SRTM", "name": "SRTM 1 arc-second elevation", "product": "USGS/SRTMGL1_003",
     "provider": "NASA / USGS", "variable": "slope", "resolution": "30 m",
     "scale": "patch", "resolutionM": 30, "years": (2000, 2000), "dateRange": "2000"},
    {"id": "modis_et", "dataset": "MODIS MOD16A2GF", "name": "MODIS Terra gap-filled 8-day evapotranspiration", "product": "MODIS/061/MOD16A2GF",
     "provider": "NASA LP DAAC", "variable": "evapotranspiration (tested, not used in scores)", "resolution": "500 m",
     "scale": "area", "resolutionM": 500, "years": (2008, 2025)},
    {"id": "nass_quickstats", "dataset": "NASS Quick Stats", "name": "USDA NASS Quick Stats survey yields and prices received", "product": "quickstats.nass.usda.gov API",
     "provider": "USDA NASS", "variable": "county crop yields, Texas price received (marketing year)", "resolution": "county / state",
     "scale": "county", "resolutionM": None, "years": (2008, 2025)},
    {"id": "nass_progress", "dataset": "NASS Crop Progress", "name": "USDA NASS Crop Progress (weekly)", "product": "quickstats.nass.usda.gov API",
     "provider": "USDA NASS", "variable": "planting and harvest dates (Texas)", "resolution": "state",
     "scale": "state", "resolutionM": None, "years": (2008, 2025)},
    {"id": "si", "dataset": "Greenline SI models", "name": "Field Shift models 1-3 (see pipeline/MODELS.md)", "product": "pipeline/fieldshift/models",
     "provider": "Greenline", "variable": "crop classifier, crop stress model, year types", "resolution": "per field",
     "scale": "model", "resolutionM": None, "years": (1985, 2025)},
]


def field_sources(ranges):
    """SOURCES for one field. `ranges` = {per_field key: (first year, last year)} from this field's data."""
    out = []
    for s in SOURCES:
        yrs = ranges.get(s.get("per_field")) or s["years"]
        row = {k: v for k, v in s.items() if k not in ("years", "per_field")}
        row["startYear"], row["endYear"] = (int(yrs[0]), int(yrs[1])) if yrs else (None, None)
        row.setdefault("dateRange", f"{row['startYear']}-{row['endYear']}")
        out.append(row)
    return out


def span(years):
    years = [int(y) for y in years]
    return (min(years), max(years)) if years else None


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


def land_class(s):
    """Non-irrigated land capability class + subclass, e.g. "2e" (e erosion, w wetness, s soil, c climate)."""
    if pd.isna(s.nirrcapcl):
        return None
    return f"{int(s.nirrcapcl)}{s.nirrcapscl if isinstance(s.nirrcapscl, str) else ''}"


MONTHLY_FROM = 2008  # climateMonthly covers the same years as the SI models (keeps files small)


def doy_date(year, doy):
    if doy is None or pd.isna(doy):
        return None
    return (date(year, 1, 1) + timedelta(days=int(doy) - 1)).isoformat()


def prism_year(prism_y, fid, year):
    """PRISM keys for one climateYearly entry (all null if PRISM has no row)."""
    r = prism_y.loc[(fid, year)] if (fid, year) in prism_y.index else None
    if r is None:
        return {k: None for k in ("precipMmPrism", "stormDaysPrism", "lastSpringFrostPrism", "firstFallFrostPrism", "frostFreeDaysPrism")}
    return {"precipMmPrism": nn(r.precipMm, 0), "stormDaysPrism": nn(int(r.stormDays)),
            "lastSpringFrostPrism": doy_date(year, r.lastSpringFrostDoy),
            "firstFallFrostPrism": doy_date(year, r.firstFallFrostDoy),
            "frostFreeDaysPrism": None if pd.isna(r.frostFreeDays) else int(r.frostFreeDays)}


def agreement(pairs):
    """{years, corr, pct}: correlation and mean difference (b vs a, %) over years where both exist."""
    pairs = [(a, b) for a, b in pairs if a and b]
    if len(pairs) < 5:
        return None
    a, b = np.array(pairs, dtype=float).T
    return {"years": len(pairs), "corr": round(float(np.corrcoef(a, b)[0, 1]), 2),
            "pct": round(float((b.mean() - a.mean()) / a.mean() * 100), 0)}


# NASS units: yield unit x this factor = price unit (sorghum 56 lb/bu -> cwt; sunflower lb -> cwt).
TO_PRICE_UNIT = {"corn": 1, "cotton": 1, "grain_sorghum": 0.56, "winter_wheat": 1, "soybeans": 1, "oats": 1, "sunflower": 0.01}
RECENT = (2021, 2025)


def market(fid_state, fid_county, ny, prices):
    """County yields (falling back to district, then state) and Texas prices, plus a recent-years summary."""
    y = ny[(ny.state == fid_state)]
    own = y[(y.level == "county") & (y.county == fid_county)]
    district = own.district.iloc[0] if len(own) else None  # None: county has no NASS rows -> state fallback only
    rows = []
    for crop in sorted(y.crop.unique()):
        for year in range(2008, 2026):
            for level, sel in (("county", own), ("district", y[(y.level == "district") & (y.district == district)]),
                               ("state", y[y.level == "state"])):
                v = sel[(sel.crop == crop) & (sel.year == year)].dropna(subset=["value"])
                if len(v):
                    rows.append({"crop": crop, "year": year, "value": nn(v.value.iloc[0], 1), "unit": v.unit.iloc[0], "level": level})
                    break
    price_rows = [{"crop": r.crop, "year": int(r.year), "value": nn(r.value, 2), "unit": r.unit}
                  for r in prices.dropna(subset=["value"]).itertuples()]
    recent = []
    for crop in sorted({r["crop"] for r in rows}):
        # One geographic level per crop (never mix county and state): county if it has >= 3 of the 5 years.
        # State yields include irrigated High Plains fields, so they read high for dryland North Texas.
        win = [r for r in rows if r["crop"] == crop and RECENT[0] <= r["year"] <= RECENT[1]]
        ys = []
        for level in ("county", "district", "state"):
            ys = [r for r in win if r["level"] == level]
            if len(ys) >= 3 or level == "state":
                break
        ps = [r for r in price_rows if r["crop"] == crop and RECENT[0] <= r["year"] <= RECENT[1]]
        if not ys or not ps:
            continue
        yv, pv = float(np.mean([r["value"] for r in ys])), float(np.mean([r["value"] for r in ps]))
        recent.append({"crop": crop, "years": f"{RECENT[0]}-{RECENT[1]}", "yield": round(yv, 1), "yieldUnit": ys[0]["unit"],
                       "yieldLevel": ys[0]["level"], "yieldYears": len(ys), "price": round(pv, 2), "priceUnit": ps[0]["unit"],
                       "grossPerAcreUsd": round(yv * TO_PRICE_UNIT[crop] * pv)})
    return {"county": fid_county, "district": district, "priceState": "TX", "yields": rows, "pricesTx": price_rows,
            "recent": recent}


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


def sensor_label(year):
    """Which Landsat sensors are in the mixed record's monthly medians that year."""
    return "L5/L7" if year < LOW_CONF_BEFORE else "L7+L8/L9"


def confidence(year):
    """Per-year flag for the mixed record: before 2013 only Landsat 5/7 exist, which read NDVI lower than Landsat 8/9."""
    low = year < LOW_CONF_BEFORE
    return {"sensor": sensor_label(year), "lowConfidence": low, **({"lowConfidenceReason": "sensorMismatch"} if low else {})}


def cover_l89(L89):
    """Cover timeline and bare days from Landsat 8/9 only. Same rules as the mixed record (0.25 / 0.40, gaps of up to
    2 months interpolated, >= 9 clear months for bare days), computed straight from NDVI (model 1 is not rerun)."""
    cover, bare = [], []
    for y, g in L89.groupby("year"):
        y = int(y)
        vals = g.set_index("month").ndvi.reindex(range(1, 13))
        filled = vals.interpolate(limit=2, limit_area="inside")
        first = L89_FROM[1] if y == L89_FROM[0] else 1
        months = [state(v) if m >= first else None for m, v in zip(range(1, 13), filled)]
        cover.append({"year": y, "months": months, "cloudyMonths": int(vals.loc[first:].isna().sum())})
        if y >= L89_BARE_FROM:
            b = bare_days(filled.values)
            if b is not None:
                bare.append({"year": y, "days": b[0], "greenDays": b[1], "score": int(round(100 * (1 - b[0] / 365)))})
    return cover, bare


def crop_calendars(per_field):
    """Per CDL class: share of field-years each month was bare (NDVI < 0.25), Landsat 8/9, 2014+.
    Same counting as scoring/tools/build_calendars.mjs (bare / clear months), so the app can switch to it."""
    acc = {}
    for crop_hist, cover in per_field:
        cov = {c["year"]: c["months"] for c in cover}
        for h in crop_hist:
            if h["year"] < L89_BARE_FROM or h["year"] not in cov or not h.get("cdlClass"):
                continue
            a = acc.setdefault(h["cdlClass"], {"bare": [0] * 12, "n": [0] * 12, "fieldYears": 0})
            a["fieldYears"] += 1
            for i, st in enumerate(cov[h["year"]]):
                if st:
                    a["n"][i] += 1
                    a["bare"][i] += st == "bare"
    crops = {c: {"bareShare": [round(b / n, 2) if n else None for b, n in zip(a["bare"], a["n"])],
                 "clearFieldYears": a["n"], "fieldYears": a["fieldYears"]} for c, a in sorted(acc.items())}
    return {"schemaVersion": 1, "source": "Landsat 8/9 Collection 2 L2 (no Landsat 7) + USDA Cropland Data Layer, 200 sampled North Texas fields (nt-*)",
            "years": [L89_BARE_FROM, max(h["year"] for ch, _ in per_field for h in ch)], "bareNdvi": BARE_NDVI,
            "builtBy": "pipeline/build_fields.py", "crops": crops}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    fields = pd.read_csv(F / "fields.csv")
    cdl = pd.read_csv(F / "cdl.csv")
    ls = pd.concat([pd.read_csv(F / "landsat_monthly_1984_2007.csv"), pd.read_csv(F / "landsat_monthly.csv")])
    ls = ls.sort_values(["fieldId", "year", "month"])
    l89 = pd.read_csv(F / "landsat_monthly_l89.csv").sort_values(["fieldId", "year", "month"])
    calendar_input = []
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
    imy_f = im.dropna(subset=["precipMm"]).groupby(["fieldId", "year"]).size()  # years with any IMERG month
    prism_y = pd.read_csv(F / "prism_yearly.csv").set_index(["fieldId", "year"])
    prism_m = pd.read_csv(F / "prism_monthly.csv").sort_values(["fieldId", "year", "month"])
    nass_y = pd.read_csv(ROOT / "pipeline" / "data" / "nass_yields.csv")
    nass_p = pd.read_csv(ROOT / "pipeline" / "data" / "nass_prices_tx.csv")
    market_cache = {}

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
            **prism_year(prism_y, fid, int(r.year)),
        } for r in p.itertuples()]
        pm = prism_m[(prism_m.fieldId == fid) & (prism_m.year >= MONTHLY_FROM)]
        climate_monthly = [{"year": int(r.year), "month": int(r.month), "precipMm": nn(r.precipMm, 1),
                            "tMinC": nn(r.tMinC, 1), "tMaxC": nn(r.tMaxC, 1)} for r in pm.itertuples()]

        L = ls[ls.fieldId == fid]
        ndvi_monthly = [{"year": int(r.year), "month": int(r.month), "ndvi": nn(r.ndvi, 3)} for r in L.itertuples() if not pd.isna(r.ndvi)]
        cover, bare = [], []
        for y, g in L.groupby("year"):
            vals = g.set_index("month").ndvi.reindex(range(1, 13))
            filled = vals.interpolate(limit=2, limit_area="inside")
            if si_years.get(int(y), {}).get("months"):   # old models exported monthly states; Field Shift doesn't
                months = si_years[int(y)]["months"]
            else:
                months = [state(v) for v in filled]
            cover.append({"year": int(y), "months": months, "cloudyMonths": int(vals.isna().sum()), **confidence(int(y))})
            b = bare_days(filled.values)
            if b is not None:
                bare.append({"year": int(y), "days": b[0], "greenDays": b[1], "score": int(round(100 * (1 - b[0] / 365))),
                             **confidence(int(y))})
        L89 = l89[l89.fieldId == fid]
        ndvi_l89 = [{"year": int(r.year), "month": int(r.month), "ndvi": nn(r.ndvi, 3)} for r in L89.itertuples() if not pd.isna(r.ndvi)]
        cover89, bare89 = cover_l89(L89)
        if fid.startswith("nt-"):  # sampled cropland only, like build_calendars.mjs (the demo point is pasture)
            calendar_input.append((crop_hist, cover89))

        s = soil.loc[fid] if fid in soil.index else None
        soil_obj = {
            "seriesName": nn(s.compname) if s is not None else None,
            "texture": texture(s.clay, s.sand) if s is not None else None,
            "drainageClass": (s.drainagecl.lower() if s is not None and isinstance(s.drainagecl, str) else None),
            "organicMatterPct": nn(s.om, 1) if s is not None else None,
            "hydrologicGroup": (s.hydgrp[0] if s is not None and isinstance(s.hydgrp, str) else None),
            "clayPct": nn(s.clay, 0) if s is not None else None,
            # Erosion and water (SSURGO). K: 0.02-0.69, higher = erodes more easily. T: tons/acre/yr of tolerable loss.
            "kFactor": nn(s.kwfact, 2) if s is not None else None,
            "tFactor": nn(s.tfact) if s is not None else None,
            "awcCmPerCm": nn(s.awc, 2) if s is not None else None,          # topsoil available water capacity
            "waterStorage100Cm": nn(s.aws0100wta, 1) if s is not None else None,  # cm of plant-available water, top 100 cm
            "landCapabilityClass": land_class(s) if s is not None else None,  # non-irrigated, e.g. "2e"
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
            # PRISM is gauge-based, so it's the reference: how far POWER and IMERG are from it (annual totals).
            "rainVsPrism": {
                "power": agreement([(x["precipMmPrism"], x["precipMm"]) for x in climate]),
                "imerg": agreement([(x["precipMmPrism"], x["precipMmImerg"]) for x in climate]),
            },
            "modelAgreesWithCdlPct": round(100 * sum(y["correct"] for y in scored) / len(scored)) if scored else None,
            "cloudyMonthsPct": round(100 * float(L.ndvi.isna().mean()), 0),
            "cloudyMonthsPctL89": round(100 * float(L89.ndvi.isna().mean()), 0),
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
            "climateMonthly": climate_monthly,
            "ndviMonthly": ndvi_monthly,
            "coverYearly": cover,
            "bareDaysPerYear": bare,
            "ndviMonthlyL89": ndvi_l89,
            "coverYearlyL89": cover89,
            "bareDaysPerYearL89": bare89,
            "quality": quality,
            "market": market_cache.setdefault((f.state, f.county), market(f.state, f.county, nass_y, nass_p)),
            "si": {"models": {**si["models"], "seasonCrop": {**si["models"]["seasonCrop"], "perClass": PER_CLASS}},
                   "years": si["years"], "replayPresets": si["replayPresets"]},
            "sources": field_sources({
                "power": span(x["year"] for x in climate),
                "imerg": span(y for (i, y), v in imy_f.items() if i == fid and v > 0),
                "prism": span(y for (i, y) in prism_y.index if i == fid),
                "smap": span(sm[(sm.fieldId == fid) & sm.sm_rootzone.notna()].year.unique()),
                "landsat": span(L[L.ndvi.notna()].year.unique()),
                "landsat89": span(L89[L89.ndvi.notna()].year.unique()),
                "cdl": span(x["year"] for x in crop_hist),
            }),
        }
        (OUT / f"{fid}.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False, allow_nan=False), encoding="utf-8")
        index.append({"id": fid, "county": f.county, "state": f.state, "lat": round(f.lat, 5), "lon": round(f.lon, 5)})
    (OUT / "index.json").write_text(json.dumps({"schemaVersion": SCHEMA, "fields": index}, indent=0), encoding="utf-8")
    print(f"wrote {len(index)} field files to shared/fields/")
    if not calendar_input:
        print("kept shared/crop-calendars-l89.json (no nt-* sample fields in this build)")
        return
    cal = crop_calendars(calendar_input)
    (ROOT / "shared" / "crop-calendars-l89.json").write_text(json.dumps(cal, indent=1), encoding="utf-8")
    print(f"wrote shared/crop-calendars-l89.json ({len(cal['crops'])} crop classes)")


if __name__ == "__main__":
    main()
