"""Calibration E (Field Shift v2): county yields from satellite greenness + weather, fitted on early years, tested on
later years. NASS county yields (SURVEY), the 6 counties, 1985-2025.

Target: % deviation from each county-crop's yield trend, the trend fitted on the training years only (1985-2012)
and extrapolated, so the test years 2013-2025 never shape it.
Inputs per county-year (Model B monthly table, the fields Model 1 says grew that crop):
  greenness z in the crop's key months (mean and worst month), rain and hot days in the crop's season window,
  SPEI-90 and TerraClimate deficit at the end of the window, MODIS ET/PET in the key months (2001+).
Models: trend only (baseline), greenness-only line, ridge regression, small gradient-boosted trees.
Output: the per-crop response numbers the simulator must reproduce (yield % per unit greenness z, per hot day,
per 100 mm rain), plus the fitted models.

The simulator engine (water balance + crop growth) is not built yet; when it is, its per-crop settings (water
productivity, heat thresholds) are tuned until its simulated yields match these targets year by year.

  python v2/models/calibrationE/train.py
"""
import json, sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import RidgeCV
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DATA = ROOT / "v2" / "data"
TRAIN_END = 2012
CROPS = {  # NASS commodity: (Model 1 group, key months, season window months (negative = year before))
    "WHEAT": ("winter_grain", [3, 4, 5], [-2, -1, 0, 1, 2, 3, 4, 5]),
    "CORN": ("summer_grain", [5, 6, 7], [3, 4, 5, 6, 7]),
    "SORGHUM": ("summer_grain", [6, 7, 8], [4, 5, 6, 7, 8]),
    "COTTON": ("cotton", [7, 8, 9], [5, 6, 7, 8, 9]),
}
FEATS = ["z_key", "z_worst", "rain_season", "hot_season", "spei_end", "def_end", "et_ratio_key"]


def yields():
    sys.path.insert(0, str(HERE.parent))
    from nass_yields import county_yields
    return county_yields().rename(columns={"value_num": "yield_", "unit_desc": "unit"})


def county_features(mb, group, key, window):
    m = mb.copy()
    # season year: months -2..0 mean Oct-Dec of the year before (wheat)
    m["season"] = np.where(m.month >= 10, m.year + 1, m.year)
    m["smonth"] = np.where(m.month >= 10, m.month - 12, m.month)
    crop = m[(m.crop == group) & (m.growing == 1) & m.smonth.isin(key)]
    g1 = crop.groupby(["cfips", "season"]).z.agg(z_key="mean").reset_index()
    worst = crop.groupby(["cfips", "season", "smonth"]).z.mean().groupby(["cfips", "season"]).min().rename("z_worst").reset_index()
    win = m[m.smonth.isin(window)]
    w = win.groupby(["cfips", "season", "fid"]).agg(rain=("rain", "sum"), hot=("hot_days", "sum")).groupby(["cfips", "season"]).mean()
    w.columns = ["rain_season", "hot_season"]
    end = m[m.smonth == window[-1]].groupby(["cfips", "season"]).agg(spei_end=("spei90d", "mean"), def_end=("tc_def", "mean"))
    et = m[m.smonth.isin(key)].groupby(["cfips", "season"]).et_ratio.mean().rename("et_ratio_key")
    f = g1.merge(worst, on=["cfips", "season"], how="outer").merge(w.reset_index(), on=["cfips", "season"], how="outer")
    f = f.merge(end.reset_index(), on=["cfips", "season"], how="left").merge(et.reset_index(), on=["cfips", "season"], how="left")
    return f.rename(columns={"season": "year"})


def main():
    mb = pd.read_pickle(DATA / "modelB" / "monthly.pkl")
    y = yields()
    res, models = {}, {}
    for crop, (group, key, window) in CROPS.items():
        d = y[y.commodity_desc == crop].merge(county_features(mb, group, key, window), on=["cfips", "year"], how="inner")
        d = d[d.z_key.notna()]
        tr_mask = d.year <= TRAIN_END
        trend = {}
        for c, g in d[tr_mask].groupby("cfips"):
            if len(g) >= 6:
                trend[c] = np.polyfit(g.year, g.yield_, 1)
        d = d[d.cfips.isin(trend)].copy()
        d["trend"] = [np.polyval(trend[c], yr) for c, yr in zip(d.cfips, d.year)]
        d["dev"] = 100 * (d.yield_ / d.trend - 1)
        tr, te = d[d.year <= TRAIN_END], d[d.year > TRAIN_END]
        if len(tr) < 25 or len(te) < 8:
            print(f"{crop}: too few county-years ({len(tr)} train / {len(te)} test), skipped")
            continue
        ridge = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), RidgeCV(alphas=np.logspace(-2, 3, 30))).fit(tr[FEATS], tr.dev)
        green = np.polyfit(tr.z_key, tr.dev, 1)
        trees = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_depth=3, min_samples_leaf=10,
                                              l2_regularization=1.0, random_state=0).fit(tr[FEATS], tr.dev)
        preds = {"trendOnly": np.zeros(len(te)), "greennessLine": np.polyval(green, te.z_key),
                 "ridge": ridge.predict(te[FEATS]), "trees": trees.predict(te[FEATS])}
        sc = {}
        for k, p in preds.items():
            yp = te.trend * (1 + p / 100)
            sc[k] = {"r2_deviation": round(r2_score(te.dev, p), 3), "r2_yield": round(r2_score(te.yield_, yp), 3),
                     "mae_yield": round(mean_absolute_error(te.yield_, yp), 1),
                     "corr_deviation": round(float(np.corrcoef(te.dev, p)[0, 1]), 3) if np.std(p) > 0 else None}
        # response numbers for the simulator: ridge refit on all years, per raw unit
        allf = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), RidgeCV(alphas=np.logspace(-2, 3, 30))).fit(d[FEATS], d.dev)
        coef = allf[-1].coef_ / allf[1].scale_
        res[crop] = {"unit": d.unit.iloc[0], "countyYears": {"train": int(len(tr)), "test": int(len(te))},
                     "testYears": [int(te.year.min()), int(te.year.max())], "scores": sc,
                     "targets": {"yieldPctPerGreennessZ": round(float(green[0]), 1),
                                 "ridgePerUnit": {f: round(float(c), 3) for f, c in zip(FEATS, coef)}},
                     "worstTestYear": {"year": int(te.loc[te.dev.idxmin(), "year"]), "actualDevPct": round(float(te.dev.min()), 1)}}
        best = max(("greennessLine", "ridge", "trees"), key=lambda k: sc[k]["r2_deviation"])
        res[crop]["best"] = best
        models[crop] = {"ridge": allf, "trees": trees, "features": FEATS, "trend": trend, "group": group,
                        "key_months": key, "window": window}
        print(f"{crop:<8} ({d.unit.iloc[0]}) train {len(tr)} / test {len(te)} county-years | R2 of deviation: trend 0, "
              f"greenness {sc['greennessLine']['r2_deviation']:.2f}, ridge {sc['ridge']['r2_deviation']:.2f}, trees {sc['trees']['r2_deviation']:.2f} | "
              f"yield MAE trend {sc['trendOnly']['mae_yield']} vs best {sc[best]['mae_yield']} | {green[0]:+.1f}% yield per z", flush=True)
    joblib.dump(models, HERE / "calibrationE.joblib")
    (HERE / "metrics.json").write_text(json.dumps(res, indent=1))
    print("wrote calibrationE.joblib, metrics.json")


if __name__ == "__main__":
    main()
