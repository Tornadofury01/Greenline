"""County-level exports for Calibration E: every county in the NASS Blacklands district (25 counties, the 6 study
counties included), so E can be fitted on ~4x more county-years. Used ONLY by Calibration E; the app's fields stay
in the 6 study counties (North Texas scope unchanged).

Jobs (account 1, Drive folder fieldshift_v2_calib):
  cty_weather_<y0>_<y1>  gridMET + gridMET drought + TerraClimate, one row per county-year, columns mMM_<var>
                          (whole county mean, 4 km grids; weather barely varies inside a county)
  cty_modis_<year>       MOD13Q1 NDVI (good-quality pixels) per 16-day composite over each crop's own pixels that
                          year (USDA CDL of that year; Texas CDL starts 2008, earlier years use each crop's usual pixels), only MODIS pixels >= 50 % that crop,
                          columns <crop>_<doy> (mean NDVI) and <crop>_<doy>_n (pixel count)

  python calib_counties.py --dry-run
  python calib_counties.py            # submits on account 1 (skips tasks already queued / running / done)
"""
import argparse
from pathlib import Path

import ee
import pandas as pd

import auth
from run_exports import existing_tasks

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
FOLDER = "fieldshift_v2_calib"
ACCOUNT = 1

# CDL codes per crop group (double crops count for both crops)
CROPS = {"wheat": [24, 26, 225, 236, 238], "corn": [1, 225, 226], "sorghum": [4, 236], "cotton": [2, 238]}
ALLCROP = list(range(1, 62)) + list(range(66, 78)) + list(range(204, 255))   # every CDL crop code
DOYS = list(range(1, 362, 16))                                                # MOD13Q1 composite start days
WEATHER = ["pr", "eto", "tmax", "tmin", "hot", "heavy", "frost", "spei90", "spei30", "def", "aet", "pet", "soil"]
FIRST_TX_CDL = 2008                                                            # first CDL year with Texas pixels
WEATHER_CHUNKS = [(1985, 1992), (1993, 2000), (2001, 2008), (2009, 2016), (2017, 2025)]


def county_ids():
    d = pd.read_csv(DATA / "nass_blacklands_county.csv", dtype=str, usecols=["county_ansi"]).dropna()
    return sorted({"48" + c.zfill(3) for c in d.county_ansi.str.strip() if c})


def counties():
    return ee.FeatureCollection("TIGER/2018/Counties").filter(ee.Filter.inList("GEOID", county_ids())) \
        .map(lambda c: ee.Feature(c.geometry(), {"cfips": c.get("GEOID")}))


def month_image(y, m):
    s = ee.Date.fromYMD(y, m, 1)
    e = s.advance(1, "month")
    gm = ee.ImageCollection("IDAHO_EPSCOR/GRIDMET").filterDate(s, e)
    tcc = ee.ImageCollection("IDAHO_EPSCOR/TERRACLIMATE").filterDate(s, e).select(["def", "aet", "pet", "soil"])
    empty = ee.Image.constant([0, 0, 0, 0]).rename(["def", "aet", "pet", "soil"]).updateMask(0)
    tc = ee.Image(ee.Algorithms.If(tcc.size().gt(0), tcc.first(), empty)).multiply(ee.Image([0.1, 0.1, 0.1, 0.1]))  # mm
    drc = ee.ImageCollection("GRIDMET/DROUGHT").filterDate(s, e).sort("system:time_start", False).select(["spei90d", "spei30d"])
    dr = ee.Image(ee.Algorithms.If(drc.size().gt(0), drc.first(), ee.Image.constant([0, 0]).rename(["spei90d", "spei30d"]).updateMask(0)))
    img = ee.Image.cat([
        gm.select("pr").sum().rename("pr"), gm.select("eto").sum().rename("eto"),
        gm.select("tmmx").mean().subtract(273.15).rename("tmax"), gm.select("tmmn").mean().subtract(273.15).rename("tmin"),
        gm.select("tmmx").map(lambda i: i.gte(308.15)).sum().rename("hot"),        # days >= 35 C
        gm.select("pr").map(lambda i: i.gte(25)).sum().rename("heavy"),            # days >= 25 mm
        gm.select("tmmn").map(lambda i: i.lte(273.15)).sum().rename("frost"),      # days <= 0 C
        dr.rename(["spei90", "spei30"]),            # last value in the month
        tc])
    return img.rename([f"m{m:02d}_{b}" for b in WEATHER])


