"""Model B (Field Shift v2): how this field's crop reacts to heat and drought.

Three parts, all trained on 2008-2019 in 5 counties and scored once on unseen years 2020-2025 and the unseen county
(Hill, never trained on). Greenness normals are leak-free (earlier years only, data.py).

1. Forecast: chance a field is stressed (greenness z <= -1 vs its own normal) 1, 2 and 3 months ahead, from what is
   known at the end of this month (greenness so far, weather and soil water so far, crop, soil).
   Baselines: crop-month climatology, "same as last month", last-greenness-only trees, logistic regression.
2. Response: this month's greenness z from this month's weather + last month's state, with a 90 % range (split
   conformal: fitted on 2008-2015, calibrated on 2016-2019, coverage checked on 2020-2025).
   Sensitivity: change in z if a growing month gets 50 % less rain and +5 hot days, per crop and per field.
3. Ties to real outcomes: county greenness z in each crop's key months vs NASS county yield (detrended), and
   county stress vs RMA drought / heat insurance losses.

  python v2/models/modelB/train.py
Writes v2/models/modelB/: forecast_h{1,2,3}.joblib, response.joblib, metrics.json, field_sensitivity.csv, REPORT.md
"""
import json, sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, balanced_accuracy_score, brier_score_loss, mean_absolute_error, r2_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DATA = ROOT / "v2" / "data" / "modelB"
HOLDOUT, TRAIN = "48217", (2008, 2019)
TEST = range(2020, 2026)
WX = ["rain", "rain_anom", "hot_days", "tmax_mean", "vpd", "eto", "rain_days", "spi30d", "spi90d", "spei30d", "spei90d",
      "eddi30d", "eddi90d", "pdsi", "imerg_rain", "imerg_i30", "smap_sm_rootzone", "smap_sm_surface", "mod16_et",
      "et_ratio", "alexi_ratio", "tc_def", "tc_soil"]
SOIL = ["awc_r_0_100", "claytotal_r_0_30", "om_r_0_30", "aws0100wta", "slope_r"]
CROPS = ["winter_grain", "summer_grain", "cotton", "grass_hay", "fallow", "soybeans", "other"]
KEY_MONTHS = {"WHEAT": ("winter_grain", [3, 4, 5]), "CORN": ("summer_grain", [5, 6, 7]),
              "SORGHUM": ("summer_grain", [6, 7, 8]), "COTTON": ("cotton", [7, 8, 9])}


def frame():
    d = pd.read_pickle(DATA / "monthly.pkl")
    d["t"] = d.year * 12 + d.month
    d = d.sort_values(["fid", "t"]).reset_index(drop=True)
    g = d.groupby("fid")
    for lag in (1, 2, 3):
        for c in ("z", "ndvi"):
            d[f"{c}_l{lag}"] = g[c].shift(lag)
    for c in ("rain", "rain_anom", "hot_days"):
        d[f"{c}_l1"] = g[c].shift(1)
        d[f"{c}_l2"] = g[c].shift(2)
    d["rain_anom_3m"] = d.rain_anom + d.rain_anom_l1 + d.rain_anom_l2
    d["rain_3m"] = d.rain + d.rain_l1 + d.rain_l2
    # last known greenness z and how long ago it was seen (clouds)
    d["z_known"] = g.z.transform(lambda v: v.ffill())
    seen = d.t.where(d.z.notna())
    d["months_since_view"] = d.t - seen.groupby(d.fid).ffill()
    for c in CROPS:
        d[f"crop_{c}"] = (d.crop == c).astype(int)
    return d


def splits(d):
    hill = d.cfips == HOLDOUT
    return {"train": d.year.between(*TRAIN) & ~hill, "unseenYears": d.year.isin(TEST) & ~hill,
            "hill": hill & (d.year >= TRAIN[0]), "hill_unseenYears": hill & d.year.isin(TEST)}


def cls_scores(y, p, thr=0.5):
    if len(np.unique(y)) < 2:
        return {}
    return {"n": int(len(y)), "auc": round(roc_auc_score(y, p), 3), "brier": round(brier_score_loss(y, p), 4),
            "accuracy": round(accuracy_score(y, p >= thr), 3), "balancedAccuracy": round(balanced_accuracy_score(y, p >= thr), 3),
            "stressedShare": round(float(np.mean(y)), 3)}


