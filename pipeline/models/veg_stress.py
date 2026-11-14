"""Model 2: vegetation stress.

Predicts how far a field's NDVI falls below normal in a growing-season month (Apr-Sep) from:
  NASA POWER heat and rain, SMAP root-zone soil moisture, GPM IMERG rain and storm days,
  and MODIS ET (MOD16A2GF; ECOSTRESS is a future addition, see MODELS.md).

Target: NDVI z-score vs. the "normal" for that crop and month, where normal is computed from
TRAINING years only in each fold. "Below normal" = z < -0.5.
Approaches: linear regression vs. gradient boosting, plus a "predict normal" baseline.
Validation: leave-one-YEAR-out over 2015-2025 (SMAP years). Never a random split.

Run: pipeline/.venv/Scripts/python pipeline/models/veg_stress.py
"""
import json

import numpy as np
import pandas as pd
import shap
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import balanced_accuracy_score, mean_squared_error, r2_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from common import FIELDS, MONTH_NAMES, RESULTS, SEED, load_cdl, load_landsat

GS = range(4, 10)       # growing-season months
BELOW = -0.5            # z-score threshold for "below normal"
Y0 = 2015               # SMAP starts in 2015

WORDS = {
    "tMaxC": "hot days (average high temperature)", "heatStressDays": "days at or above 35 °C",
    "powerPrecipMm": "rain this month (POWER)", "powerPrecipPrev2": "rain over the past 2 months (POWER)",
    "imergPrecipMm": "rain this month (IMERG)", "stormDays": "heavy storm days (IMERG)",
    "smRootzoneZ": "soil moisture (SMAP)", "smRootzonePrevZ": "last month's soil moisture (SMAP)",
    "etRatio": "water use vs. demand (MODIS ET/PET)",
}


def build():
    ls = load_landsat()[["fieldId", "year", "month", "ndvi_raw"]].rename(columns={"ndvi_raw": "ndvi"})
    pw = pd.read_csv(FIELDS / "power_monthly.csv").rename(columns={"precipMm": "powerPrecipMm"})
    pw = pw.sort_values(["fieldId", "year", "month"])
    pw["powerPrecipPrev2"] = pw.groupby("fieldId").powerPrecipMm.transform(lambda s: s.shift(1) + s.shift(2))
    im = pd.read_csv(FIELDS / "imerg_monthly.csv").rename(columns={"precipMm": "imergPrecipMm"})
    st = pd.read_csv(FIELDS / "imerg_storms_monthly.csv")
    sm = pd.read_csv(FIELDS / "smap_monthly.csv").sort_values(["fieldId", "year", "month"])
    sm["smPrev"] = sm.groupby("fieldId").sm_rootzone.shift(1)
    et = pd.read_csv(FIELDS / "modis_et_monthly.csv")
    et["etRatio"] = et.etMm / et.petMm.replace(0, np.nan)
    cdl = load_cdl()[["fieldId", "year", "cls"]]
    k = ["fieldId", "year", "month"]
    d = (ls.merge(pw[k + ["tMaxC", "heatStressDays", "powerPrecipMm", "powerPrecipPrev2"]], on=k)
         .merge(im, on=k, how="left").merge(st, on=k, how="left")
         .merge(sm[k + ["sm_rootzone", "smPrev"]], on=k, how="left").merge(et[k + ["etRatio"]], on=k, how="left")
         .merge(cdl, on=["fieldId", "year"]))
    d = d[d.month.isin(GS) & (d.year >= Y0) & d.ndvi.notna() & ~d.cls.isin(["other"])]
    return d.reset_index(drop=True)


def add_fold_features(tr, te):
    """Normals from training years only: NDVI by crop+month, soil moisture by field+month."""
    out = []
    nd_norm = tr.groupby(["cls", "month"]).ndvi.agg(["mean", "std"])
    sm_norm = tr.groupby(["fieldId", "month"]).sm_rootzone.agg(["mean", "std"])
    smp_norm = tr.assign(pm=tr.month - 1).groupby(["fieldId", "pm"]).smPrev.agg(["mean", "std"])
    for df in (tr, te):
        df = df.copy()
        n = nd_norm.reindex(pd.MultiIndex.from_arrays([df.cls, df.month])).values
        df["z"] = (df.ndvi.values - n[:, 0]) / np.maximum(n[:, 1], 0.03)
        s = sm_norm.reindex(pd.MultiIndex.from_arrays([df.fieldId, df.month])).values
        df["smRootzoneZ"] = (df.sm_rootzone.values - s[:, 0]) / np.maximum(s[:, 1], 0.005)
        sp = smp_norm.reindex(pd.MultiIndex.from_arrays([df.fieldId, df.month - 1])).values
        df["smRootzonePrevZ"] = (df.smPrev.values - sp[:, 0]) / np.maximum(sp[:, 1], 0.005)
        out.append(df)
    return out


