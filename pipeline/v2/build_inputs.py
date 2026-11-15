"""Field Shift v2: build the per-field INPUT files the precompute reads, for the North Texas fields.

    shared/v2/inputs/<fid>.json     one per field (data-format v3, same keys as v1; see docs/v2-precompute-guide.md)
    shared/v2/input-index.json      every field written (merged across runs): id, county, lat, lon, holdout and its recent
                                    crops, so the precompute's regional context is the same on every computer

Reads only local files under --data (default v2/data): the Earth Engine exports (v2/data/ee), SSURGO, NASS and
fields_v2.geojson. No Earth Engine, no network. Does NOT run the precompute.

    python pipeline/v2/build_inputs.py --counties 48139            # Ellis only
    python pipeline/v2/build_inputs.py --ids 48139-0000,48139-0001  # a few fields (testing)
    python pipeline/v2/build_inputs.py                              # all six counties

Field ids are the USDA Crop Sequence Boundary ids from fields_v2.geojson (`48139-0021` = county FIPS + number).
Weather: Daymet (daily, 1 km, complete 1985-2025; gridMET has gaps) for rain, temperature, heat days, heavy-rain days and frost; PRISM
and IMERG kept as rain cross-checks (both have missing years).
Bare days and cover: Landsat 8/9 only (2014+); the Landsat 5/7/8/9 record is kept for display (pre-2013 = low
confidence), same rules as pipeline/build_fields.py. A scene counts when >= 70 % of the field's pixels are clear and
< 5 % snow (same clear rule as Model 1).
"""
import argparse
import glob
import json
import math
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
from build_fields import (  # noqa: E402  same rules as the v1 builder
    BARE_NDVI, GREEN_NDVI, L89_BARE_FROM, L89_FROM, LOW_CONF_BEFORE, agreement, bare_days, confidence, cover_l89,
    nn, span, state, texture)

SCHEMA = 3
FIRST_YEAR, LAST_YEAR = 1985, 2025
MIN_CLEAR, MAX_SNOW = 0.7, 0.05          # Model 1's clear-scene rule
HOT_C, STORM_MM = 35.0, 25.0             # heat-stress day (tmax >= 35 C = 95 F), heavy storm day (>= 25 mm)
COUNTY_NAMES = {"48139": "Ellis", "48217": "Hill", "48251": "Johnson", "48257": "Kaufman", "48309": "McLennan",
                "48349": "Navarro"}
DISTRICT = "Blacklands"

# CDL code -> crops.json id; anything else is "other". cdlClass = Model 1's grouped class (app MODEL_CLASS).
CDL_TO_CROP = {1: "corn", 2: "cotton", 4: "grain_sorghum", 5: "soybeans", 24: "winter_wheat", 26: "winter_wheat",
               225: "winter_wheat", 236: "winter_wheat", 238: "winter_wheat", 61: "fallow", 6: "sunflower",
               36: "alfalfa", 58: "hairy_vetch", 27: "cereal_rye"}
CDL_CLASS = {1: "summer_grain", 4: "summer_grain", 2: "cotton", 5: "soybeans", 24: "winter_grain", 26: "winter_grain",
             225: "winter_grain", 236: "winter_grain", 238: "winter_grain", 22: "winter_grain", 23: "winter_grain",
             28: "winter_grain", 27: "winter_grain", 21: "winter_grain", 205: "winter_grain", 29: "winter_grain",
             36: "grass_hay", 37: "grass_hay", 176: "grass_hay", 58: "grass_hay", 59: "grass_hay", 60: "grass_hay",
             62: "grass_hay", 61: "fallow", 6: "other"}

