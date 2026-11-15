"""Model 1 (Field Shift v2, Model A part 1): what crop grew on each field each year, 1985-2025.

Gradient-boosted trees on Landsat season-curve features + soil (features.py). Labels: USDA CDL majority class per
field-year 2008-2025, only where >= 70 % of the field's pixels agree (purity), so the model learns from clean fields.

Honest tests (trained on 2008-2019, never on Hill County):
  A. unseen years 2020-2025 (other 5 counties)          B. unseen county: Hill, every labelled year
Baselines on the same rows: most common crop, "same crop as last year" (needs last year's USDA label, so it is a
stronger baseline than the model gets: the model never sees any label for the year it predicts), and simple
curve-shape rules. Then grouped cross-validation by year on the training years.
Red-edge test: the same model with Sentinel-2 red-edge features (HLS S30), 2016-2019 -> 2020-2025 (no 2024 file).

Final model refit on every clean labelled field-year (all counties, 2008-2025) labels 1985-2007 and gives
probabilities for every year.

  python v2/models/model1/train.py
Writes v2/models/model1/: model1.joblib, metrics.json, predictions.csv.gz, REPORT.md
"""
import glob, json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import GroupKFold

from features import GROUP, OUT as DATA, ROOT

HERE = Path(__file__).resolve().parent
HOLDOUT = "48217"                       # Hill County
TRAIN_END, TEST = 2019, range(2020, 2026)
MIN_PURITY = 0.7
DROP_CLASSES = {"other", "noncrop"}    # 5 and 49 field-years (4 in training): too few to learn
SEED = 0


def model():
    return HistGradientBoostingClassifier(max_iter=600, learning_rate=0.06, max_leaf_nodes=31, l2_regularization=1.0,
                                          min_samples_leaf=20, early_stopping=True, validation_fraction=0.1,
                                          n_iter_no_change=30, random_state=SEED)


def scores(y, p):
    g = lambda s: pd.Series(s).map(GROUP).values
    return {"n": int(len(y)), "accuracy": round(accuracy_score(y, p), 3),
            "balancedAccuracy": round(balanced_accuracy_score(y, p), 3),
            "groupedAccuracy": round(accuracy_score(g(y), g(p)), 3),
            "groupedBalancedAccuracy": round(balanced_accuracy_score(g(y), g(p)), 3)}


def rules(d):
    """Curve-shape rules a person might write: winter green = wheat, early-summer peak = corn, late peak = cotton..."""
    out = np.full(len(d), "fallow", dtype=object)
    w, sp, su, pk, mx, rg = (d[c].values for c in ("ndvi_winter", "ndvi_spring", "ndvi_summer", "peak_doy", "ndvi_max", "ndvi_range"))
    out[(mx > 0.45) & (rg < 0.25)] = "hay_grass"
    out[(mx > 0.5) & (pk >= 200)] = "cotton"
    out[(mx > 0.5) & (pk < 200) & (pk >= 140)] = "corn"
    out[(w > 0.4) & ((pk < 140) | (w > su))] = "wheat"
    return out


def evaluate(name, d, pred, base):
    r = {"model": scores(d.fine, pred), **{k: scores(d.fine, v) for k, v in base.items()}}
    print(f"\n{name}: n={len(d)}")
    for k, v in r.items():
        print(f"  {k:<18} acc {v['accuracy']:.3f}  bal {v['balancedAccuracy']:.3f}  grouped {v['groupedAccuracy']:.3f}")
    return r


def red_edge_features():
    files = sorted(glob.glob(str(ROOT / "v2" / "data" / "ee" / "hlss30_*.csv")))
    cols = ["fid", "date", "tot_count", "snow_count", "ndvi_count", "ndvi_p50", "ndre_p50", "cire_p50", "ndti_p50"]
    parts = []
    for f in files:
        d = pd.read_csv(f, usecols=lambda c: c in cols)
        parts.append(d[(d.tot_count > 0) & (d.ndvi_count >= 0.7 * d.tot_count) & (d.snow_count <= 0.05 * d.tot_count)])
    s = pd.concat(parts)
    s["date"] = pd.to_datetime(s.date)
    s = s.assign(year=s.date.dt.year, m=s.date.dt.month)
    g = s.groupby(["fid", "year", "m"])[["ndvi_p50", "ndre_p50", "cire_p50"]].median().unstack("m")
    g.columns = [f"s2_{v[:-4]}_m{int(m):02d}" for v, m in g.columns]
    g["s2_n_obs"] = s.groupby(["fid", "year"]).size()
    years = sorted(s.year.unique())
    print(f"\nSentinel-2 (HLS S30) years available: {years}")
    return g.reset_index(), years