def weather_job(y0, y1):
    fc = counties()
    parts = []
    for y in range(y0, y1 + 1):
        img = ee.Image.cat([month_image(y, m) for m in range(1, 13)])
        out = img.reduceRegions(collection=fc, reducer=ee.Reducer.mean(), scale=4000, tileScale=2)
        parts.append(out.map(lambda f, y=y: f.set("year", y)))
    sel = ["cfips", "year"] + [f"m{m:02d}_{b}" for m in range(1, 13) for b in WEATHER]
    return ee.FeatureCollection(parts).flatten(), sel


def modis_job(year):
    fc = counties()
    proj = ee.ImageCollection("MODIS/061/MOD13Q1").first().projection()
    masks = {}
    if year >= FIRST_TX_CDL:
        cdl = ee.ImageCollection("USDA/NASS/CDL").filterDate(f"{year}-01-01", f"{year + 1}-01-01").first().select("cropland")
        cdl = cdl.reproject(cdl.projection().atScale(30))     # CDL 2024+ is 10 m: sample to 30 m first (EE pixel limits)
        is_crop = lambda codes: cdl.remap(codes, [1] * len(codes), 0)
    else:
        # CDL has no Texas pixels before 2008: use each crop's USUAL pixels (that crop in >= 3 of the 7 CDL years 2008-2014)
        hist = ee.ImageCollection("USDA/NASS/CDL").filterDate("2008-01-01", "2015-01-01").select("cropland")
        p30 = hist.first().projection().atScale(30)
        is_crop = lambda codes: hist.map(lambda i: i.remap(codes, [1] * len(codes), 0)).sum().gte(3).setDefaultProjection(p30)
    for g, codes in {**CROPS, "crop": ALLCROP}.items():
        frac = is_crop(codes).reduceResolution(ee.Reducer.mean(), maxPixels=1024).reproject(proj)
        masks[g] = frac.gte(0.5)
    col = ee.ImageCollection("MODIS/061/MOD13Q1").filterDate(f"{year}-01-01", f"{year + 1}-01-01")
    bands, names = [], []
    for doy in DOYS:
        d = ee.Date.fromYMD(year, 1, 1).advance(doy - 1, "day")
        im = col.filterDate(d, d.advance(1, "day"))
        nd = ee.Image(ee.Algorithms.If(im.size().gt(0),
                                       im.first().select("NDVI").multiply(1e-4).updateMask(im.first().select("SummaryQA").lte(1)),
                                       ee.Image.constant(0).updateMask(0))).rename("ndvi")
        for g, mk in masks.items():
            bands.append(nd.updateMask(mk).rename(f"{g}_{doy:03d}"))
    img = ee.Image.cat(bands)
    red = ee.Reducer.mean().combine(ee.Reducer.count(), sharedInputs=True)
    out = img.reduceRegions(collection=fc, reducer=red, scale=250, crs=proj, tileScale=4)
    out = out.map(lambda f: f.set("year", year))
    sel = ["cfips", "year"]
    for doy in DOYS:
        for g in masks:
            sel += [f"{g}_{doy:03d}_mean", f"{g}_{doy:03d}_count"]
    return out, sel


def jobs():
    out = [(f"cty_weather_{a}_{b}", lambda a=a, b=b: weather_job(a, b)) for a, b in WEATHER_CHUNKS]
    out += [(f"cty_modis_{y}", lambda y=y: modis_job(y)) for y in range(2000, 2026)]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--redo", default="")
    a = ap.parse_args()
    auth.init(ACCOUNT)
    print(f"{len(county_ids())} counties")
    have = existing_tasks()
    redo = set(filter(None, a.redo.split(",")))
    n = 0
    for name, build in jobs():
        if have.get(name) in ("PENDING", "RUNNING", "SUCCEEDED") and name not in redo:
            print(f"  skip {name} ({have[name]})")
            continue
        if a.dry_run:
            print(f"  would submit {name}")
            continue
        fc, sel = build()
        ee.batch.Export.table.toDrive(collection=fc, description=name, folder=FOLDER, fileNamePrefix=name,
                                      fileFormat="CSV", selectors=sel).start()
        n += 1
        print(f"  submitted {name}", flush=True)
    print(f"{n} tasks submitted on account {ACCOUNT}")


if __name__ == "__main__":
    main()