def hgb_c():
    return HistGradientBoostingClassifier(max_iter=600, learning_rate=0.05, max_leaf_nodes=63, min_samples_leaf=100,
                                          l2_regularization=1.0, early_stopping=True, validation_fraction=0.1,
                                          n_iter_no_change=30, random_state=0)


def hgb_r(**kw):
    p = dict(max_iter=600, learning_rate=0.05, max_leaf_nodes=63, min_samples_leaf=100, l2_regularization=1.0,
             early_stopping=True, validation_fraction=0.1, n_iter_no_change=30, random_state=0)
    p.update(kw)
    return HistGradientBoostingRegressor(**p)


def forecast(d, res):
    g = d.groupby("fid")
    state = ["z", "z_l1", "z_l2", "z_known", "months_since_view", "ndvi", "ndvi_l1"]
    now = WX + ["rain_l1", "rain_anom_l1", "rain_anom_3m", "rain_3m", "hot_days_l1"]
    res["forecast"] = {}
    models = {}
    for h in (1, 2, 3):
        x = d.copy()
        x["target"] = g.stressed.shift(-h)
        x["target_month"] = g.month.shift(-h)
        x["target_normal"] = g.normal.shift(-h)
        x["target_crop_same"] = (g.crop.shift(-h) == x.crop).astype(int)
        tcrop = g.crop.shift(-h)
        for c in CROPS:
            x[f"tcrop_{c}"] = (tcrop == c).astype(int)
        cols = state + now + SOIL + ["month", "target_month", "target_normal"] + [f"tcrop_{c}" for c in CROPS]
        x = x[x.target.notna()]
        sp = splits(x)
        tr = x[sp["train"]]
        m = hgb_c().fit(tr[cols], tr.target.astype(int))
        base_last = hgb_c().fit(tr[["z_known", "months_since_view", "target_month", "target_normal"] + [f"tcrop_{c}" for c in CROPS]],
                                tr.target.astype(int))
        lr = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(max_iter=2000)).fit(tr[cols], tr.target.astype(int))
        clim = tr.groupby(["target_month"] + [f"tcrop_{c}" for c in CROPS]).target.mean()
        out = {}
        for k in ("unseenYears", "hill", "hill_unseenYears"):
            t = x[sp[k]]
            y = t.target.astype(int).values
            p_clim = t.set_index(["target_month"] + [f"tcrop_{c}" for c in CROPS]).index.map(clim).to_numpy(dtype=float)
            p_clim = np.where(np.isnan(p_clim), tr.target.mean(), p_clim)
            out[k] = {"model": cls_scores(y, m.predict_proba(t[cols])[:, 1]),
                      "lastGreennessOnly": cls_scores(y, base_last.predict_proba(t[base_last.feature_names_in_])[:, 1]),
                      "logisticRegression": cls_scores(y, lr.predict_proba(t[cols])[:, 1]),
                      "cropMonthClimatology": cls_scores(y, p_clim),
                      "sameAsLastMonth": cls_scores(y, np.nan_to_num((t.z_known <= -1).astype(float).values, nan=0.0))}
        res["forecast"][f"h{h}"] = out
        r = out["unseenYears"]
        print(f"forecast {h} month(s) ahead, unseen years (n={r['model']['n']:,}, {r['model']['stressedShare']:.0%} stressed): "
              f"AUC model {r['model']['auc']:.3f} | last-greenness {r['lastGreennessOnly']['auc']:.3f} | logistic "
              f"{r['logisticRegression']['auc']:.3f} | climatology {r['cropMonthClimatology']['auc']:.3f} | same-as-last "
              f"{r['sameAsLastMonth']['auc']:.3f}; Hill AUC {out['hill']['model']['auc']:.3f}", flush=True)
        joblib.dump({"model": m, "features": cols}, HERE / f"forecast_h{h}.joblib")
        models[h] = (m, cols, x[sp["unseenYears"]])
    return models


