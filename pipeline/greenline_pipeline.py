"""Greenline NASA data pipeline.

Exports monthly CSVs for one demo field into pipeline/data/, following
/shared/data-format.md ("Pipeline CSV outputs" section).

Usage (from the repo root):
    pipeline\\.venv\\Scripts\\python pipeline\\greenline_pipeline.py power
    pipeline\\.venv\\Scripts\\python pipeline\\greenline_pipeline.py all

Datasets: power, landsat, hls, modis, cdl, smap, imerg, terrain, nass, all.
Secrets (NASS_API_KEY) are read from the repo-root .env only. Never print them.
"""
import argparse
import os
import sys
import time
from datetime import date
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(__file__).resolve().parent / "data"
load_dotenv(ROOT / ".env")

EE_PROJECT = "skillful-cider-490516-f6"

# Demo field: a cultivated cropland pixel in Ellis County, TX (Blackland Prairie,
# between Italy and Avalon). Confirmed as cropland in the CDL by the `cdl` step.
FIELD = {
    "id": "demo-ellis-001",
    "county": "Ellis",
    "state": "TX",
    "lat": 32.1820,
    "lon": -96.8350,
}
BUFFER_M = 60  # radius around the point used for satellite averages (~1 ha)

TODAY = date.today()


def save(df, name):
    DATA.mkdir(parents=True, exist_ok=True)
    path = DATA / f"{name}.csv"
    df.to_csv(path, index=False)
    print(f"  wrote {path.relative_to(ROOT)} ({len(df)} rows)")
    return df


# ---------------------------------------------------------------- NASA POWER
def run_power():
    """Daily NASA POWER weather -> monthly temps, rain, heat-stress days,
    plus a yearly frost-date file."""
    print("NASA POWER ...")
    start, end = 1984, TODAY.year
    frames = []
    # POWER limits daily requests, so fetch ~10 years at a time.
    for y0 in range(start, end + 1, 10):
        y1 = min(y0 + 9, end)
        r = requests.get(
            "https://power.larc.nasa.gov/api/temporal/daily/point",
            params={
                "parameters": "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR",
                "community": "AG",
                "latitude": FIELD["lat"],
                "longitude": FIELD["lon"],
                "start": f"{y0}0101",
                "end": f"{y1}1231" if y1 < end else TODAY.strftime("%Y%m%d"),
                "format": "JSON",
            },
            timeout=120,
        )
        r.raise_for_status()
        p = r.json()["properties"]["parameter"]
        frames.append(pd.DataFrame(p))
    d = pd.concat(frames)
    d.index = pd.to_datetime(d.index, format="%Y%m%d")
    d = d.replace(-999.0, pd.NA).dropna().astype(float)
    d["year"], d["month"] = d.index.year, d.index.month

    monthly = d.groupby(["year", "month"]).agg(
        tMeanC=("T2M", "mean"),
        tMaxC=("T2M_MAX", "mean"),
        tMinC=("T2M_MIN", "mean"),
        precipMm=("PRECTOTCORR", "sum"),
        heatStressDays=("T2M_MAX", lambda s: int((s >= 35).sum())),
        frostDays=("T2M_MIN", lambda s: int((s <= 0).sum())),
        daysWithData=("T2M", "size"),
    ).reset_index().round(2)
    save(monthly, "power_monthly")

    # Frost dates: last spring frost (before Jul 1) and first fall frost (after Jul 1), Tmin <= 0 C.
    rows = []
    for year, g in d.groupby("year"):
        frost = g[g["T2M_MIN"] <= 0].index
        spring = frost[frost.month < 7]
        fall = frost[frost.month >= 7]
        last_spring = spring.max() if len(spring) else None
        first_fall = fall.min() if len(fall) else None
        ffd = (first_fall - last_spring).days if last_spring is not None and first_fall is not None else None
        rows.append({
            "year": year,
            "lastSpringFrost": last_spring.date() if last_spring is not None else "",
            "firstFallFrost": first_fall.date() if first_fall is not None else "",
            "frostFreeDays": ffd if ffd is not None else "",
            "heatStressDays": int((g["T2M_MAX"] >= 35).sum()),
            "precipMm": round(g["PRECTOTCORR"].sum(), 1),
            "completeYear": len(g) >= 365,
        })
    save(pd.DataFrame(rows), "power_yearly")


