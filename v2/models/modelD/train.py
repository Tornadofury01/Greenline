"""Model D (Field Shift v2, optional): SMAP's 9 km surface soil moisture turned into each field's moisture.

SMAP L3 enhanced (AM + PM retrievals, recommended quality), 2015-2025. Fields that read identical SMAP series sit in
the same SMAP cell (fields straddling two cells get their own blended "cell" and are left out of training).
On days with a Sentinel-1 radar pass, per field: VV / VH backscatter (dB) and their ratio, incidence angle,
the month's NDVI (Model B), rain over the last 1 / 3 / 7 / 14 days and 7-day mean high (gridMET), terrain wetness
index and height above drainage (MERIT), slope, clay / sand / water holding (SSURGO).

Learn at the scale SMAP measures: cell-date target = SMAP, inputs = the mean over the cell's fields.
Tests: cells the model never saw (grouped 5-fold by cell), and years it never saw (train 2015-2022, test 2023-2025).
Baselines: rain + season only, radar only, the cell's own monthly average (climatology from the training years).
Downscale: run the model on each field, then shift the cell's fields so their mean equals that day's SMAP value
(field = SMAP + field prediction - cell mean prediction), so it never contradicts SMAP.

No soil-moisture ground station sits inside the 6 counties, so field-scale accuracy can't be measured here; the
tests above are at SMAP's own scale, plus a plausibility check (are low, wet spots wetter?).

  python v2/models/modelD/train.py
Writes v2/models/modelD/: modelD.joblib, metrics.json, field_soil_moisture.csv.gz
"""
import glob, json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupKFold

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
EE = ROOT / "v2" / "data" / "ee"
DATA = ROOT / "v2" / "data"
OUT = DATA / "modelD"
OUT.mkdir(exist_ok=True)
STATIC = ["twi_mean", "hnd_mean", "slope_deg_mean", "claytotal_r_0_30", "sandtotal_r_0_30", "awc_r_0_100"]
DYN = ["vv_db", "vh_db", "ratio_db", "angle", "ndvi_month", "rain_1d", "rain_3d", "rain_7d", "rain_14d", "tmax_7d", "doy_sin", "doy_cos"]


def wide_daily(pattern, bands):
    rows = []
    for f in sorted(glob.glob(str(EE / pattern))):
        d = pd.read_csv(f)
        for b in bands:
            cols = [c for c in d.columns if c.endswith(f"_{b}") and c[0] == "d"]
            m = d[["fid", "year", "month"] + cols].melt(id_vars=["fid", "year", "month"], var_name="c", value_name="v").dropna(subset=["v"])
            m["day"] = m.c.str[1:3].astype(int)
            m["band"] = b
            rows.append(m.drop(columns="c"))
    x = pd.concat(rows, ignore_index=True)
    x["date"] = pd.to_datetime(dict(year=x.year, month=x.month, day=x.day), errors="coerce")
    return x.dropna(subset=["date"]).pivot_table(index=["fid", "date"], columns="band", values="v").reset_index()


def smap():
    c = OUT / "smap_daily.pkl"
    if c.exists():
        return pd.read_pickle(c)
    s = wide_daily("smapl3_*.csv", ["sm_am", "sm_pm"])
    s["sm"] = s[["sm_am", "sm_pm"]].mean(axis=1)
    s = s[["fid", "date", "sm"]].dropna()
    s.to_pickle(c)
    return s


def cells(s):
    """Fields with the same SMAP series share a cell."""
    p = s.pivot_table(index="date", columns="fid", values="sm")
    p = p.loc[p.notna().sum(1) > 0.8 * p.shape[1]].iloc[:200].round(4)
    sig = p.T.apply(lambda r: hash(tuple(r.fillna(-1))), axis=1)
    cell = sig.map({h: i for i, h in enumerate(sig.unique())})
    size = cell.map(cell.value_counts())
    return pd.DataFrame({"fid": cell.index, "cell": cell.values, "cell_size": size.values})


