"""Calibration E v2 (Field Shift v2): county yields from crop-specific MODIS greenness + weather.

What changed from v1 (6 counties, Landsat greenness from Model B, one train <= 2012 / test 2013+ split, 7 inputs):
  - 25 counties: every county in the NASS Blacklands district (the 6 study counties included), about 2-4x the
    county-years. Used only for calibration; the app stays on the 6 study counties.
  - greenness: MODIS MOD13Q1 NDVI (2000+, one sensor, no Landsat 5/7/8 mix) over each crop's OWN pixels that year
    (USDA CDL), only MODIS pixels >= 50 % that crop. Exported by v2/ee_exports/calib_counties.py.
  - weather per county: gridMET rain / heat days / heavy rain / reference ET, gridMET SPEI, TerraClimate deficit.
  - scoring: leave-one-year-out over 2000-2025 (every year is a test year once; the trend and the county greenness
    means are refit without the held-out year, so nothing leaks). The v1-style forward test (train <= 2012,
    test 2013+) is reported too.
  - fewer inputs (greenness anomaly, late-season greenness anomaly, heat days, SPEI, rain), counties pooled, plus a
    partial-pooling variant (county-specific greenness slopes, shrunk toward the shared slope) and an all-crops model.
  - independent field check: USDA-ARS Riesel watershed harvests (McLennan County), never used for fitting.

  python v2/models/calibrationE/train.py
Writes v2/models/calibrationE/: calibrationE.joblib, metrics.json, predictions.csv, REPORT.md
"""
import glob, json, sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DATA = ROOT / "v2" / "data"
CAL = DATA / "ee_calib"
STUDY = ["48139", "48217", "48349", "48257", "48251", "48309"]
HOLDOUT = "48217"
Y0, Y1 = 2000, 2025
TREND = "pooled"                              # "pooled" (shared slope, county levels) or "county" (own line each)
MIN_PX = 20                                   # composites with fewer crop pixels are treated as missing
CROPS = {  # NASS commodity: CDL group, key composite DOYs (greenness), season months (negative = year before), heat months
    "WHEAT": ("wheat", [65, 81, 97, 113, 129], [-2, -1, 0, 1, 2, 3, 4, 5], [4, 5]),
    "CORN": ("corn", [129, 145, 161, 177, 193], [3, 4, 5, 6, 7], [6, 7]),
    "SORGHUM": ("sorghum", [161, 177, 193, 209, 225], [4, 5, 6, 7, 8], [7, 8]),
    "COTTON": ("cotton", [193, 209, 225, 241, 257], [5, 6, 7, 8, 9], [7, 8]),
}
SMALL = ["g_key_anom", "g_late_anom", "hot", "spei_end", "rain"]
FULL = SMALL + ["g_peak_anom", "heavy", "eto", "def", "soil_end"]
WEATHER_ONLY = ["hot", "spei_end", "rain", "heavy", "eto", "def", "soil_end"]


# ---------------- data ----------------

def yields():
    sys.path.insert(0, str(HERE.parent))
    from nass_yields import county_yields
    y = county_yields("nass_blacklands_county.csv").rename(columns={"value_num": "yield_", "unit_desc": "unit"})
    return y[y.cfips.str.len() == 5]


def weather():
    w = pd.concat([pd.read_csv(f, dtype={"cfips": str}) for f in sorted(glob.glob(str(CAL / "cty_weather_*.csv")))], ignore_index=True)
    long = []
    for m in range(1, 13):
        cols = {c: c[4:] for c in w.columns if c.startswith(f"m{m:02d}_")}
        long.append(w[["cfips", "year", *cols]].rename(columns=cols).assign(month=m))
    return pd.concat(long, ignore_index=True)


def modis():
    return pd.concat([pd.read_csv(f, dtype={"cfips": str}) for f in sorted(glob.glob(str(CAL / "cty_modis_*.csv")))], ignore_index=True)


