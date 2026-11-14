"""Field Shift study fields -> the per-field CSVs that pipeline/build_fields.py reads (pipeline/data/fields/).

The app's fields are the 300 USDA Crop Sequence Boundary fields nearest 32.25 N, 96.75 W (Ellis County, TX) that the
Field Shift models were trained on (field_shift_export_round2.ipynb), ids ec-000 ... ec-299 (= study field_id 0-299).

Inputs (all in this folder):
  data/fields_index.csv, data/fields.geojson   field centroids and outlines (Earth Engine export)
  models/ndvi_timeseries.csv.gz                 per-scene Landsat 5/7/8/9 (+ HLS) NDVI / NDTI / BSI per field
  models/cdl_history.csv                        USDA CDL majority code per field-year
  models/power_daily.csv                        NASA POWER daily at the study point (one ~50 km cell for all fields)
  models/smap_soil_moisture.csv                 SMAP surface soil moisture at the study point
  models/r2/imerg_daily_rain.csv                GPM IMERG daily rain over the study area
  replay/data/raw/fields_terrain.csv            SRTM elevation and slope per field
  data/prism_area.csv                           PRISM 4 km for the study area (see PRISM below)
Plus USDA SSURGO per field centroid from Soil Data Access (public REST API, no key), cached in data/ssurgo.csv.

PRISM: the study notebooks didn't export PRISM. data/prism_area.csv holds the PRISM 4 km series of the old sample
field nt-103 (32.207 N, 96.753 W), 4.8 km south of the study centre and inside the same 8 km study area. It is used
as the area value for every study field and labelled "area" scale in the app, never as a per-field measurement.

Run from the repo root:  python pipeline/fieldshift/build_app_inputs.py   (then export_si.py, then build_fields.py)
"""
import json, time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / "pipeline" / "data" / "fields"
M = HERE / "models"
D = HERE / "data"
Y1 = 2025
L89_FROM = (2013, 4)
fid = lambda i: f"ec-{int(i):03d}"


def save(df, name):
    df.to_csv(OUT / f"{name}.csv", index=False)
    print(f"  {name}.csv  {len(df)} rows")


def fields():
    f = pd.read_csv(D / "fields_index.csv")
    out = pd.DataFrame({"fieldId": f.field_id.map(fid), "lon": f.lon.round(6), "lat": f.lat.round(6),
                        "county": "Ellis", "state": "TX"})
    save(out, "fields")
    return out


def landsat():
    ts = pd.read_csv(M / "ndvi_timeseries.csv.gz", parse_dates=["date"])
    # same clear-sky rule as the models (features.py, run_model2.py); Landsat only (HLS is not Landsat)
    ts = ts[(ts.clear_frac >= 0.6) & (ts.snow_frac < 0.1) & ts.ndvi.between(-0.2, 1.0) & ts.sensor.str.startswith("L")]
    ts = ts.assign(fieldId=ts.field_id.map(fid), year=ts.date.dt.year, month=ts.date.dt.month)

    def monthly(d):
        per_scene = d.groupby(["fieldId", "date", "year", "month"])[["ndvi", "ndti", "bsi"]].median().reset_index()
        g = per_scene.groupby(["fieldId", "year", "month"])
        m = g[["ndvi", "ndti", "bsi"]].median().join(g.size().rename("scenes")).reset_index()
        # full grid so cloudy months are explicit gaps (as in the Earth Engine monthly export)
        ids = sorted(ts.fieldId.unique())
        grid = pd.MultiIndex.from_product([ids, range(int(m.year.min()), Y1 + 1), range(1, 13)], names=["fieldId", "year", "month"])
        m = m.set_index(["fieldId", "year", "month"]).reindex(grid).reset_index()
        m["scenes"] = m.scenes.fillna(0).astype(int)
        return m[["fieldId", "year", "month", "scenes", "ndvi", "ndti", "bsi"]].round(4)

    allm = monthly(ts)
    save(allm[allm.year < 2008], "landsat_monthly_1984_2007")
    save(allm[allm.year >= 2008], "landsat_monthly")
    l89 = monthly(ts[ts.sensor.isin(["L8", "L9"])])
    l89 = l89[(l89.year > L89_FROM[0]) | ((l89.year == L89_FROM[0]) & (l89.month >= L89_FROM[1]))]
    save(l89, "landsat_monthly_l89")


def cdl(ids):
    c = pd.read_csv(M / "cdl_history.csv").dropna(subset=["crop_code"])
    c = c[(c.year >= 2008) & (c.year <= Y1)]
    save(pd.DataFrame({"fieldId": c.field_id.map(fid), "year": c.year.astype(int),
                       "code": c.crop_code.round().astype(int)}).sort_values(["fieldId", "year"]), "cdl")


def power(f):
    d = pd.read_csv(M / "power_daily.csv", parse_dates=["date"]).set_index("date").replace(-999, np.nan)
    d = d[d.index.year <= Y1]
    cell = f"{round(32.25 / 0.5)}_{round(-96.75 / 0.625)}"
    yrs = []
    for y, g in d.groupby(d.index.year):
        frost = g.T2M_MIN <= 0
        spring, fall = g[(g.index.month < 7) & frost], g[(g.index.month >= 7) & frost]
        last, first = (spring.index.max() if len(spring) else None), (fall.index.min() if len(fall) else None)
        yrs.append({"year": y, "precipMm": round(g.PRECTOTCORR.sum(), 1), "heatStressDays": int((g.T2M_MAX >= 35).sum()),
                    "frostFreeDays": int((first - last).days) if last is not None and first is not None else None,
                    "completeYear": len(g) >= 365})
    save(pd.DataFrame([{"fieldId": i, "powerCell": cell, **r} for i in f.fieldId for r in yrs]), "power_yearly")
    mo = pd.DataFrame({"tMaxC": d.T2M_MAX.resample("MS").mean(), "tMinC": d.T2M_MIN.resample("MS").mean(),
                       "precipMm": d.PRECTOTCORR.resample("MS").sum(), "heatStressDays": (d.T2M_MAX >= 35).resample("MS").sum()})
    mo = mo.assign(year=mo.index.year, month=mo.index.month).round(2)
    save(pd.concat([mo.assign(fieldId=i, powerCell=cell) for i in f.fieldId])[
        ["fieldId", "powerCell", "year", "month", "tMaxC", "tMinC", "precipMm", "heatStressDays"]], "power_monthly")