# Datasets behind every v2 field file (same keys as pipeline/build_fields.py SOURCES; `dataset` must match EVIDENCE names).
SOURCES = [
    {"id": "daymet", "dataset": "Daymet", "name": "Daymet V4 daily surface weather (ORNL DAAC, NASA)", "product": "NASA/ORNL/DAYMET_V4",
     "provider": "NASA ORNL DAAC", "variable": "rain, temperature, heat stress days, heavy rain days, frost dates", "resolution": "1 km",
     "scale": "area", "resolutionM": 1000, "per_field": "daymet"},
    {"id": "imerg", "dataset": "GPM IMERG", "name": "GPM IMERG Final V07 (half-hourly)", "product": "NASA/GPM_L3/IMERG_V07",
     "provider": "NASA GSFC", "variable": "rain cross-check", "resolution": "0.1° (~11 km)",
     "scale": "area", "resolutionM": 11000, "per_field": "imerg"},
    {"id": "prism", "dataset": "PRISM", "name": "PRISM daily climate (AN)", "product": "OREGONSTATE/PRISM/ANd",
     "provider": "PRISM Group, Oregon State University", "variable": "rain cross-check, frost dates, heavy rain days (gauge-based)", "resolution": "4 km",
     "scale": "area", "resolutionM": 4000, "per_field": "prism"},
    {"id": "smap", "dataset": "SMAP L4", "name": "SMAP L4 root-zone soil moisture", "product": "NASA/SMAP/SPL4SMGP",
     "provider": "NASA", "variable": "root-zone soil moisture", "resolution": "~9 km",
     "scale": "area", "resolutionM": 9000, "per_field": "smap"},
    {"id": "landsat", "dataset": "Landsat 5/7/8/9", "name": "Landsat Collection 2 Level-2 surface reflectance", "product": "LANDSAT/LT05, LE07, LC08, LC09 /C02/T1_L2",
     "provider": "USGS / NASA", "variable": "NDVI (green cover)", "resolution": "30 m",
     "scale": "patch", "resolutionM": 30, "per_field": "landsat"},
    {"id": "landsat89", "dataset": "Landsat 8/9", "name": "Landsat 8/9 Collection 2 Level-2 surface reflectance (OLI only, no Landsat 7)", "product": "LANDSAT/LC08, LC09 /C02/T1_L2",
     "provider": "USGS / NASA", "variable": "bare days and green / residue / bare cover (one sensor family)", "resolution": "30 m",
     "scale": "patch", "resolutionM": 30, "per_field": "landsat89"},
    {"id": "cdl", "dataset": "USDA Cropland Data Layer", "name": "USDA NASS Cropland Data Layer", "product": "USDA/NASS/CDL",
     "provider": "USDA NASS", "variable": "crop grown each year", "resolution": "30 m",
     "scale": "patch", "resolutionM": 30, "per_field": "cdl"},
    {"id": "ssurgo", "dataset": "USDA SSURGO", "name": "Soil Survey Geographic Database (SSURGO)", "product": "Soil Data Access (sdmdataaccess.sc.egov.usda.gov)",
     "provider": "USDA NRCS", "variable": "soil series, texture, drainage, organic matter, erosion factors (K, T), available water, land capability class",
     "resolution": "map unit (1:24,000)", "scale": "patch", "resolutionM": None, "years": None, "dateRange": "current"},
    {"id": "3dep", "dataset": "USGS 3DEP", "name": "USGS 3D Elevation Program 10 m DEM", "product": "USGS/3DEP/10m",
     "provider": "USGS", "variable": "slope, elevation", "resolution": "10 m",
     "scale": "patch", "resolutionM": 10, "years": None, "dateRange": "current"},
    {"id": "nass_quickstats", "dataset": "NASS Quick Stats", "name": "USDA NASS Quick Stats survey yields and prices received", "product": "quickstats.nass.usda.gov API",
     "provider": "USDA NASS", "variable": "county crop yields, Texas price received (marketing year)", "resolution": "county / state",
     "scale": "county", "resolutionM": None, "years": (2008, 2025)},
]


def field_sources(ranges):
    out = []
    for s in SOURCES:
        yrs = ranges.get(s.get("per_field")) or s.get("years")
        row = {k: v for k, v in s.items() if k not in ("years", "per_field")}
        row["startYear"], row["endYear"] = (int(yrs[0]), int(yrs[1])) if yrs else (None, None)
        row.setdefault("dateRange", f"{row['startYear']}-{row['endYear']}")
        out.append(row)
    return out


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------------------------------------------------------------
# Fields
# ---------------------------------------------------------------------------------------------------------------------
def outer_ring(geom):
    """Largest outer ring of a Polygon / MultiPolygon / GeometryCollection (the buffered fields come as all three)."""
    rings = []
    if geom["type"] == "Polygon":
        rings = [geom["coordinates"][0]]
    elif geom["type"] == "MultiPolygon":
        rings = [p[0] for p in geom["coordinates"]]
    elif geom["type"] == "GeometryCollection":
        for g in geom["geometries"]:
            if g["type"] in ("Polygon", "MultiPolygon"):
                rings.append(outer_ring(g))
    rings = [np.asarray(r, dtype=float) for r in rings]
    return max(rings, key=len)