def run(d, feats, make_model):
    years = sorted(d.year.unique())
    preds = []
    for y in years:
        tr, te = d[d.year != y], d[d.year == y]
        tr, te = add_fold_features(tr, te)
        tr, te = tr.dropna(subset=feats + ["z"]), te.dropna(subset=feats + ["z"])
        m = make_model().fit(tr[feats], tr.z)
        preds.append(te.assign(pred=m.predict(te[feats])))
    return pd.concat(preds)


def scores(p):
    yb, pb = p.z < BELOW, p.pred < BELOW
    out = {"r2": round(r2_score(p.z, p.pred), 3), "rmse": round(mean_squared_error(p.z, p.pred) ** 0.5, 3),
           "belowNormalBalancedAccuracy": round(balanced_accuracy_score(yb, pb), 3)}
    try:
        out["belowNormalAUC"] = round(roc_auc_score(yb, -p.pred), 3)
    except ValueError:
        out["belowNormalAUC"] = None
    return out


def driver_text(feat, month, value):
    low = value < 0
    w = WORDS[feat]
    if feat in ("smRootzoneZ", "smRootzonePrevZ", "powerPrecipMm", "powerPrecipPrev2", "imergPrecipMm", "etRatio"):
        adj = "Low" if low else "High"
    else:
        adj = "More" if not low else "Fewer"
    return f"{adj} {w.split(' (')[0]} in {MONTH_NAMES[month - 1]} mattered most"


# ------------------------------------------------------------------ v2 (one round of fixes)
# Months each crop is actually in the field and growing in North Texas (approximate; harvest and fallow months dropped).
CROP_SEASON = {"corn": range(4, 8), "grain_sorghum": range(5, 9), "cotton": range(6, 10), "soybeans": range(5, 10),
               "winter_wheat": range(3, 6), "small_grain": range(3, 6)}
LAG_SRC = {"sm": "smZ", "rain": "powerPrecipMm", "heat": "heatStressDays"}
FEATS_V2 = ["tMaxC", "heatStressDays", "powerPrecipMm", "imergPrecipMm", "stormDays", "smZ"] +     [f"{k}Lag{l}" for k in LAG_SRC for l in (1, 2, 3)]


def build_v2():
    """All months (lags need the months before the season), all years from 2015."""
    ls = load_landsat()[["fieldId", "year", "month", "ndvi_raw"]].rename(columns={"ndvi_raw": "ndvi"})
    pw = pd.read_csv(FIELDS / "power_monthly.csv").rename(columns={"precipMm": "powerPrecipMm"})
    im = pd.read_csv(FIELDS / "imerg_monthly.csv").rename(columns={"precipMm": "imergPrecipMm"})
    st = pd.read_csv(FIELDS / "imerg_storms_monthly.csv")
    sm = pd.read_csv(FIELDS / "smap_monthly.csv")
    cdl = load_cdl()[["fieldId", "year", "cls"]]
    k = ["fieldId", "year", "month"]
    d = (pw[k + ["tMaxC", "heatStressDays", "powerPrecipMm"]].merge(ls, on=k, how="left").merge(im, on=k, how="left")
         .merge(st, on=k, how="left").merge(sm[k + ["sm_rootzone"]], on=k, how="left")
         .merge(cdl, on=["fieldId", "year"], how="left"))
    d = d[d.year >= Y0].sort_values(k).reset_index(drop=True)
    return d