def features(crop, w, md):
    group, doys, months, heat_months = CROPS[crop]
    # greenness over the crop's own pixels
    g = md[["cfips", "year"]].copy()
    vals = []
    for d in doys:
        v = md[f"{group}_{d:03d}_mean"].where(md[f"{group}_{d:03d}_count"] >= MIN_PX)
        vals.append(v.values)
    vals = np.array(vals).T
    with np.errstate(all="ignore"):
        g["g_key"] = np.nanmean(vals, 1)
        g["g_peak"] = np.nanmax(vals, 1)
        g["g_late"] = np.nanmean(vals[:, -2:], 1)
    g["px"] = md[[f"{group}_{d:03d}_count" for d in doys]].median(1).values
    # weather over the crop's season window (season year = harvest year)
    x = w.copy()
    x["sm"] = np.where(x.month >= 10, x.month - 12, x.month)
    x["year"] = np.where(x.month >= 10, x.year + 1, x.year)
    win = x[x.sm.isin(months)]
    a = win.groupby(["cfips", "year"]).agg(rain=("pr", "sum"), heavy=("heavy", "sum"), eto=("eto", "sum"),
                                            def_=("def", "sum"), n=("pr", "count")).rename(columns={"def_": "def"})
    a = a[a.n == len(months)].drop(columns="n")
    hot = x[x.sm.isin(heat_months)].groupby(["cfips", "year"]).hot.sum()
    end = x[x.sm == months[-1]].set_index(["cfips", "year"])[["spei90", "soil"]].rename(columns={"spei90": "spei_end", "soil": "soil_end"})
    f = a.join(hot).join(end).reset_index()
    return f.merge(g, on=["cfips", "year"], how="left")


def table():
    y, w, md = yields(), weather(), modis()
    out = []
    for crop in CROPS:
        f = features(crop, w, md)
        d = y[y.commodity_desc == crop].merge(f, on=["cfips", "year"], how="inner")
        out.append(d.assign(crop=crop))
    return pd.concat(out, ignore_index=True)


# ---------------- leak-free fold preparation ----------------

def prepare(d, train_mask):
    """Trend per county-crop and county greenness means from the TRAINING rows only; returns d with dev + anomalies."""
    d = d.copy()
    tr = d[train_mask]
    trend = {}
    if TREND == "county":
        for k, g in tr.groupby(["crop", "cfips"]):
            if len(g) >= 8:
                trend[k] = np.polyfit(g.year, g.yield_, 1)
    else:
        # one yield-gain slope per crop shared by all counties (as a share of the county's level), county levels
        # separate: steadier than 25 separate lines fitted on ~15-25 noisy years each
        for crop, g in tr.groupby("crop"):
            lvl = g.groupby("cfips").yield_.transform("mean")
            slope = np.polyfit(g.year - 2012, g.yield_ / lvl, 1)[0]
            for c, gc in g.groupby("cfips"):
                if len(gc) >= 8:
                    a = (gc.yield_ / (1 + slope * (gc.year - 2012))).mean()
                    trend[(crop, c)] = np.array([a * slope, a * (1 - slope * 2012)])
    keep = [k in trend for k in zip(d.crop, d.cfips)]
    d = d[keep].copy()
    d["trend"] = [np.polyval(trend[k], yr) for k, yr in zip(zip(d.crop, d.cfips), d.year)]
    d["dev"] = 100 * (d.yield_ / d.trend - 1)
    tm = train_mask[keep] if isinstance(train_mask, np.ndarray) else train_mask.loc[d.index]
    # greenness anomalies per county, crop and mask era (before 2008 = the crop's usual pixels, 2008+ = that year's CDL)
    d["era"] = (d.year >= 2008).astype(int)
    for c in ("g_key", "g_peak", "g_late"):
        mean = d[tm].groupby(["crop", "cfips", "era"])[c].mean()
        d[f"{c}_anom"] = d[c].values - mean.reindex(list(zip(d.crop, d.cfips, d.era))).values
    return d, trend