def load_fields(data, counties, ids):
    gj = json.loads((data / "fields_v2.geojson").read_text())
    rows = []
    for f in gj["features"]:
        p = f["properties"]
        ring = outer_ring(f["geometry"])
        rows.append({"fid": p["fid"], "cfips": str(p["cfips"]), "holdout": int(p.get("holdout") or 0),
                     "areaHa": p.get("area_ha"), "lon": float(ring[:, 0].mean()), "lat": float(ring[:, 1].mean())})
    d = pd.DataFrame(rows)
    if ids:
        d = d[d.fid.isin(ids)]
    elif counties:
        d = d[d.cfips.isin(counties)]
    return d.sort_values("fid").reset_index(drop=True)


# ---------------------------------------------------------------------------------------------------------------------
# Readers (each keeps only the fields being built)
# ---------------------------------------------------------------------------------------------------------------------
def years_of(pattern):
    return sorted(int(re.search(r"_(\d{4})\.csv$", f).group(1)) for f in glob.glob(pattern) if re.search(r"_(\d{4})\.csv$", f))


def daily_cols(cols, band):
    return [c for c in cols if re.fullmatch(rf"d\d\d_{band}", c)]


def read_daily(ee, ds, bands, fids):
    """{year: DataFrame(fid, year, month, d01_<band>..)} for the per-month daily exports, only `fids`."""
    out = {}
    for y in years_of(str(ee / f"{ds}_*.csv")):
        f = ee / f"{ds}_{y}.csv"
        head = pd.read_csv(f, nrows=0).columns
        keep = ["fid", "year", "month"] + [c for b in bands for c in daily_cols(head, b)]
        d = pd.read_csv(f, usecols=keep)
        out[y] = d[d.fid.isin(fids)].reset_index(drop=True)
    return out


def frost_dates(year, tmin_by_doy):
    """Last spring frost (Jan-Jun) and first fall frost (Jul-Dec) day of year, frost = tmin <= 0 C."""
    doys = np.arange(1, len(tmin_by_doy) + 1)
    frost = tmin_by_doy <= 0
    mid = (date(year, 7, 1) - date(year, 1, 1)).days + 1
    spring = doys[(doys < mid) & frost]
    fall = doys[(doys >= mid) & frost]
    return (int(spring.max()) if len(spring) else None), (int(fall.min()) if len(fall) else None)


def daily_series(d, band):
    """{fid: np.array of daily values for the year}, months in order, padded days (d29-d31) dropped."""
    out = {}
    cols = daily_cols(d.columns, band)
    for fid, g in d.sort_values(["fid", "month"]).groupby("fid"):
        vals = []
        for r in g.itertuples(index=False):
            dim = (date(r.year + (r.month == 12), r.month % 12 + 1, 1) - date(r.year, r.month, 1)).days
            vals.extend(getattr(r, c) for c in cols[:dim])
        out[fid] = np.asarray(vals, dtype=float)
    return out


def doy_date(year, doy):
    return None if doy is None else (date(year, 1, 1) + timedelta(days=int(doy) - 1)).isoformat()


def daymet(ee, fids):
    """climateMonthly rows and per field-year heat days, heavy-rain days, frost (Daymet V4, 1 km, deg C and mm).
    Daymet, not gridMET: the gridMET export is missing about a third of the field rows in 1989, 1995, 2001, 2007,
    2013, 2019 and 2025; Daymet is complete 1985-2025. Daymet drops Dec 31 in leap years (365-day calendar)."""
    monthly, yearly = [], []
    for y, d in read_daily(ee, "daymet", ["prcp", "tmax", "tmin"], fids).items():
        pr, tx, tn = (d[daily_cols(d.columns, b)] for b in ("prcp", "tmax", "tmin"))
        m = d[["fid", "year", "month"]].copy()
        m["precipMm"] = pr.sum(axis=1, min_count=1)
        m["tMaxC"] = tx.mean(axis=1)
        m["tMinC"] = tn.mean(axis=1)
        m["hot"] = (tx >= HOT_C).sum(axis=1)
        m["storm"] = (pr >= STORM_MM).sum(axis=1)
        m["nDays"] = pr.notna().sum(axis=1)
        monthly.append(m)
        for fid, v in daily_series(d, "tmin").items():
            ls, ff = frost_dates(y, v)
            yearly.append({"fid": fid, "year": y, "lastFrost": ls, "firstFrost": ff})
    m = pd.concat(monthly, ignore_index=True)
    return m, pd.DataFrame(yearly)