def main():
    f = pd.read_pickle(DATA / "features.pkl")
    lab = pd.read_pickle(DATA / "labels.pkl")
    X_COLS = [c for c in f.columns if c not in ("fid", "year", "cfips")]
    d = f.merge(lab, on=["fid", "year"], how="inner")
    d = d[~d.fine.isin(DROP_CLASSES)]
    prev = lab[["fid", "year", "fine"]].assign(year=lab.year + 1).rename(columns={"fine": "prev_fine"})
    d = d.merge(prev, on=["fid", "year"], how="left")
    clean = d.purity >= MIN_PURITY
    hill = d.cfips == HOLDOUT
    train = d[(d.year <= TRAIN_END) & ~hill & clean]
    print(f"training rows: {len(train):,} (2008-{TRAIN_END}, 5 counties, purity >= {MIN_PURITY}); "
          f"classes: {train.fine.value_counts().to_dict()}")

    m = model().fit(train[X_COLS], train.fine)
    majority = train.fine.mode()[0]

    def baselines(t):
        return {"mostCommonCrop": np.full(len(t), majority),
                "sameAsLastYear": t.prev_fine.fillna(majority).values,
                "curveRules": rules(t)}

    res = {}
    for name, mask in {"unseenYears_clean": d.year.isin(TEST) & ~hill & clean,
                       "unseenYears_all": d.year.isin(TEST) & ~hill,
                       "unseenCounty_Hill_clean": hill & clean,
                       "unseenCounty_Hill_all": hill,
                       "unseenCounty_Hill_unseenYears_clean": hill & clean & d.year.isin(TEST)}.items():
        t = d[mask]
        res[name] = evaluate(name, t, m.predict(t[X_COLS]), baselines(t))
        if name == "unseenYears_clean":
            p = m.predict(t[X_COLS])
            res[name]["perClass"] = {k: {"recall": round(v["recall"], 3), "precision": round(v["precision"], 3), "n": int(v["support"])}
                                     for k, v in classification_report(t.fine, p, output_dict=True, zero_division=0).items()
                                     if k in set(t.fine)}
            labs = sorted(set(t.fine) | set(p))
            res[name]["confusion"] = {"labels": labs, "matrix": confusion_matrix(t.fine, p, labels=labs).tolist()}

    # grouped CV by year on the training years
    folds = []
    for tr, va in GroupKFold(n_splits=4).split(train, groups=train.year):
        mm = model().fit(train.iloc[tr][X_COLS], train.iloc[tr].fine)
        folds.append(accuracy_score(train.iloc[va].fine, mm.predict(train.iloc[va][X_COLS])))
    res["cvByYear_trainingYears"] = {"folds": [round(x, 3) for x in folds], "mean": round(float(np.mean(folds)), 3)}
    print(f"\ngrouped CV by year (2008-{TRAIN_END}): {np.round(folds, 3)} mean {np.mean(folds):.3f}")

    # red-edge: Landsat-only vs + Sentinel-2, same rows (2016-2019 train, 2020-2025 test, Sentinel-2 years only)
    s2, s2_years = red_edge_features()
    e = d.merge(s2, on=["fid", "year"], how="inner")
    S2_COLS = [c for c in s2.columns if c not in ("fid", "year")]
    tr = e[(e.year <= TRAIN_END) & ~(e.cfips == HOLDOUT) & (e.purity >= MIN_PURITY)]
    te = e[e.year.isin(TEST) & ~(e.cfips == HOLDOUT) & (e.purity >= MIN_PURITY)]
    a = model().fit(tr[X_COLS], tr.fine)
    b = model().fit(tr[X_COLS + S2_COLS], tr.fine)
    res["redEdge"] = {"trainYears": [int(tr.year.min()), int(tr.year.max())], "testYears": sorted(int(y) for y in te.year.unique()),
                      "landsatOnly": scores(te.fine, a.predict(te[X_COLS])),
                      "plusSentinel2RedEdge": scores(te.fine, b.predict(te[X_COLS + S2_COLS]))}
    for k in ("landsatOnly", "plusSentinel2RedEdge"):
        v = res["redEdge"][k]
        print(f"  red-edge test {k:<22} acc {v['accuracy']:.3f}  bal {v['balancedAccuracy']:.3f}  grouped {v['groupedAccuracy']:.3f}")
    cs = te[te.fine.isin(["corn", "sorghum"])]
    if len(cs):
        res["redEdge"]["cornVsSorghum"] = {
            "n": int(len(cs)),
            "landsatOnly": round(accuracy_score(cs.fine, a.predict(cs[X_COLS])), 3),
            "plusSentinel2RedEdge": round(accuracy_score(cs.fine, b.predict(cs[X_COLS + S2_COLS])), 3)}
        print(f"  corn vs sorghum rows (n={len(cs)}): Landsat {res['redEdge']['cornVsSorghum']['landsatOnly']:.3f}, "
              f"+ red-edge {res['redEdge']['cornVsSorghum']['plusSentinel2RedEdge']:.3f}")

    # final model: every clean labelled field-year, all counties -> labels and probabilities for 1985-2025
    full = d[clean]
    final = model().fit(full[X_COLS], full.fine)
    proba = final.predict_proba(f[X_COLS])
    out = f[["fid", "year"]].copy()
    out["pred"] = final.classes_[proba.argmax(1)]
    out["confidence"] = proba.max(1).round(3)
    out["pred_group"] = out.pred.map(GROUP)
    out = out.merge(lab[["fid", "year", "fine", "purity"]].rename(columns={"fine": "cdl"}), on=["fid", "year"], how="left")
    out["source"] = np.where(out.cdl.notna() & (out.purity >= MIN_PURITY), "usda_cdl", "model")
    out["final"] = np.where(out.source == "usda_cdl", out.cdl, out.pred)
    out.to_csv(HERE / "predictions.csv.gz", index=False)
    joblib.dump({"model": final, "features": X_COLS, "classes": list(final.classes_)}, HERE / "model1.joblib")

    res["meta"] = {"trainRows": int(len(train)), "finalRows": int(len(full)), "features": len(X_COLS),
                   "minPurity": MIN_PURITY, "holdoutCounty": HOLDOUT, "trainYears": [2008, TRAIN_END],
                   "testYears": list(TEST), "nFields": int(f.fid.nunique()),
                   "predictedYears": [int(f.year.min()), int(f.year.max())]}
    (HERE / "metrics.json").write_text(json.dumps(res, indent=1))
    print(f"\nwrote model1.joblib, metrics.json, predictions.csv.gz ({len(out):,} field-years; "
          f"{(out.source == 'model').mean():.0%} labelled by the model)")


if __name__ == "__main__":
    main()