def rain():
    c = OUT / "rain_daily.pkl"
    if c.exists():
        return pd.read_pickle(c)
    parts = []
    for y in range(2014, 2026):
        f = EE / f"gridmet_{y}.csv"
        d = pd.read_csv(f)
        for b in ("pr", "tmmx"):
            cols = [x for x in d.columns if x.endswith(f"_{b}")]
            m = d[["fid", "year", "month"] + cols].melt(id_vars=["fid", "year", "month"], var_name="c", value_name=b).dropna()
            m["day"] = m.c.str[1:3].astype(int)
            parts.append(m.drop(columns="c").set_index(["fid", "year", "month", "day"]))
    w = pd.concat(parts).groupby(level=[0, 1, 2, 3]).first().reset_index()
    w["date"] = pd.to_datetime(dict(year=w.year, month=w.month, day=w.day), errors="coerce")
    w = w.dropna(subset=["date"]).sort_values(["fid", "date"])
    g = w.groupby("fid")
    for n in (1, 3, 7, 14):
        w[f"rain_{n}d"] = g.pr.transform(lambda v: v.rolling(n, min_periods=1).sum())
    w["tmax_7d"] = g.tmmx.transform(lambda v: v.rolling(7, min_periods=1).mean()) - 273.15
    w = w[["fid", "date", "rain_1d", "rain_3d", "rain_7d", "rain_14d", "tmax_7d"]]
    w.to_pickle(c)
    return w


def radar():
    parts = []
    for f in sorted(glob.glob(str(EE / "s1_*.csv"))):
        d = pd.read_csv(f, usecols=["fid", "date", "vv_mean", "vh_mean", "angle_mean", "vv_count"])
        parts.append(d[d.vv_count > 10])
    r = pd.concat(parts)
    r["date"] = pd.to_datetime(r.date)
    r["vv_db"] = 10 * np.log10(r.vv_mean.clip(lower=1e-5))
    r["vh_db"] = 10 * np.log10(r.vh_mean.clip(lower=1e-5))
    r["ratio_db"] = r.vh_db - r.vv_db
    r = r.rename(columns={"angle_mean": "angle"})
    return r.groupby(["fid", "date"], as_index=False)[["vv_db", "vh_db", "ratio_db", "angle"]].mean()


def hgb():
    return HistGradientBoostingRegressor(max_iter=600, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=30,
                                         l2_regularization=1.0, early_stopping=True, validation_fraction=0.1,
                                         n_iter_no_change=30, random_state=0)