def response(d, res):
    x = d[d.z.notna() & (d.growing == 1)].copy()
    cols = WX + ["rain_l1", "rain_anom_l1", "rain_anom_3m", "rain_3m", "hot_days_l1", "z_l1", "z_l2", "months_since_view",
                 "month", "normal"] + SOIL + [f"crop_{c}" for c in CROPS]
    wx_only = [c for c in cols if c not in ("z_l1", "z_l2", "months_since_view")]
    sp = splits(x)
    fit = x[x.year.between(2008, 2015) & (x.cfips != HOLDOUT)]
    cal = x[x.year.between(2016, 2019) & (x.cfips != HOLDOUT)]
    m = hgb_r().fit(fit[cols], fit.z)
    q = float(np.quantile(np.abs(cal.z - m.predict(cal[cols])), 0.9))            # split-conformal 90 % half-width
    full = hgb_r().fit(x[sp["train"]][cols], x[sp["train"]].z)
    out = {"conformalHalfWidth90": round(q, 3)}
    for k in ("unseenYears", "hill", "hill_unseenYears"):
        t = x[sp[k]]
        p = m.predict(t[cols])
        pf = full.predict(t[cols])
        persist = t.z_l1.fillna(0).values
        out[k] = {"n": int(len(t)), "r2": round(r2_score(t.z, pf), 3), "mae": round(mean_absolute_error(t.z, pf), 3),
                  "r2_lastMonthOnly": round(r2_score(t.z[t.z_l1.notna()], t.z_l1[t.z_l1.notna()]), 3),
                  "coverage90": round(float(np.mean(np.abs(t.z - p) <= q)), 3),
                  "stressAuc": round(roc_auc_score((t.z <= -1).astype(int), -pf), 3)}
    res["response"] = out
    r = out["unseenYears"]
    print(f"response (this month's greenness z), unseen years n={r['n']:,}: R2 {r['r2']:.3f} (last month only "
          f"{r['r2_lastMonthOnly']:.3f}), MAE {r['mae']:.3f}, stress AUC {r['stressAuc']:.3f}; 90% range +/-{q:.2f} z, "
          f"coverage {r['coverage90']:.1%}; Hill R2 {out['hill']['r2']:.3f}", flush=True)
    joblib.dump({"model": full, "features": cols, "conformal_half_width_90": q}, HERE / "response.joblib")

    # sensitivity: how far greenness z actually moves per unit of drought (SPEI 90-day) and per hot day, growing
    # months, fitted per crop and per field (field slopes shrunk toward the crop's slope when a field has few months)
    t = x[x.spei90d.notna()].copy()
    X = lambda v: np.c_[np.ones(len(v)), v.spei90d.values, v.hot_days.values]
    crop_b = {}
    for c, g in t.groupby("crop"):
        if len(g) > 500:
            crop_b[c] = np.linalg.lstsq(X(g), g.z.values, rcond=None)[0]
    res["sensitivityByCrop"] = {c: {"z_per_spei90": round(float(b[1]), 3), "z_per_hot_day": round(float(b[2]), 4),
                                    "z_if_spei_minus2": round(float(-2 * b[1]), 2)} for c, b in crop_b.items()}
    K = 24
    rows = []
    for (fid, c), g in t.groupby(["fid", "crop"]):
        if c not in crop_b or len(g) < 6:
            continue
        raw = np.linalg.lstsq(X(g), g.z.values, rcond=None)[0] if len(g) >= 12 else crop_b[c]
        w = len(g) / (len(g) + K)
        bb = w * raw + (1 - w) * crop_b[c]
        rows.append({"fid": fid, "crop": c, "n_months": len(g), "z_per_spei90": round(float(bb[1]), 3),
                     "z_per_hot_day": round(float(bb[2]), 4), "weight_own_data": round(w, 2)})
    fs = pd.DataFrame(rows)
    fs.to_csv(HERE / "field_sensitivity.csv", index=False)
    spread = fs.groupby("crop").z_per_spei90.quantile([0.1, 0.9]).unstack().round(3)
    res["fieldSensitivitySpread"] = {c: [float(r[0.1]), float(r[0.9])] for c, r in spread.iterrows()}
    print("sensitivity per crop (greenness z per +1 SPEI, per hot day):",
          {c: (v["z_per_spei90"], v["z_per_hot_day"]) for c, v in res["sensitivityByCrop"].items()}, flush=True)
    return full, cols