def prism(ee, fids):
    rows = []
    for y, d in read_daily(ee, "prism", ["ppt", "tmin"], fids).items():
        ppt = d[daily_cols(d.columns, "ppt")]
        a = d[["fid"]].assign(p=ppt.sum(axis=1, min_count=1), storm=(ppt >= STORM_MM).sum(axis=1), n=ppt.notna().sum(axis=1))
        g = a.groupby("fid").agg(p=("p", "sum"), storm=("storm", "sum"), n=("n", "sum"))
        tmin = daily_series(d, "tmin")
        for fid, r in g.iterrows():
            if r.n < 360:  # incomplete year: no cross-check rather than a short total
                continue
            ls, ff = frost_dates(y, tmin[fid])
            rows.append({"fid": fid, "year": y, "precipMmPrism": round(float(r.p)), "stormDaysPrism": int(r.storm),
                         "lastSpringFrostPrism": doy_date(y, ls), "firstFallFrostPrism": doy_date(y, ff),
                         "frostFreeDaysPrism": (ff - ls) if ls and ff else None})
    return pd.DataFrame(rows).set_index(["fid", "year"]) if rows else pd.DataFrame()


def imerg(ee, fids):
    rows = []
    for y, d in read_daily(ee, "imerg", ["rain"], fids).items():
        r = d[daily_cols(d.columns, "rain")]
        a = d[["fid"]].assign(p=r.sum(axis=1, min_count=1), storm=(r >= STORM_MM).sum(axis=1), n=r.notna().sum(axis=1))
        g = a.groupby("fid").agg(p=("p", "sum"), storm=("storm", "sum"), n=("n", "sum"))
        for fid, x in g.iterrows():
            if x.n >= 360:
                rows.append({"fid": fid, "year": y, "precipMmImerg": round(float(x.p)), "heavyStormDays": int(x.storm)})
    return pd.DataFrame(rows).set_index(["fid", "year"]) if rows else pd.DataFrame()


def smap_anomaly(ee, fids):
    """Growing-season (Apr-Sep) SMAP L4 root-zone mean vs the field's own 2015-2025 mean (same as v1)."""
    parts = []
    for y, d in read_daily(ee, "smapl4", ["sm_rootzone"], fids).items():
        v = d[daily_cols(d.columns, "sm_rootzone")]
        parts.append(d[["fid", "year", "month"]].assign(sm=v.mean(axis=1)))
    if not parts:
        return pd.Series(dtype=float)
    s = pd.concat(parts)
    gs = s[s.month.between(4, 9)].groupby(["fid", "year"]).sm.mean()
    return (gs / gs.groupby(level="fid").transform("mean") - 1).round(2)


def landsat(ee, fids):
    """Monthly median NDVI per field: all Landsat (display) and Landsat 8/9 only (bare days)."""
    cols = {"fid", "date", "sensor", "tot_count", "snow_count", "ndvi_count", "ndvi_p50"}
    parts = []
    for f in sorted(glob.glob(str(ee / "ls[5789]*_*.csv"))):
        d = pd.read_csv(f, usecols=lambda c: c in cols)
        d = d[d.fid.isin(fids)]
        d = d[(d.tot_count > 0) & (d.ndvi_count >= MIN_CLEAR * d.tot_count) & (d.snow_count <= MAX_SNOW * d.tot_count)]
        parts.append(d[["fid", "date", "sensor", "ndvi_p50"]])
    s = pd.concat(parts, ignore_index=True)
    s["date"] = pd.to_datetime(s.date)
    s = s.groupby(["fid", "date", "sensor"], as_index=False).ndvi_p50.median()   # overlapping paths: one per day
    s["year"], s["month"] = s.date.dt.year, s.date.dt.month
    allm = s.groupby(["fid", "year", "month"]).ndvi_p50.median().rename("ndvi").reset_index()
    l89 = s[s.sensor.isin(["ls8", "ls9"])].groupby(["fid", "year", "month"]).ndvi_p50.median().rename("ndvi").reset_index()
    return allm, l89


def full_grid(df, fid, first, last):
    """Monthly rows of one field for every month first..last (missing = NaN), like the v1 CSVs."""
    idx = pd.MultiIndex.from_product([range(first, last + 1), range(1, 13)], names=["year", "month"])
    g = df[df.fid == fid].set_index(["year", "month"]).ndvi.reindex(idx)
    return g.reset_index()