# ---------------------------------------------------------------- NASS Quick Stats
def run_nass():
    """NASS Crop Progress (Texas, weekly) -> monthly mean percent by crop and stage."""
    print("NASS Crop Progress ...")
    key = os.getenv("NASS_API_KEY")
    if not key:
        sys.exit("NASS_API_KEY missing. Add it to the repo-root .env (see .env.example).")
    out = []
    for year in range(2000, TODAY.year + 1):
        params = {
            "key": key, "source_desc": "SURVEY", "program_desc": "SURVEY",
            "sector_desc": "CROPS", "statisticcat_desc": "PROGRESS",
            "agg_level_desc": "STATE", "state_alpha": "TX",
            "freq_desc": "WEEKLY", "year": year, "format": "JSON",
        }
        r = requests.get("https://quickstats.nass.usda.gov/api/api_GET/", params=params, timeout=120)
        if r.status_code == 400:  # no data for that year
            continue
        if not r.ok:  # don't use raise_for_status: its message would include the key in the URL
            sys.exit(f"NASS request failed for {year}: HTTP {r.status_code}")
        out.extend(r.json().get("data", []))
        time.sleep(0.3)
    if not out:
        sys.exit("NASS returned no data.")
    df = pd.DataFrame(out)
    df["pct"] = pd.to_numeric(df["Value"].str.replace(",", ""), errors="coerce")
    df["weekEnding"] = pd.to_datetime(df["week_ending"], errors="coerce")
    df = df.dropna(subset=["pct", "weekEnding"])
    df["month"] = df["weekEnding"].dt.month
    df["stage"] = df["short_desc"].str.split("PCT ").str[-1].str.lower()
    monthly = df.groupby(["year", "month", "commodity_desc", "stage"]).agg(
        pctMean=("pct", "mean"), pctEndOfMonth=("pct", "last"), weeks=("pct", "size"),
    ).reset_index().rename(columns={"commodity_desc": "crop"}).round(1)
    monthly["crop"] = monthly["crop"].str.lower()
    save(monthly.sort_values(["year", "month", "crop", "stage"]), "nass_crop_progress_tx_monthly")


# ---------------------------------------------------------------- Earth Engine
def ee_init():
    import ee
    try:
        ee.Initialize(project=EE_PROJECT)
    except Exception as e:
        sys.exit(f"Earth Engine init failed ({e}).\nRun: earthengine authenticate  (see pipeline/README.md)")
    return ee


def region(ee):
    return ee.Geometry.Point([FIELD["lon"], FIELD["lat"]]).buffer(BUFFER_M)


def monthly_composites(ee, col, bands, reducer_name, start_year, end_year, scale):
    """Reduce an ImageCollection to one value per band per month over the field."""
    geom = region(ee)
    months = ee.List([[y, m] for y in range(start_year, end_year + 1) for m in range(1, 13)])

    def per_month(ym):
        ym = ee.List(ym)
        y, m = ee.Number(ym.get(0)), ee.Number(ym.get(1))
        s = ee.Date.fromYMD(y, m, 1)
        sub = col.filterDate(s, s.advance(1, "month")).select(bands)
        n = sub.size()
        img = ee.Algorithms.If(n.gt(0), getattr(sub, reducer_name)(), ee.Image.constant([0] * len(bands)).rename(bands).updateMask(0))
        vals = ee.Image(img).reduceRegion(ee.Reducer.mean(), geom, scale, maxPixels=1e9)
        return ee.Feature(None, vals).set({"year": y, "month": m, "scenes": n})

    fc = ee.FeatureCollection(months.map(per_month))
    rows = fc.getInfo()["features"]
    return pd.DataFrame([r["properties"] for r in rows])


def chunked(ee, col, bands, reducer, y0, y1, scale, step=5):
    parts = [monthly_composites(ee, col, bands, reducer, a, min(a + step - 1, y1), scale)
             for a in range(y0, y1 + 1, step)]
    df = pd.concat(parts, ignore_index=True)
    return df[["year", "month", "scenes"] + bands]


def landsat_collection(ee):
    """Landsat 5/7/8/9 Collection 2 L2 surface reflectance, cloud-masked, harmonized band names,
    with NDVI, NDTI (residue) and BSI (bare soil)."""
    def prep(img, blue, green, red, nir, swir1, swir2):
        qa = img.select("QA_PIXEL")
        clear = qa.bitwiseAnd(0b11111).eq(0)  # fill, dilated cloud, cirrus, cloud, shadow
        sr = img.select([blue, green, red, nir, swir1, swir2], ["B", "G", "R", "N", "S1", "S2"]) \
            .multiply(0.0000275).add(-0.2)
        ndvi = sr.normalizedDifference(["N", "R"]).rename("ndvi")
        ndti = sr.normalizedDifference(["S1", "S2"]).rename("ndti")
        bsi = sr.expression("((S1 + R) - (N + B)) / ((S1 + R) + (N + B))",
                            {"S1": sr.select("S1"), "R": sr.select("R"), "N": sr.select("N"), "B": sr.select("B")}).rename("bsi")
        return ndvi.addBands([ndti, bsi]).updateMask(clear).copyProperties(img, ["system:time_start"])

    tm = lambda i: prep(i, "SR_B1", "SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B7")
    oli = lambda i: prep(i, "SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7")
    g = region(ee)
    c = lambda cid, f: ee.ImageCollection(cid).filterBounds(g).map(f)
    return (c("LANDSAT/LT05/C02/T1_L2", tm)
            .merge(c("LANDSAT/LE07/C02/T1_L2", tm))
            .merge(c("LANDSAT/LC08/C02/T1_L2", oli))
            .merge(c("LANDSAT/LC09/C02/T1_L2", oli)))