def ridge(alpha=10.0):
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=alpha))


def partial_pool(tr, te, feats, shrink=0.3):
    """Shared slopes + county-specific greenness slopes, the county columns scaled down (= penalised harder)."""
    counties = sorted(tr.cfips.unique())

    def design(x):
        X = x[feats].copy()
        for c in counties:
            X[f"gk_{c}"] = np.where(x.cfips == c, x.g_key_anom.fillna(0), 0.0) * shrink
        return X
    m = ridge(10.0).fit(design(tr), tr.dev)
    return m.predict(design(te))


def trees():
    return HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05, max_depth=3, min_samples_leaf=15,
                                         l2_regularization=1.0, random_state=0)


METHODS = ["trendOnly", "greennessLine", "ridgeSmall", "partialPool", "trees", "allCrops", "weatherOnly"]


def predict_fold(d, test_year=None, train_end=None):
    """One fold: train on every year except test_year (or <= train_end), predict the rest. Returns test rows + preds."""
    mask = (d.year != test_year) if test_year is not None else (d.year <= train_end)
    p, _ = prepare(d, mask.values)
    trm = (p.year != test_year) if test_year is not None else (p.year <= train_end)
    out = []
    # all crops in one model: shared + crop-specific slopes
    allx = p.copy()
    for c in CROPS:
        for f in SMALL:
            allx[f"{f}_{c}"] = np.where(allx.crop == c, allx[f], 0.0)
    acols = SMALL + [f"{f}_{c}" for c in CROPS for f in SMALL]
    trall = allx[trm & allx.g_key_anom.notna()]
    am = ridge(20.0).fit(trall[acols], trall.dev) if len(trall) > 50 else None
    for crop in CROPS:
        x = p[p.crop == crop]
        tr, te = x[trm.loc[x.index] & x.g_key_anom.notna()], x[~trm.loc[x.index]]
        if len(tr) < 40 or not len(te):
            continue
        te = te.copy()
        te["trendOnly"] = 0.0
        gl = np.polyfit(tr.g_key_anom, tr.dev, 1)
        te["greennessLine"] = np.polyval(gl, te.g_key_anom.fillna(0))
        te["ridgeSmall"] = ridge().fit(tr[SMALL], tr.dev).predict(te[SMALL])
        te["partialPool"] = partial_pool(tr, te, SMALL)
        te["trees"] = trees().fit(tr[FULL], tr.dev).predict(te[FULL])
        te["allCrops"] = am.predict(allx.loc[te.index, acols]) if am is not None else np.nan
        trw = x[trm.loc[x.index]]
        te["weatherOnly"] = ridge().fit(trw[WEATHER_ONLY], trw.dev).predict(te[WEATHER_ONLY])
        out.append(te)
    return pd.concat(out) if out else pd.DataFrame()


def score(te, mask=None):
    te = te if mask is None else te[mask]
    out = {}
    for k in METHODS:
        v = te[["dev", k, "yield_", "trend"]].dropna()
        if len(v) < 8:
            continue
        yp = v.trend * (1 + v[k] / 100)
        out[k] = {"r2_deviation": round(r2_score(v.dev, v[k]), 3), "r2_yield": round(r2_score(v.yield_, yp), 3),
                  "mae_yield": round(mean_absolute_error(v.yield_, yp), 1), "n": int(len(v)),
                  "corr": round(float(np.corrcoef(v.dev, v[k])[0, 1]), 3) if v[k].std() > 0 else None}
    return out