def landsat89_scenes(ee, fids, first=2014):
    """Clear Landsat 8/9 scenes per field, 2014+: {fid: [{"d": "YYYY-MM-DD", "v": ndvi}]} (report card check 3 uses the
    scene dates, 8-16 days apart, instead of monthly values)."""
    cols = {"fid", "date", "sensor", "tot_count", "snow_count", "ndvi_count", "ndvi_p50"}
    parts = []
    for f in sorted(glob.glob(str(ee / "ls[89]_*.csv"))):
        d = pd.read_csv(f, usecols=lambda c: c in cols)
        d = d[d.fid.isin(fids)]
        d = d[(d.tot_count > 0) & (d.ndvi_count >= MIN_CLEAR * d.tot_count) & (d.snow_count <= MAX_SNOW * d.tot_count)]
        parts.append(d[["fid", "date", "ndvi_p50"]])
    s = pd.concat(parts, ignore_index=True)
    s = s[s.date.str[:4].astype(int) >= first]
    s = s.groupby(["fid", "date"], as_index=False).ndvi_p50.median().sort_values(["fid", "date"])
    return {fid: [{"d": r.date, "v": round(float(r.ndvi_p50), 3)} for r in g.itertuples()] for fid, g in s.groupby("fid")}


def smap_rootzone_monthly(ee, fids):
    """SMAP L4 root-zone soil moisture, monthly mean per field (m3/m3), 2015-2025 (report card check 6)."""
    parts = []
    for y, d in read_daily(ee, "smapl4", ["sm_rootzone"], fids).items():
        v = d[daily_cols(d.columns, "sm_rootzone")]
        parts.append(d[["fid", "year", "month"]].assign(sm=v.mean(axis=1)))
    s = pd.concat(parts).dropna(subset=["sm"])
    return {fid: [{"year": int(r.year), "month": int(r.month), "sm": round(float(r.sm), 4)} for r in g.sort_values(["year", "month"]).itertuples()]
            for fid, g in s.groupby("fid")}


# ---------------------------------------------------------------------------------------------------------------------
# Soil, terrain, market
# ---------------------------------------------------------------------------------------------------------------------
def soil_obj(s):
    if s is None:
        return {k: None for k in ("seriesName", "texture", "drainageClass", "organicMatterPct", "hydrologicGroup", "clayPct",
                                  "kFactor", "tFactor", "awcCmPerCm", "waterStorage100Cm", "landCapabilityClass")}
    return {
        "seriesName": nn(s.compname) if isinstance(s.compname, str) else None,
        "texture": texture(s.claytotal_r_0_30, s.sandtotal_r_0_30),
        "drainageClass": s.drainagecl.lower() if isinstance(s.drainagecl, str) else None,
        "organicMatterPct": nn(s.om_r_0_30, 1),
        "hydrologicGroup": s.hydgrp[0] if isinstance(s.hydgrp, str) else None,
        "clayPct": nn(s.claytotal_r_0_30, 0),
        "kFactor": nn(s.kwfact, 2),
        "tFactor": nn(s.tfact),
        "awcCmPerCm": nn(s.awc_r_0_30, 2),
        "waterStorage100Cm": nn(s.aws0100wta, 1),
        # SSURGO export has the non-irrigated class number only (no subclass letter)
        "landCapabilityClass": None if pd.isna(s.nirrcapcl) else str(int(s.nirrcapcl)),
    }


NASS_CROPS = {"WHEAT": ("winter_wheat", "WINTER", "BU / ACRE", "bu/acre"), "CORN": ("corn", None, "BU / ACRE", "bu/acre"),
              "SORGHUM": ("grain_sorghum", None, "BU / ACRE", "bu/acre"), "COTTON": ("cotton", "UPLAND", "LB / ACRE", "lb/acre"),
              "SOYBEANS": ("soybeans", None, "BU / ACRE", "bu/acre"), "OATS": ("oats", None, "BU / ACRE", "bu/acre"),
              "SUNFLOWER": ("sunflower", None, "LB / ACRE", "lb/acre")}
PRICE_UNITS = {"WHEAT": ("winter_wheat", "$ / BU", "$/bu"), "CORN": ("corn", "$ / BU", "$/bu"),
               "SORGHUM": ("grain_sorghum", "$ / CWT", "$/cwt"), "COTTON": ("cotton", "$ / LB", "$/lb"),
               "SOYBEANS": ("soybeans", "$ / BU", "$/bu"), "OATS": ("oats", "$ / BU", "$/bu"),
               "SUNFLOWER": ("sunflower", "$ / CWT", "$/cwt")}
TO_PRICE_UNIT = {"corn": 1, "cotton": 1, "grain_sorghum": 0.56, "winter_wheat": 1, "soybeans": 1, "oats": 1, "sunflower": 0.01}
RECENT = (2021, 2025)