def run_landsat():
    print("Landsat 5/7/8/9 NDVI/NDTI/BSI ...")
    ee = ee_init()
    df = chunked(ee, landsat_collection(ee), ["ndvi", "ndti", "bsi"], "median", 1984, TODAY.year, 30)
    df = df[~((df.year == TODAY.year) & (df.month > TODAY.month))]
    save(df.round(4), "landsat_monthly")


def run_hls():
    print("HLS Sentinel-2 NDVI ...")
    ee = ee_init()
    g = region(ee)

    def prep(img):
        fmask = img.select("Fmask")
        clear = fmask.bitwiseAnd(0b1110).eq(0)  # cloud, adjacent, shadow
        return img.normalizedDifference(["B8A", "B4"]).rename("ndvi").updateMask(clear) \
            .copyProperties(img, ["system:time_start"])

    col = ee.ImageCollection("NASA/HLS/HLSS30/v002").filterBounds(g).map(prep)
    df = chunked(ee, col, ["ndvi"], "median", 2016, TODAY.year, 30, step=3)
    save(df.round(4), "hls_s30_monthly")


def run_modis():
    print("MODIS NDVI (MOD13Q1, 250 m) ...")
    ee = ee_init()
    col = ee.ImageCollection("MODIS/061/MOD13Q1").map(
        lambda i: i.select("NDVI").multiply(0.0001).rename("ndvi")
        .updateMask(i.select("SummaryQA").lte(1)).copyProperties(i, ["system:time_start"]))
    df = chunked(ee, col, ["ndvi"], "mean", 2000, TODAY.year, 250, step=8)
    save(df.round(4), "modis_ndvi_monthly")


def run_cdl():
    print("Cropland Data Layer ...")
    ee = ee_init()
    pt = ee.Geometry.Point([FIELD["lon"], FIELD["lat"]])
    col = ee.ImageCollection("USDA/NASS/CDL").filterDate("2008-01-01", f"{TODAY.year + 1}-01-01").select("cropland")
    names = dict(zip(*[ee.Image(col.first()).get(k).getInfo() for k in ("cropland_class_values", "cropland_class_names")]))

    def sample(img):
        v = img.reduceRegion(ee.Reducer.mode(), pt.buffer(BUFFER_M), 30).get("cropland")
        return ee.Feature(None, {"year": ee.Date(img.get("system:time_start")).get("year"), "code": v})

    rows = [f["properties"] for f in ee.FeatureCollection(col.map(sample)).getInfo()["features"]]
    df = pd.DataFrame(rows).dropna()
    df["code"] = df["code"].astype(int)
    df["cdlName"] = df["code"].map(names)
    save(df.sort_values("year")[["year", "code", "cdlName"]], "cdl_history")


def run_smap():
    print("SMAP L4 soil moisture ...")
    ee = ee_init()
    col = ee.ImageCollection("NASA/SMAP/SPL4SMGP/007").select(["sm_surface", "sm_rootzone"])
    # 3-hourly data: keep one image per day at 12:00 UTC to keep the job small.
    col = col.filter(ee.Filter.calendarRange(12, 12, "hour"))
    df = chunked(ee, col, ["sm_surface", "sm_rootzone"], "mean", 2015, TODAY.year, 11000, step=3)
    df = df.rename(columns={"scenes": "days"})
    save(df.round(4), "smap_monthly")


def run_imerg():
    print("GPM IMERG rainfall ...")
    ee = ee_init()
    g = region(ee)
    # Monthly product: precipitation is mm/hr averaged over the month.
    col = ee.ImageCollection("NASA/GPM_L3/IMERG_MONTHLY_V07").select("precipitation")
    rows = col.filterDate("2000-06-01", TODAY.isoformat()).map(
        lambda i: ee.Feature(None, i.reduceRegion(ee.Reducer.mean(), g, 11000)).set({
            "year": i.date().get("year"), "month": i.date().get("month"),
            "hours": i.date().advance(1, "month").difference(i.date(), "hour")})).getInfo()["features"]
    df = pd.DataFrame([r["properties"] for r in rows]).dropna()
    df["precipMm"] = (df["precipitation"] * df["hours"]).round(1)
    save(df[["year", "month", "precipMm"]], "imerg_monthly")


def run_terrain():
    print("SRTM elevation / slope ...")
    ee = ee_init()
    dem = ee.Image("USGS/SRTMGL1_003")
    slope_deg = ee.Terrain.slope(dem)
    slope_pct = slope_deg.multiply(3.14159265 / 180).tan().multiply(100).rename("slopePct")
    v = dem.rename("elevationM").addBands(slope_pct).reduceRegion(
        ee.Reducer.mean(), region(ee), 30).getInfo()
    save(pd.DataFrame([{k: round(x, 2) for k, x in v.items()}]), "terrain")


STEPS = {"power": run_power, "landsat": run_landsat, "hls": run_hls, "modis": run_modis,
         "cdl": run_cdl, "smap": run_smap, "imerg": run_imerg, "terrain": run_terrain, "nass": run_nass}

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dataset", choices=[*STEPS, "all"])
    a = ap.parse_args()
    for name in (STEPS if a.dataset == "all" else [a.dataset]):
        STEPS[name]()