def area_series(f):
    sm = pd.read_csv(M / "smap_soil_moisture.csv", parse_dates=["date"]).set_index("date")
    sm = sm[sm.index.year <= Y1]
    v = sm[["sm_am", "sm_pm"]].mean(axis=1)
    smm = pd.DataFrame({"days": v.resample("MS").count(), "sm_surface": v.resample("MS").mean()})
    smm["sm_rootzone"] = smm.sm_surface  # SMAP L3 is surface only; the app's anomaly reads this column
    smm = smm.assign(year=smm.index.year, month=smm.index.month).round(4)
    save(pd.concat([smm.assign(fieldId=i) for i in f.fieldId])[["fieldId", "year", "month", "days", "sm_surface", "sm_rootzone"]], "smap_monthly")

    im = pd.read_csv(M / "r2" / "imerg_daily_rain.csv", parse_dates=["date"]).set_index("date").replace(-999, np.nan)
    im = im[(im.index.year >= 2001) & (im.index.year <= Y1)]   # 2000 starts in June
    imm = pd.DataFrame({"precipMm": im.rain_mm.resample("MS").sum().round(1), "stormDays": (im.rain_mm >= 25).resample("MS").sum()})
    imm = imm.assign(year=imm.index.year, month=imm.index.month)
    save(pd.concat([imm.assign(fieldId=i) for i in f.fieldId])[["fieldId", "year", "month", "precipMm"]], "imerg_monthly")
    save(pd.concat([imm.assign(fieldId=i) for i in f.fieldId])[["fieldId", "year", "month", "stormDays"]], "imerg_storms_monthly")

    for name in ("prism_monthly", "prism_yearly"):
        p = pd.read_csv(D / f"{name.replace('prism', 'prism_area')}.csv")
        save(pd.concat([p.assign(fieldId=i) for i in f.fieldId])[["fieldId"] + [c for c in p.columns if c != "fieldId"]], name)


def terrain(f):
    t = pd.read_csv(HERE / "replay" / "data" / "raw" / "fields_terrain.csv")
    save(pd.DataFrame({"fieldId": t.field_id.map(fid), "elevationM": t.elevation_mean.round(2),
                       "slopePct": (np.tan(np.radians(t.slope_deg_mean)) * 100).round(2)}), "terrain")


def ssurgo(f):
    """Dominant SSURGO component at each field centroid (same query as pipeline/sample_fields.py run_soil)."""
    cache = D / "ssurgo.csv"
    have = pd.read_csv(cache) if cache.exists() else pd.DataFrame(columns=["fieldId"])
    done = set(have.dropna(subset=["mukey"]).fieldId) if "mukey" in have else set()
    rows = [r for r in have.to_dict("records") if r["fieldId"] in done]
    top = "(SELECT TOP 1 ch.{col} FROM chorizon ch WHERE ch.cokey = c.cokey ORDER BY ch.hzdept_r)"
    for r in f.itertuples():
        if r.fieldId in done:
            continue
        q = f"""SELECT TOP 1 mu.mukey, c.compname, c.drainagecl, c.hydgrp, c.comppct_r,
                  {top.format(col='om_r')} AS om, {top.format(col='claytotal_r')} AS clay,
                  {top.format(col='sandtotal_r')} AS sand, {top.format(col='kwfact')} AS kwfact,
                  {top.format(col='kffact')} AS kffact, {top.format(col='awc_r')} AS awc,
                  c.tfact, c.nirrcapcl, c.nirrcapscl, ma.aws0100wta
                FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point({r.lon} {r.lat})') AS m
                JOIN mapunit mu ON mu.mukey = m.mukey JOIN component c ON c.mukey = mu.mukey
                LEFT JOIN muaggatt ma ON ma.mukey = mu.mukey
                WHERE c.majcompflag = 'Yes' ORDER BY c.comppct_r DESC"""
        js = {}
        for attempt in range(3):
            try:
                js = requests.post("https://sdmdataaccess.sc.egov.usda.gov/tabular/post.rest",
                                   json={"query": q, "format": "JSON+COLUMNNAME"}, timeout=60).json()
                break
            except Exception as e:
                print(f"  soil {r.fieldId} retry ({str(e)[:60]})")
                time.sleep(5)
        t = js.get("Table")
        rows.append({"fieldId": r.fieldId, **dict(zip(t[0], t[1]))} if t and len(t) > 1 else {"fieldId": r.fieldId})
    s = pd.DataFrame(rows).sort_values("fieldId")
    s.to_csv(cache, index=False)
    save(s, "ssurgo")
    print(f"  SSURGO found for {s.mukey.notna().sum()} of {len(s)} fields")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.csv"):   # the previous 201-field tables (kept in git history)
        old.unlink()
    f = fields()
    landsat()
    cdl(f.fieldId)
    power(f)
    area_series(f)
    terrain(f)
    ssurgo(f)


if __name__ == "__main__":
    main()
