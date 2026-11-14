"""Multi-field sample for training the SI models (pipeline/models/).

Picks 200 random cropland pixels across North Texas from the Cropland Data Layer, plus the
Ellis County demo field, and exports per-field monthly tables to pipeline/data/fields/.
Points are CDL pixel centers chosen by us, never a farmer's GPS position.

Usage (from the repo root):
    pipeline/.venv/Scripts/python pipeline/sample_fields.py all
Steps: fields, landsat, cdl, smap, imerg, storms, et, power, all
"""
import argparse
import sys
import time
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from greenline_pipeline import EE_PROJECT, FIELD, ee_init, landsat_collection  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "fields"
N_FIELDS = 200
SEED = 42
Y0, Y1 = 2008, 2025            # CDL years we can label
# North Texas: DFW, Blackland Prairie, Cross Timbers and the Red River counties.
BBOX = [-98.5, 31.5, -95.5, 34.0]
BUFFER_M = 45                  # ~3x3 Landsat pixels around each point


def save(df, name):
    OUT.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT / f"{name}.csv", index=False)
    print(f"  wrote data/fields/{name}.csv ({len(df)} rows)")


def fields_fc(ee, point=False):
    """Field buffers for 30 m data. point=True for coarse grids (SMAP, IMERG, MODIS): a small buffer
    contains no pixel center there, so we sample the pixel under the field point instead."""
    f = pd.read_csv(OUT / "fields.csv")
    geom = (lambda r: ee.Geometry.Point([r.lon, r.lat])) if point else (lambda r: ee.Geometry.Point([r.lon, r.lat]).buffer(BUFFER_M))
    return ee.FeatureCollection([ee.Feature(geom(r), {"fieldId": r.fieldId})
                                 for r in f.itertuples()])


def is_cropland(img):
    c = img.select("cropland")
    # CDL crop codes (row crops, small grains, double crops, fallow). Excludes hay, pasture, forest, urban, water.
    return c.lte(61).Or(c.gte(66).And(c.lte(77))).Or(c.gte(204).And(c.lte(254))).And(c.neq(37))


def run_fields():
    print("Sampling cropland fields ...")
    ee = ee_init()
    cdl = ee.ImageCollection("USDA/NASS/CDL")
    region = ee.Geometry.Rectangle(BBOX)
    # Cropland in 2024 AND cropland in at least half the CDL years, and not on a field edge (3x3 all cropland).
    crop24 = is_cropland(ee.Image("USDA/NASS/CDL/2024"))
    often = cdl.filterDate(f"{Y0}-01-01", f"{Y1 + 1}-01-01").map(is_cropland).mean().gte(0.5)
    mask = crop24.And(often).focalMin(1.5, "square", "pixels").selfMask().rename("m")
    pts = mask.sample(region=region, scale=30, numPixels=40000, seed=SEED, geometries=True) \
        .randomColumn("r", SEED).sort("r").limit(N_FIELDS)
    rows = [{"lon": round(f["geometry"]["coordinates"][0], 5), "lat": round(f["geometry"]["coordinates"][1], 5)}
            for f in pts.getInfo()["features"]]
    df = pd.DataFrame(rows)
    df.insert(0, "fieldId", [f"nt-{i + 1:03d}" for i in range(len(df))])
    demo = pd.DataFrame([{"fieldId": FIELD["id"], "lon": FIELD["lon"], "lat": FIELD["lat"]}])
    df = pd.concat([demo, df], ignore_index=True)
    # County name, for reporting
    counties = ee.FeatureCollection("TIGER/2018/Counties").filter(ee.Filter.eq("STATEFP", "48"))
    names = []
    for r in df.itertuples():
        names.append(None)
    fc = ee.FeatureCollection([ee.Feature(ee.Geometry.Point([r.lon, r.lat]), {"fieldId": r.fieldId}) for r in df.itertuples()])
    joined = ee.Join.saveFirst("c").apply(fc, counties, ee.Filter.intersects(".geo", None, ".geo"))
    cmap = {f["properties"]["fieldId"]: f["properties"]["c"]["properties"]["NAME"]
            for f in joined.getInfo()["features"]}
    df["county"] = df.fieldId.map(cmap)
    save(df, "fields")