def nass_yield_rows(data):
    """crop, level, cfips, year, value, unit: county (6 counties), Blacklands district, Texas."""
    out = []
    for file, level in (("nass_county.csv", "county"), ("nass_district.csv", "district"), ("nass_state.csv", "state")):
        n = pd.read_csv(data / file, low_memory=False, dtype={"cfips": str, "county_ansi": str})
        n = n[(n.statisticcat_desc == "YIELD") & (n.domain_desc == "TOTAL") & (n.prodn_practice_desc == "ALL PRODUCTION PRACTICES")]
        if level == "district":
            n = n[n.asd_desc == "BLACKLANDS"]
        for com, (crop, cls, unit, u) in NASS_CROPS.items():
            g = n[(n.commodity_desc == com) & (n.unit_desc == unit) & (n.util_practice_desc != "SILAGE")]
            if cls:
                g = g[g.class_desc == cls]
            if level == "county":
                g = g.assign(cfips=g.cfips.astype(str).str[:5])
            else:
                g = g.assign(cfips=None)
            g = g.dropna(subset=["value_num"]).groupby(["cfips", "year"], dropna=False).value_num.mean().reset_index()
            out.append(g.assign(crop=crop, level=level, unit=u))
    y = pd.concat(out, ignore_index=True)
    return y[(y.year >= 2008) & (y.year <= 2025)]


def nass_prices(data):
    p = pd.read_csv(data / "nass_prices.csv", low_memory=False)
    p = p[(p.reference_period_desc == "MARKETING YEAR") & (p.statisticcat_desc == "PRICE RECEIVED")]
    rows = []
    for com, (crop, unit, u) in PRICE_UNITS.items():
        g = p[(p.commodity_desc == com) & (p.unit_desc == unit)]
        if com == "COTTON":
            g = g[g.class_desc == "UPLAND"] if (g.class_desc == "UPLAND").any() else g
        if com == "WHEAT":
            g = g[g.class_desc == "ALL CLASSES"] if (g.class_desc == "ALL CLASSES").any() else g
        g = g.dropna(subset=["value_num"]).groupby("year").value_num.mean()
        rows += [{"crop": crop, "year": int(y), "value": round(float(v), 2), "unit": u} for y, v in g.items() if 2008 <= y <= 2025]
    return rows


def market(cfips, ny, price_rows):
    """County yields (falling back to Blacklands district, then Texas) and Texas prices, plus a recent summary."""
    rows = []
    for crop in sorted(ny.crop.unique()):
        c = ny[ny.crop == crop]
        for year in range(2008, 2026):
            for level, sel in (("county", c[(c.level == "county") & (c.cfips == cfips)]), ("district", c[c.level == "district"]),
                               ("state", c[c.level == "state"])):
                v = sel[sel.year == year]
                if len(v):
                    rows.append({"crop": crop, "year": year, "value": nn(v.value_num.iloc[0], 1), "unit": v.unit.iloc[0], "level": level})
                    break
    recent = []
    for crop in sorted({r["crop"] for r in rows}):
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
    return {"county": COUNTY_NAMES.get(cfips, cfips), "district": DISTRICT, "priceState": "TX", "yields": rows,
            "pricesTx": price_rows, "recent": recent}