def outcomes(d, res):
    """County-year greenness z in each crop's key months vs NASS yields; county stress vs RMA drought/heat losses."""
    sys.path.insert(0, str(HERE.parent))
    from nass_yields import county_yields
    y = county_yields()
    out = {}
    g = d[d.growing == 1]
    for crop, (cg, months) in KEY_MONTHS.items():
        yy = y[y.commodity_desc == crop].groupby(["cfips", "year"]).value_num.mean().reset_index()
        if len(yy) < 15:
            continue
        # detrend per county: % deviation from a linear trend
        yy["trend"] = yy.groupby("cfips").apply(lambda v: pd.Series(np.polyval(np.polyfit(v.year, v.value_num, 1), v.year), index=v.index)).reset_index(level=0, drop=True)
        yy["yield_dev_pct"] = 100 * (yy.value_num / yy.trend - 1)
        zz = g[(g.crop == cg) & g.month.isin(months)].groupby(["cfips", "year"]).z.mean().rename("z_key").reset_index()
        m = yy.merge(zz, on=["cfips", "year"]).dropna()
        if len(m) < 15:
            continue
        preds = np.zeros(len(m))
        for yr in m.year.unique():                                  # leave-one-year-out fit
            a, b = m[m.year != yr], m[m.year == yr]
            coef = np.polyfit(a.z_key, a.yield_dev_pct, 1)
            preds[(m.year == yr).values] = np.polyval(coef, b.z_key)
        coef = np.polyfit(m.z_key, m.yield_dev_pct, 1)
        out[crop] = {"countyYears": int(len(m)), "years": [int(m.year.min()), int(m.year.max())],
                     "corr": round(float(np.corrcoef(m.z_key, m.yield_dev_pct)[0, 1]), 3),
                     "r2_leaveOneYearOut": round(r2_score(m.yield_dev_pct, preds), 3),
                     "yieldPctPerUnitZ": round(float(coef[0]), 2), "keyMonths": months}
    res["yieldLink"] = out
    print("greenness vs NASS county yield:", {k: (v["corr"], v["r2_leaveOneYearOut"], v["yieldPctPerUnitZ"]) for k, v in out.items()}, flush=True)

    rma = pd.read_csv(ROOT / "v2" / "data" / "rma_county_year_cause.csv", dtype={"cfips": str})
    rma = rma[rma.cause_desc.str.contains("DROUGHT|HEAT|HOT WIND")]
    r = rma.groupby(["cfips", "commodity_year"]).indemnity.sum().rename("drought_heat_indemnity").reset_index().rename(columns={"commodity_year": "year"})
    liab = pd.read_csv(ROOT / "v2" / "data" / "rma_county_year_cause.csv", dtype={"cfips": str}).groupby(["cfips", "commodity_year"]).liability.sum()
    s = g.groupby(["cfips", "year"]).stressed.mean().rename("stressed_share").reset_index()
    m = s.merge(r, on=["cfips", "year"], how="left").fillna({"drought_heat_indemnity": 0})
    m = m[m.year.between(1989, 2025)]
    rho = m[["stressed_share", "drought_heat_indemnity"]].corr(method="spearman").iloc[0, 1]
    top = m.groupby("year").agg(stress=("stressed_share", "mean"), pay=("drought_heat_indemnity", "sum"))
    res["rmaLink"] = {"countyYears": int(len(m)), "spearman": round(float(rho), 3),
                      "topStressYears": [int(v) for v in top.stress.nlargest(5).index],
                      "topDroughtPayoutYears": [int(v) for v in top.pay.nlargest(5).index]}
    print(f"county stress vs RMA drought/heat losses: Spearman {rho:.3f}; top stress years {res['rmaLink']['topStressYears']}, "
          f"top payout years {res['rmaLink']['topDroughtPayoutYears']}", flush=True)


def explain(models, res):
    import shap
    m, cols, test = models[1]
    sample = test.sample(min(3000, len(test)), random_state=0)
    sv = shap.TreeExplainer(m).shap_values(sample[cols])
    sv = sv[1] if isinstance(sv, list) else sv
    imp = pd.Series(np.abs(sv).mean(0), index=cols).sort_values(ascending=False)
    res["shapTop_h1"] = {k: round(float(v), 4) for k, v in imp.head(12).items()}
    print("what matters most (SHAP, 1-month forecast):", list(imp.head(8).index), flush=True)


def main():
    d = frame()
    res = {}
    models = forecast(d, res)
    response(d, res)
    outcomes(d, res)
    explain(models, res)
    (HERE / "metrics.json").write_text(json.dumps(res, indent=1))
    print("wrote metrics.json")


if __name__ == "__main__":
    main()