def per_month_sample(ee, col, bands, y0, y1, scale, reducer="median", name=None):
    """One composite per month, reduced over every field buffer at once."""
    fc = fields_fc(ee, point=scale > 100)
    parts = []
    for y in range(y0, y1 + 1):
        for attempt in range(3):
            try:
                feats = []
                for m in range(1, 13):
                    s = ee.Date.fromYMD(y, m, 1)
                    sub = col.filterDate(s, s.advance(1, "month")).select(bands)
                    empty = ee.Image.constant([0] * len(bands)).rename(bands).updateMask(0)
                    img = ee.Image(ee.Algorithms.If(sub.size().gt(0), getattr(sub, reducer)(), empty))
                    r = img.reduceRegions(fc, ee.Reducer.mean(), scale).map(
                        lambda f, m=m, n=sub.size(): f.set({"year": y, "month": m, "n": n}).setGeometry(None))
                    feats.append(r)
                got = ee.FeatureCollection(feats).flatten().getInfo()["features"]
                part = pd.DataFrame([g["properties"] for g in got])
                if len(bands) == 1 and "mean" in part:  # EE names a single-band output after the reducer
                    part = part.rename(columns={"mean": bands[0]})
                parts.append(part)
                print(f"  {name} {y}")
                break
            except Exception as e:
                print(f"  {name} {y} retry ({str(e)[:80]})")
                time.sleep(5)
        else:
            raise RuntimeError(f"{name} {y} failed")
    df = pd.concat(parts, ignore_index=True)
    # A band with no valid pixels comes back missing; keep the column
    for b in bands:
        if b not in df:
            df[b] = None
    return df[["fieldId", "year", "month", "n"] + bands]


def run_landsat():
    print("Landsat NDVI/NDTI/BSI per field ...")
    ee = ee_init()
    df = per_month_sample(ee, landsat_collection_all(ee), ["ndvi", "ndti", "bsi"], Y0, Y1, 30, name="landsat")
    save(df.rename(columns={"n": "scenes"}).round(4), "landsat_monthly")


def landsat_collection_all(ee):
    # Same processing as the demo field, but over the whole North Texas box.
    import greenline_pipeline as gp
    old = gp.region
    gp.region = lambda ee_: ee_.Geometry.Rectangle(BBOX)
    try:
        return landsat_collection(ee)
    finally:
        gp.region = old


def run_cdl():
    print("CDL per field ...")
    ee = ee_init()
    fc = fields_fc(ee)
    col = ee.ImageCollection("USDA/NASS/CDL").filterDate(f"{Y0}-01-01", f"{Y1 + 1}-01-01").select("cropland")
    r = col.map(lambda i: i.reduceRegions(fc, ee.Reducer.mode(), 30).map(
        lambda f: f.set("year", ee.Date(i.get("system:time_start")).get("year")).setGeometry(None))).flatten()
    df = pd.DataFrame([g["properties"] for g in r.getInfo()["features"]]).rename(columns={"mode": "code"})
    df = df.dropna(subset=["code"])
    df["code"] = df.code.astype(int)
    save(df[["fieldId", "year", "code"]].sort_values(["fieldId", "year"]), "cdl")


def run_smap():
    print("SMAP L4 per field ...")
    ee = ee_init()
    col = ee.ImageCollection("NASA/SMAP/SPL4SMGP/008").select(["sm_surface", "sm_rootzone"]) \
        .filter(ee.Filter.calendarRange(12, 14, "hour"))  # one 3-hourly image per day (13:30 UTC)
    df = per_month_sample(ee, col, ["sm_surface", "sm_rootzone"], 2015, Y1, 11000, "mean", name="smap")
    save(df.rename(columns={"n": "days"}).round(4), "smap_monthly")


def run_imerg():
    print("IMERG monthly per field ...")
    ee = ee_init()
    col = ee.ImageCollection("NASA/GPM_L3/IMERG_MONTHLY_V07").select("precipitation")
    df = per_month_sample(ee, col, ["precipitation"], Y0, Y1, 11000, "mean", name="imerg")
    hours = pd.to_datetime(dict(year=df.year, month=df.month, day=1)).dt.days_in_month * 24
    df["precipMm"] = (df.precipitation * hours).round(1)
    save(df[["fieldId", "year", "month", "precipMm"]], "imerg_monthly")