def main():
    s = smap()
    cl = cells(s)
    print(f"SMAP: {len(s):,} field-days; {cl.cell.nunique()} cells "
          f"({(cl.cell_size >= 3).sum()} fields in {cl[cl.cell_size >= 3].cell.nunique()} cells with >= 3 fields)", flush=True)
    r = radar()
    w = rain()
    terr = pd.read_csv(EE / "terrain.csv")
    terr = terr[terr.layer == "merit"][["fid", "twi_mean", "hnd_mean"]].merge(
        pd.read_csv(EE / "terrain.csv").query("layer == '3dep'")[["fid", "slope_deg_mean"]], on="fid")
    soil = pd.read_csv(DATA / "ssurgo_fields.csv")[["fid", "claytotal_r_0_30", "sandtotal_r_0_30", "awc_r_0_100"]]
    mb = pd.read_pickle(DATA / "modelB" / "monthly.pkl")[["fid", "year", "month", "ndvi"]].rename(columns={"ndvi": "ndvi_month"})

    f = r.merge(w, on=["fid", "date"], how="left").merge(terr, on="fid", how="left").merge(soil, on="fid", how="left")
    f = f.assign(year=f.date.dt.year, month=f.date.dt.month).merge(mb, on=["fid", "year", "month"], how="left")
    doy = f.date.dt.dayofyear
    f["doy_sin"], f["doy_cos"] = np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25)
    f = f.merge(cl, on="fid", how="left").merge(s, on=["fid", "date"], how="left")
    cols = STATIC + DYN
    print(f"field radar passes: {len(f):,}, with SMAP the same day: {f.sm.notna().sum():,}", flush=True)

    # cell-date training table (cells with >= 3 fields; SMAP is the cell value)
    c = f[(f.cell_size >= 3) & f.sm.notna()]
    cd = c.groupby(["cell", "date"]).agg({**{k: "mean" for k in cols}, "sm": "first", "year": "first", "month": "first"}).reset_index()
    print(f"cell-dates for training: {len(cd):,}", flush=True)

    res = {"cellDates": int(len(cd)), "cells": int(cd.cell.nunique())}
    feats = {"model": cols, "rainSeasonOnly": ["rain_1d", "rain_3d", "rain_7d", "rain_14d", "tmax_7d", "doy_sin", "doy_cos"],
             "radarOnly": ["vv_db", "vh_db", "ratio_db", "angle"]}
    # A. unseen cells
    pred = {k: np.zeros(len(cd)) for k in feats}
    pred["cellClimatology"] = np.zeros(len(cd))
    for tr, te in GroupKFold(n_splits=5).split(cd, groups=cd.cell):
        for k, fc in feats.items():
            pred[k][te] = hgb().fit(cd.iloc[tr][fc], cd.iloc[tr].sm).predict(cd.iloc[te][fc])
        clim = cd.iloc[tr].groupby("month").sm.mean()          # unseen cell: only an area-wide monthly average exists
        pred["cellClimatology"][te] = cd.iloc[te].month.map(clim).values
    res["unseenCells"] = {k: {"r2": round(r2_score(cd.sm, p), 3), "mae": round(mean_absolute_error(cd.sm, p), 4)} for k, p in pred.items()}
    # B. unseen years
    tr, te = cd[cd.year <= 2022], cd[cd.year >= 2023]
    out = {}
    for k, fc in feats.items():
        p = hgb().fit(tr[fc], tr.sm).predict(te[fc])
        out[k] = {"r2": round(r2_score(te.sm, p), 3), "mae": round(mean_absolute_error(te.sm, p), 4)}
    clim = tr.groupby(["cell", "month"]).sm.mean()
    p = te.set_index(["cell", "month"]).index.map(clim).to_numpy(dtype=float)
    ok = ~np.isnan(p)
    out["cellClimatology"] = {"r2": round(r2_score(te.sm[ok], p[ok]), 3), "mae": round(mean_absolute_error(te.sm[ok], p[ok]), 4)}
    res["unseenYears"] = out
    for k in ("unseenCells", "unseenYears"):
        print(k, {m: v["r2"] for m, v in res[k].items()}, flush=True)

    # final model on all cell-dates; downscale every field radar pass
    model = hgb().fit(cd[cols], cd.sm)
    g = f[f.cell_size >= 1].copy()
    g["pred"] = model.predict(g[cols])
    g["cell_pred_mean"] = g.groupby(["cell", "date"]).pred.transform("mean")
    g["sm_field"] = np.where(g.sm.notna(), g.sm + g.pred - g.cell_pred_mean, np.nan)
    g["sm_field"] = g.sm_field.clip(0.02, 0.6)
    dev = (g.sm_field - g.sm).groupby(g.fid).mean()
    t = terr.set_index("fid")
    res["plausibility"] = {
        "fieldSpreadWithinCell_sd": round(float((g.sm_field - g.sm).std()), 4),
        "corr_fieldWetness_vs_TWI": round(float(dev.corr(t.twi_mean.reindex(dev.index))), 3),
        "corr_fieldWetness_vs_heightAboveDrainage": round(float(dev.corr(t.hnd_mean.reindex(dev.index))), 3),
        "corr_fieldWetness_vs_clay": round(float(dev.corr(soil.set_index("fid").claytotal_r_0_30.reindex(dev.index))), 3)}
    print("plausibility:", res["plausibility"], flush=True)
    g[g.sm_field.notna()][["fid", "date", "cell", "sm", "sm_field"]].round(4).to_csv(HERE / "field_soil_moisture.csv.gz", index=False)
    joblib.dump({"model": model, "features": cols}, HERE / "modelD.joblib")
    (HERE / "metrics.json").write_text(json.dumps(res, indent=1))
    print("wrote modelD.joblib, metrics.json, field_soil_moisture.csv.gz")


if __name__ == "__main__":
    main()