def riesel_check(loyo):
    """McLennan county predictions vs the Riesel watershed harvests (field yield vs its own trend)."""
    p = DATA / "riesel_yields.csv"
    if not p.exists():
        return None
    r = pd.read_csv(p)
    r = r[r.unit.isin(["bu/ac", "lb/ac"]) & (r.year >= Y0)]
    out = {}
    for crop in CROPS:
        rc = r[r.crop == crop].groupby(["field", "year"])["yield"].mean().reset_index()
        if len(rc) < 6:
            continue
        devs = []
        for fld, g in rc.groupby("field"):
            base = np.polyval(np.polyfit(g.year, g["yield"], 1), g.year) if len(g) >= 6 else g["yield"].mean()
            devs.append(g.assign(field_dev=100 * (g["yield"] / base - 1)))
        rc = pd.concat(devs)
        pred = loyo[(loyo.cfips == "48309") & (loyo.crop == crop)][["year", "dev", "best"]]
        m = rc.merge(pred, on="year")
        if len(m) >= 6:
            out[crop] = {"n": int(len(m)), "years": sorted(int(v) for v in m.year.unique()),
                         "spearman_pred_vs_field": round(float(spearmanr(m.best, m.field_dev).statistic), 3),
                         "spearman_county_vs_field": round(float(spearmanr(m.dev, m.field_dev).statistic), 3)}
    return out


def main():
    d = table()
    d = d[d.year.between(Y0, Y1)].reset_index(drop=True)
    print(f"{len(d)} county-crop-years, {d.cfips.nunique()} counties, {Y0}-{Y1}")
    print(d.groupby("crop").agg(n=("year", "size"), counties=("cfips", "nunique"), greenness=("g_key", lambda v: v.notna().mean())).round(2).to_string())

    loyo = pd.concat([predict_fold(d, test_year=y) for y in range(Y0, Y1 + 1)])
    fwd = predict_fold(d, train_end=2012)
    res = {"trend": TREND, "counties": int(d.cfips.nunique()), "years": [Y0, Y1], "rows": int(len(d)), "crops": {}}
    for crop in CROPS:
        lc, fc = loyo[loyo.crop == crop], fwd[fwd.crop == crop]
        s_all = score(lc)
        best = max((k for k in METHODS if k != "trendOnly" and k in s_all), key=lambda k: s_all[k]["r2_deviation"])
        res["crops"][crop] = {"unit": lc.unit.iloc[0], "best": best,
                              "leaveOneYearOut": {"all25": s_all, "study6": score(lc, lc.cfips.isin(STUDY)),
                                                  "hill": score(lc, lc.cfips == HOLDOUT)},
                              "forward_train2000_2012_test2013_2025": score(fc)}
        loyo.loc[loyo.crop == crop, "best"] = lc[best]
        print(f"{crop:<8} best {best:<13} LOYO R2 dev: " + ", ".join(f"{k} {v['r2_deviation']:.2f}" for k, v in s_all.items())
              + f" | study 6: {res['crops'][crop]['leaveOneYearOut']['study6'].get(best, {}).get('r2_deviation')}"
              + f" | forward: {score(fc).get(best, {}).get('r2_deviation')}", flush=True)

    res["riesel"] = riesel_check(loyo)
    print("Riesel field check:", res["riesel"])

    # final models on every year + the per-unit response numbers the simulator must reproduce
    p, trend = prepare(d, np.ones(len(d), bool))
    models = {}
    for crop in CROPS:
        x = p[(p.crop == crop) & p.g_key_anom.notna()]
        m = ridge().fit(x[SMALL], x.dev)
        coef = m[-1].coef_ / m[1].scale_
        res["crops"][crop]["targets"] = {
            "yieldPctPer0_1NdviAnomaly": round(float(coef[0]) * 0.1, 2),
            "yieldPctPer0_1LateNdviAnomaly": round(float(coef[1]) * 0.1, 2),
            "yieldPctPerHotDay": round(float(coef[2]), 3), "yieldPctPerSpeiUnit": round(float(coef[3]), 2),
            "yieldPctPer100mmRain": round(float(coef[4]) * 100, 2),
            "greennessLineSlopePer0_1": round(float(np.polyfit(x.g_key_anom, x.dev, 1)[0]) * 0.1, 2)}
        models[crop] = {"ridgeSmall": m, "trees": trees().fit(p[p.crop == crop][FULL], p[p.crop == crop].dev),
                        "features": SMALL, "fullFeatures": FULL, "spec": CROPS[crop],
                        "trend": {k[1]: v for k, v in trend.items() if k[0] == crop}}
    joblib.dump(models, HERE / "calibrationE.joblib")
    loyo.to_csv(HERE / "predictions.csv", index=False)
    (HERE / "metrics.json").write_text(json.dumps(res, indent=1))
    write_report(res)
    print("wrote calibrationE.joblib, predictions.csv, metrics.json, REPORT.md")