def fold_v2(d, train_years):
    tr = d[d.year.isin(train_years)]
    smn = tr.groupby(["fieldId", "month"]).sm_rootzone.agg(["mean", "std"])
    s = smn.reindex(pd.MultiIndex.from_arrays([d.fieldId, d.month])).values
    d = d.assign(smZ=(d.sm_rootzone.values - s[:, 0]) / np.maximum(s[:, 1], 0.005))
    g = d.groupby("fieldId")
    for key, col in LAG_SRC.items():
        for l in (1, 2, 3):
            d[f"{key}Lag{l}"] = g[col].shift(l)
    in_season = np.array([m in CROP_SEASON.get(c, ()) for c, m in zip(d.cls, d.month)])
    d = d[in_season & d.ndvi.notna()]
    trs = d[d.year.isin(train_years)]
    nn = trs.groupby(["cls", "month"]).ndvi.agg(["mean", "std"])
    n = nn.reindex(pd.MultiIndex.from_arrays([d.cls, d.month])).values
    return d.assign(z=(d.ndvi.values - n[:, 0]) / np.maximum(n[:, 1], 0.03))


def run_v2(d, make_model):
    years = sorted(d.year.unique())
    out = []
    for y in years:
        f = fold_v2(d, [x for x in years if x != y]).dropna(subset=FEATS_V2 + ["z"])
        tr, te = f[f.year != y], f[f.year == y]
        out.append(te.assign(pred=make_model().fit(tr[FEATS_V2], tr.z).predict(te[FEATS_V2])))
    return pd.concat(out)