# ---------------------------------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(ROOT / "v2" / "data"), help="folder with fields_v2.geojson, ee/, ssurgo_*, nass_*")
    ap.add_argument("--counties", default="", help="comma-separated county FIPS (default: all six)")
    ap.add_argument("--ids", default="", help="comma-separated field ids (overrides --counties)")
    ap.add_argument("--out", default=str(ROOT / "shared" / "v2" / "inputs"))
    a = ap.parse_args()
    data, ee, out = Path(a.data), Path(a.data) / "ee", Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    fields = load_fields(data, [c for c in a.counties.split(",") if c], [i for i in a.ids.split(",") if i])
    if fields.empty:
        sys.exit("no fields selected")
    fids = set(fields.fid)
    log(f"{len(fids)} fields in {sorted(fields.cfips.unique())}; reading {data}")

    cdl = pd.read_csv(ee / "cdl.csv")
    cdl = cdl[cdl.fid.isin(fids)]
    terr = pd.read_csv(ee / "terrain.csv")
    terr = terr[(terr.layer == "3dep") & terr.fid.isin(fids)].set_index("fid")
    soil = pd.read_csv(data / "ssurgo_fields.csv").set_index("fid")
    ny, prices = nass_yield_rows(data), nass_prices(data)
    log("landsat"); ls_all, ls89 = landsat(ee, fids)
    log("Daymet"); gm_m, gm_frost = daymet(ee, fids)
    log("PRISM"); pr = prism(ee, fids)
    log("IMERG"); im = imerg(ee, fids)
    log("SMAP"); sm_anom = smap_anomaly(ee, fids)
    log("validation series"); scenes89, smap_m = landsat89_scenes(ee, fids), smap_rootzone_monthly(ee, fids)
    log("writing files")

    gm_m = gm_m.set_index(["fid", "year", "month"]).sort_index()
    gm_frost = gm_frost.set_index(["fid", "year"])
    market_cache, index, problems = {}, [], []
    for f in fields.itertuples():
        fid = f.fid
        # crop history (CDL 2008-2025)
        crop_hist = []
        for r in cdl[cdl.fid == fid].sort_values("year").itertuples():
            if pd.isna(r.cropland_mode):
                continue
            code = int(r.cropland_mode)
            crop_hist.append({"year": int(r.year), "crop": CDL_TO_CROP.get(code, "other"), "cdlCode": code,
                              "cdlClass": CDL_CLASS.get(code, "noncrop" if code >= 111 else "other")})

        # climate: Daymet months must be complete to count as a year
        g = gm_m.loc[fid] if fid in gm_m.index.get_level_values(0) else None
        climate, climate_monthly = [], []
        if g is not None:
            for y, gy in g.groupby(level="year"):
                y = int(y)
                full = len(gy) == 12 and gy.precipMm.notna().all() and gy.tMaxC.notna().all()
                for (yy, m), r in gy.iterrows():
                    if full:
                        climate_monthly.append({"year": y, "month": int(m), "precipMm": nn(r.precipMm, 1),
                                                "tMinC": nn(r.tMinC, 1), "tMaxC": nn(r.tMaxC, 1)})
                if not full:
                    continue
                fr = gm_frost.loc[(fid, y)] if (fid, y) in gm_frost.index else None
                ls_, ff_ = (fr.lastFrost, fr.firstFrost) if fr is not None else (None, None)
                p_ = pr.loc[(fid, y)].to_dict() if len(pr) and (fid, y) in pr.index else {}
                i_ = im.loc[(fid, y)].to_dict() if len(im) and (fid, y) in im.index else {}
                climate.append({
                    "year": y, "precipMm": nn(gy.precipMm.sum(), 0), "heatStressDays": int(gy.hot.sum()),
                    "frostFreeDays": int(ff_ - ls_) if ls_ is not None and ff_ is not None and not pd.isna(ls_) and not pd.isna(ff_) else None,
                    "soilMoistureAnomaly": nn(sm_anom.get((fid, y))),
                    "heavyStormDays": int(gy.storm.sum()), "precipMmImerg": nn(i_.get("precipMmImerg")),
                    "yearType": None,  # Model C slot supplies year types
                    "precipMmPrism": nn(p_.get("precipMmPrism")), "stormDaysPrism": nn(p_.get("stormDaysPrism")),
                    "lastSpringFrostPrism": p_.get("lastSpringFrostPrism"), "firstFallFrostPrism": p_.get("firstFallFrostPrism"),
                    "frostFreeDaysPrism": nn(p_.get("frostFreeDaysPrism")),
                })
        if len([r for r in climate_monthly]) < 12 * 5:
            problems.append(f"{fid}: fewer than 5 complete Daymet years")

        # greenness: whole record (display) and Landsat 8/9 (bare days)
        L = full_grid(ls_all, fid, FIRST_YEAR, LAST_YEAR)
        ndvi_monthly = [{"year": int(r.year), "month": int(r.month), "ndvi": nn(r.ndvi, 3)} for r in L.itertuples() if not pd.isna(r.ndvi)]
        cover, bare = [], []
        for y, gy in L.groupby("year"):
            vals = gy.set_index("month").ndvi.reindex(range(1, 13))
            if vals.isna().all():
                continue
            filled = vals.interpolate(limit=2, limit_area="inside")
            cover.append({"year": int(y), "months": [state(v) for v in filled], "cloudyMonths": int(vals.isna().sum()), **confidence(int(y))})
            b = bare_days(filled.values)
            if b is not None:
                bare.append({"year": int(y), "days": b[0], "greenDays": b[1], "score": int(round(100 * (1 - b[0] / 365))), **confidence(int(y))})
        L89 = full_grid(ls89, fid, L89_FROM[0], LAST_YEAR)
        L89 = L89[(L89.year > L89_FROM[0]) | (L89.month >= L89_FROM[1])]
        ndvi_l89 = [{"year": int(r.year), "month": int(r.month), "ndvi": nn(r.ndvi, 3)} for r in L89.itertuples() if not pd.isna(r.ndvi)]
        cover89, bare89 = cover_l89(L89)
        if not bare89:
            problems.append(f"{fid}: no Landsat 8/9 year with >= 9 clear months")

        s = soil.loc[fid] if fid in soil.index else None
        t = terr.loc[fid] if fid in terr.index else None
        slope_pct = nn(math.tan(math.radians(t.slope_deg_mean)) * 100, 1) if t is not None and not pd.isna(t.slope_deg_mean) else None

        both = [(x["precipMm"], x["precipMmImerg"]) for x in climate if x["precipMm"] and x["precipMmImerg"]]
        rain_agree = None
        if len(both) >= 5:
            aa, bb = np.array(both, dtype=float).T
            rain_agree = {"years": len(both), "corr": round(float(np.corrcoef(aa, bb)[0, 1]), 2),
                          "imergVsDaymetPct": round(float((bb.mean() - aa.mean()) / aa.mean() * 100), 0)}
        quality = {
            "rainAgreement": rain_agree,
            "rainVsPrism": {"daymet": agreement([(x["precipMmPrism"], x["precipMm"]) for x in climate]),
                            "imerg": agreement([(x["precipMmPrism"], x["precipMmImerg"]) for x in climate])},
            "cloudyMonthsPct": round(100 * float(L.ndvi.isna().mean()), 0),
            "cloudyMonthsPctL89": round(100 * float(L89.ndvi.isna().mean()), 0) if len(L89) else None,
            "climateYears": len(climate), "cropYears": len(crop_hist),
        }
        out_obj = {
            "schemaVersion": SCHEMA, "isSampleData": False,
            "field": {"id": fid, "county": COUNTY_NAMES.get(f.cfips, f.cfips), "countyFips": f.cfips, "state": "TX",
                      "gridCell": f"L30-{fid}", "lat": round(f.lat, 5), "lon": round(f.lon, 5),
                      "areaHa": nn(f.areaHa, 1), "holdout": bool(f.holdout)},
            "soil": soil_obj(s),
            "terrain": {"slopePct": slope_pct, "elevationM": nn(t.elev_mean, 0) if t is not None else None},
            "cropHistory": crop_hist,
            "climateYearly": climate,
            "climateMonthly": climate_monthly,
            "ndviMonthly": ndvi_monthly, "coverYearly": cover, "bareDaysPerYear": bare,
            "ndviMonthlyL89": ndvi_l89, "coverYearlyL89": cover89, "bareDaysPerYearL89": bare89,
            "ndviScenesL89": scenes89.get(fid, []),          # report card check 3 (scene dates)
            "smapRootzoneMonthly": smap_m.get(fid, []),       # report card check 6 (soil moisture)
            "quality": quality,
            "market": market_cache.setdefault(f.cfips, market(f.cfips, ny, prices)),
            "sources": field_sources({
                "daymet": span(x["year"] for x in climate),
                "imerg": span(x["year"] for x in climate if x["precipMmImerg"] is not None),
                "prism": span(x["year"] for x in climate if x["precipMmPrism"] is not None),
                "smap": span(x["year"] for x in climate if x["soilMoistureAnomaly"] is not None),
                "landsat": span({x["year"] for x in ndvi_monthly}),
                "landsat89": span({x["year"] for x in ndvi_l89}),
                "cdl": span(x["year"] for x in crop_hist),
            }),
        }
        (out / f"{fid}.json").write_text(json.dumps(out_obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False), encoding="utf-8")
        index.append({"id": fid, "countyFips": f.cfips, "county": COUNTY_NAMES.get(f.cfips, f.cfips), "lat": round(f.lat, 5),
                      "lon": round(f.lon, 5), "holdout": bool(f.holdout),
                      "texture": out_obj["soil"]["texture"],   # neighbors "on similar soil" (report card check 7)
                      # precompute regional context (RECENT_CROP_YEARS = 8, NEIGHBOR_CROP_YEARS = 6 in precompute_v2.mjs)
                      "recentCrops": sorted({r["crop"] for r in crop_hist[-8:]}),
                      "neighborCrops": sorted({r["crop"] for r in crop_hist[-6:]})})

    idx_path = out.parent / "input-index.json"   # shared/v2/input-index.json for the default --out
    idx_path.parent.mkdir(parents=True, exist_ok=True)
    old = {r["id"]: r for r in json.loads(idx_path.read_text())["fields"]} if idx_path.exists() else {}
    old.update({r["id"]: r for r in index})
    idx_path.write_text(json.dumps({"schemaVersion": 1, "fields": sorted(old.values(), key=lambda r: r["id"])}, indent=0), encoding="utf-8")
    log(f"wrote {len(index)} input files to {out} ({len(old)} in shared/v2/input-index.json)")
    for p in problems[:20]:
        print("  warning:", p)
    if len(problems) > 20:
        print(f"  ... {len(problems) - 20} more warnings")


if __name__ == "__main__":
    main()