def write_report(res):
    L = ["# Calibration E v2: county yields from MODIS crop greenness + weather", "",
         f"{res['counties']} Blacklands counties, {res['years'][0]}-{res['years'][1]}, {res['rows']} county-crop-years. "
         "Target: % deviation of the NASS county yield from its trend. Scored leave-one-year-out (trend and county "
         "greenness means refit without the held-out year), plus a forward test (train 2000-2012, test 2013-2025).", "",
         "R² of the deviation (0 = no better than the trend; the trend-only line is 0 by construction).", "",
         "| Crop | Best method | All 25 counties | 6 study counties | Hill (held out) | Forward test | MAE yield (trend → best) |",
         "|---|---|---|---|---|---|---|"]
    for crop, r in res["crops"].items():
        b = r["best"]
        g = lambda s: s.get(b, {}).get("r2_deviation", "–")
        a = r["leaveOneYearOut"]["all25"]
        L.append(f"| {crop.title()} ({r['unit']}) | {b} | {g(a)} | {g(r['leaveOneYearOut']['study6'])} | "
                 f"{g(r['leaveOneYearOut']['hill'])} | {g(r['forward_train2000_2012_test2013_2025'])} | "
                 f"{a['trendOnly']['mae_yield']} → {a[b]['mae_yield']} |")
    L += ["", "## Every method (leave-one-year-out, all 25 counties, R² of deviation)", "",
          "| Crop | " + " | ".join(METHODS) + " |", "|---" * (len(METHODS) + 1) + "|"]
    for crop, r in res["crops"].items():
        a = r["leaveOneYearOut"]["all25"]
        L.append(f"| {crop.title()} | " + " | ".join(str(a.get(k, {}).get("r2_deviation", "–")) for k in METHODS) + " |")
    L += ["", "## Simulator targets (ridge on all years, per unit)", "",
          "| Crop | % per +0.1 NDVI anomaly | % per +0.1 late NDVI | % per hot day | % per SPEI unit | % per 100 mm rain |",
          "|---|---|---|---|---|---|"]
    for crop, r in res["crops"].items():
        t = r["targets"]
        L.append(f"| {crop.title()} | {t['yieldPctPer0_1NdviAnomaly']} | {t['yieldPctPer0_1LateNdviAnomaly']} | "
                 f"{t['yieldPctPerHotDay']} | {t['yieldPctPerSpeiUnit']} | {t['yieldPctPer100mmRain']} |")
    L += ["", "## Field check: USDA-ARS Riesel watersheds (McLennan County, never used for fitting)", ""]
    if res.get("riesel"):
        for crop, v in res["riesel"].items():
            L.append(f"- {crop.title()}: {v['n']} field harvests ({v['years'][0]}-{v['years'][-1]}). Spearman of E's "
                     f"county prediction vs the field's own deviation {v['spearman_pred_vs_field']} "
                     f"(actual county yield vs field: {v['spearman_county_vs_field']}).")
    else:
        L.append("- Too few Riesel harvests after 2000 to check.")
    L += ["", "Methods: trendOnly (0), greennessLine (deviation ~ key-window NDVI anomaly), ridgeSmall (5 inputs, "
          "counties pooled), partialPool (ridgeSmall + county greenness slopes shrunk toward the shared one), trees "
          "(10 inputs), allCrops (one ridge for all crops, shared + crop slopes), weatherOnly (no greenness).", ""]
    (HERE / "REPORT.md").write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    main()