def main():
    d = build()
    base = ["tMaxC", "heatStressDays", "powerPrecipMm", "powerPrecipPrev2", "imergPrecipMm", "stormDays",
            "smRootzoneZ", "smRootzonePrevZ"]
    with_et = base + ["etRatio"]
    lin = lambda: make_pipeline(StandardScaler(), LinearRegression())
    gbr = lambda: HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=15,
                                                min_samples_leaf=40, random_state=SEED)
    res_scores, held = {}, {}
    for fs_name, fs in (("noET", base), ("withET", with_et)):
        for m_name, mk in (("linearRegression", lin), ("gradientBoosting", gbr)):
            p = run(d, fs, mk)
            res_scores[f"{m_name}_{fs_name}"] = scores(p)
            held[f"{m_name}_{fs_name}"] = p
            print(m_name, fs_name, res_scores[f"{m_name}_{fs_name}"])
    # v2: crop-specific season months + lagged soil moisture / rain / heat
    d2 = build_v2()
    for m_name, mk in (("linearRegression", lin), ("gradientBoosting", gbr)):
        p = run_v2(d2, mk)
        res_scores[f"{m_name}_v2"] = scores(p)
        held[f"{m_name}_v2"] = p
        print(m_name, "v2", res_scores[f"{m_name}_v2"])
    p0 = held["linearRegression_noET"].assign(pred=0.0)
    res_scores["baselinePredictNormal"] = scores(p0)
    print("baseline", res_scores["baselinePredictNormal"])

    # Chosen model: best R2 WITHOUT ET (ET is computed partly from MODIS vegetation, so it leaks greenness).
    chosen = max(("linearRegression_noET", "gradientBoosting_noET"), key=lambda k: res_scores[k]["r2"])
    feats = base
    p = held[chosen]
    per_year = {int(y): {"r2": round(r2_score(g.z, g.pred), 3) if len(g) > 2 else None, "n": len(g),
                         "belowNormalShare": round(float((g.z < BELOW).mean()), 3)} for y, g in p.groupby("year")}

    # Per crop, held-out: does the chosen model beat "always normal" (pred = 0)? Only those crops get the signal in the app.
    per_crop = {}
    for c, g in p.groupby("cls"):
        rm, rm0 = mean_squared_error(g.z, g.pred) ** 0.5, mean_squared_error(g.z, np.zeros(len(g))) ** 0.5
        per_crop[c] = {"n": len(g), "r2": round(r2_score(g.z, g.pred), 3), "rmse": round(rm, 3),
                       "baselineRmse": round(rm0, 3), "beatsBaseline": bool(rm < rm0)}
    # double_crop is not a model output (too few CDL labels), so it never gets the signal
    show_for = sorted(c for c, v in per_crop.items() if v["beatsBaseline"] and c != "double_crop")
    print("per crop", per_crop)

    # SHAP on a model fit to all years (normals from all years)
    full, _ = add_fold_features(d, d.iloc[:0])
    full = full.dropna(subset=feats + ["z"])
    gb_all = gbr().fit(full[feats], full.z)
    sv = shap.TreeExplainer(gb_all).shap_values(full[feats])
    glob = pd.Series(np.abs(sv).mean(0), index=feats).sort_values(ascending=False)
    lin_all = lin().fit(full[feats], full.z)
    coefs = dict(zip(feats, np.round(lin_all[-1].coef_, 3).tolist()))

    # Per field-year: worst month, and the driver that pushed NDVI down the most that season
    full = full.assign(**{f"shap_{f}": sv[:, i] for i, f in enumerate(feats)})
    hold = p.set_index(["fieldId", "year", "month"])
    recs = []
    for (fid, yr), g in full.groupby(["fieldId", "year"]):
        s = g[[f"shap_{f}" for f in feats]]
        flat = s.stack()
        (row_i, col) = flat.idxmin()
        f = col[5:]
        mo = int(g.loc[row_i, "month"])
        held_rows = hold.loc[(fid, yr)] if (fid, yr) in hold.index.droplevel(2) else None
        recs.append({
            "fieldId": fid, "year": int(yr),
            "stressMonths": [int(m) for m in g.month[g.z < BELOW]],
            "predictedStressMonths": [int(m) for m, v in held_rows.pred.items() if v < BELOW] if held_rows is not None else [],
            "minNdviZ": round(float(g.z.min()), 2),
            "topDriver": {"feature": f, "month": mo, "value": round(float(g.loc[row_i, f]), 2),
                          "shap": round(float(flat.min()), 3), "text": driver_text(f, mo, float(g.loc[row_i, f]))},
        })

    n_fy = d.groupby(["fieldId", "year"]).ngroups
    pos = float((p.z < BELOW).mean())
    flags = [f"Only {d.year.nunique()} years (2015-2025) because SMAP starts in 2015; each held-out year is one season of weather.",
             f"{pos:.0%} of held-out months are 'below normal' (z < {BELOW}).",
             "Weather inputs are coarse (POWER ~50 km, SMAP ~11 km, IMERG ~11 km): nearby fields share almost the same weather, "
             "so the model cannot explain field-to-field differences (management, soils).",
             "MODIS ET/PET is reported but NOT used in the chosen model: MOD16 ET is computed partly from MODIS leaf area, "
             "so it partly measures greenness itself (leakage).",
             "NDVI 'normal' is per crop and month across all fields, not per field; field-specific normals need more years.",
             "ECOSTRESS ET is not included (record starts 2018, irregular overpasses). Future addition."]
    if res_scores[chosen]["r2"] > 0.8:
        flags.append("R2 above 0.8 — suspiciously high for weather-only inputs; check for leakage.")
    if res_scores[chosen]["r2"] < 0.1:
        flags.append("R2 below 0.1 — weather explains little of the NDVI anomaly; treat drivers as hints, not causes.")

    flags.append("One round of fixes (crop-specific season months, 1-3 month lags) did not help: "
                 f"R2 {res_scores['gradientBoosting_noET']['r2']} -> {res_scores['gradientBoosting_v2']['r2']}. "
                 "Presented in the app as a low-confidence 'weather risk signal', not a stress prediction.")
    res = {"model": "veg_stress", "presentAs": "weatherRiskSignal", "confidence": "low", "validation": "leave-one-year-out", "years": [Y0, int(d.year.max())],
           "nFieldMonths": len(d), "nFieldYears": n_fy, "belowNormalThresholdZ": BELOW,
           "scores": res_scores, "chosen": chosen, "perCrop": per_crop, "showSignalFor": show_for, "perYear": per_year,
           "shapGlobal": [{"feature": f, "text": WORDS[f], "meanAbsShap": round(float(v), 4)} for f, v in glob.items()],
           "linearCoefficients": coefs, "flags": flags}
    (RESULTS / "veg_stress.json").write_text(json.dumps(res, indent=1))
    pd.DataFrame(recs).to_json(RESULTS / "veg_stress_fieldyears.json", orient="records")
    print(json.dumps({k: res[k] for k in ("perYear", "shapGlobal", "linearCoefficients", "flags")}, indent=1))


if __name__ == "__main__":
    main()