def run_storms():
    """Days per month with >= 25 mm of rain, from half-hourly IMERG V07 summed to daily."""
    print("IMERG storm days per field ...")
    ee = ee_init()
    fc = fields_fc(ee, point=True)
    hh = ee.ImageCollection("NASA/GPM_L3/IMERG_V07").select("precipitation")
    parts = []
    for y in range(Y0, Y1 + 1):
        for m in range(1, 13):
            s = ee.Date.fromYMD(y, m, 1)
            ndays = s.advance(1, "month").difference(s, "day")
            days = ee.List.sequence(0, ndays.subtract(1))
            # mm/hr averaged over 30 min -> mm per half hour = value * 0.5
            daily = ee.ImageCollection(days.map(lambda d: hh.filterDate(s.advance(d, "day"), s.advance(ee.Number(d).add(1), "day"))
                                                .sum().multiply(0.5).gte(25)))
            r = daily.sum().rename("stormDays").reduceRegions(fc, ee.Reducer.mean(), 11000) \
                .map(lambda f, m=m: f.set({"year": y, "month": m}).setGeometry(None))
            for attempt in range(3):
                try:
                    parts.append(pd.DataFrame([g["properties"] for g in r.getInfo()["features"]]))
                    break
                except Exception as e:
                    print(f"  storms {y}-{m} retry ({str(e)[:80]})")
                    time.sleep(5)
        print(f"  storms {y}")
    df = pd.concat(parts, ignore_index=True).rename(columns={"mean": "stormDays"})
    save(df[["fieldId", "year", "month", "stormDays"]], "imerg_storms_monthly")


def run_et():
    print("MODIS ET (MOD16A2GF) per field ...")
    ee = ee_init()
    # ET is kg/m2 per 8 days, scale 0.1. Sum of composites ~ monthly total (8-day periods split across months are approximate).
    col = ee.ImageCollection("MODIS/061/MOD16A2GF").map(
        lambda i: i.select(["ET", "PET"]).multiply(0.1).copyProperties(i, ["system:time_start"]))
    df = per_month_sample(ee, col, ["ET", "PET"], Y0, Y1, 500, "sum", name="et")
    save(df.rename(columns={"ET": "etMm", "PET": "petMm", "n": "composites"}).round(1), "modis_et_monthly")


def run_power():
    """NASA POWER daily per unique POWER grid cell -> monthly heat and rain per field."""
    print("NASA POWER per field ...")
    f = pd.read_csv(OUT / "fields.csv")
    # POWER grid is 0.5 deg lat x 0.625 deg lon; one request per cell.
    f["cell"] = (f.lat / 0.5).round().astype(int).astype(str) + "_" + (f.lon / 0.625).round().astype(int).astype(str)
    out = []
    for cell, grp in f.groupby("cell"):
        lat, lon = grp.lat.mean(), grp.lon.mean()
        url = ("https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MAX,T2M_MIN,PRECTOTCORR"
               f"&community=AG&latitude={lat:.3f}&longitude={lon:.3f}&start={Y0}0101&end={Y1}1231&format=JSON")
        for attempt in range(3):
            try:
                p = requests.get(url, timeout=180).json()["properties"]["parameter"]
                break
            except Exception as e:
                print(f"  power {cell} retry ({e})")
                time.sleep(10)
        d = pd.DataFrame(p).replace(-999, pd.NA).astype(float)
        d.index = pd.to_datetime(d.index, format="%Y%m%d")
        m = pd.DataFrame({
            "tMaxC": d.T2M_MAX.resample("MS").mean(), "tMinC": d.T2M_MIN.resample("MS").mean(),
            "precipMm": d.PRECTOTCORR.resample("MS").sum(),
            "heatStressDays": (d.T2M_MAX >= 35).resample("MS").sum(),
        }).reset_index(names="date")
        m["year"], m["month"] = m.date.dt.year, m.date.dt.month
        for fid in grp.fieldId:
            out.append(m.drop(columns="date").assign(fieldId=fid, powerCell=cell))
        print(f"  power cell {cell} ({len(grp)} fields)")
    df = pd.concat(out, ignore_index=True)
    save(df[["fieldId", "powerCell", "year", "month", "tMaxC", "tMinC", "precipMm", "heatStressDays"]].round(2), "power_monthly")


STEPS = {"fields": run_fields, "cdl": run_cdl, "landsat": run_landsat, "smap": run_smap, "imerg": run_imerg,
         "storms": run_storms, "et": run_et, "power": run_power}

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("steps", nargs="+", choices=[*STEPS, "all"])
    a = ap.parse_args()
    for s in (list(STEPS) if "all" in a.steps else a.steps):
        STEPS[s]()
