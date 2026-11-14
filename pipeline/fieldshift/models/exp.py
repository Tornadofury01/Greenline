"""Model 1 experiments. Tuning uses GroupKFold over TRAINING years only; the 2023-2025 test years are scored once per final config."""
import sys, pickle, warnings, json
import numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import accuracy_score, f1_score
warnings.filterwarnings("ignore")

def load(tag, classmap="B", prev=True, min_samples=50):
    c = pickle.load(open(f"cache_{tag}.pkl", "rb"))
    feat = c["feat"].copy()
    base = [x for x in feat.columns if x not in ("field_id", "year")]
    if prev:  # previous year's curve (satellite only, no labels): rotation context
        p = feat[["field_id", "year"] + [x for x in base if x.startswith(("ndvi_m", "bsi_m")) or x in ("ndvi_max", "peak_doy", "summer_bsi")]].copy()
        p["year"] += 1
        p = p.rename(columns={x: "prev_" + x for x in p.columns if x not in ("field_id", "year")})
        feat = feat.merge(p, on=["field_id", "year"], how="left")
    cdl = pd.read_csv("cdl_history.csv").dropna(subset=["crop_code"])
    cdl["crop_code"] = cdl.crop_code.astype(int)
    maps = {
        "A": {24: "winter_grain", 21: "winter_grain", 27: "winter_grain", 28: "winter_grain",
              26: "double_crop", 225: "double_crop", 236: "double_crop", 238: "double_crop",
              4: "sorghum", 1: "corn", 2: "cotton", 5: "soybeans",
              36: "grass_hay", 37: "grass_hay", 176: "grass_hay", 61: "fallow"},
    }
    maps["B"] = {**maps["A"], 1: "summer_grain", 4: "summer_grain"}
    cdl["crop"] = cdl.crop_code.map(maps[classmap]).fillna("other")
    lab = feat.merge(cdl[["field_id", "year", "crop"]], on=["field_id", "year"])
    vc = lab.crop.value_counts()
    lab.loc[lab.crop.isin(vc[vc < min_samples].index), "crop"] = "other"
    if classmap != "A":
        lab = lab[lab.crop != "other"]
    F = [x for x in feat.columns if x not in ("field_id", "year")]
    return feat, lab, F

def model(kind):
    if kind == "hgb":
        return HistGradientBoostingClassifier(max_iter=400, learning_rate=0.05, max_leaf_nodes=31,
                                              l2_regularization=1.0, class_weight="balanced", random_state=0)
    return make_pipeline(SimpleImputer(strategy="median"),
                         RandomForestClassifier(n_estimators=500, min_samples_leaf=2, class_weight="balanced_subsample",
                                                n_jobs=-1, random_state=0))

if __name__ == "__main__":
    tag, cm, prev, kind = sys.argv[1], sys.argv[2], sys.argv[3] == "1", sys.argv[4]
    final = len(sys.argv) > 5 and sys.argv[5] == "final"
    feat, lab, F = load(tag, cm, prev)
    test_years = sorted(lab.year.unique())[-3:]
    train, test = lab[~lab.year.isin(test_years)], lab[lab.year.isin(test_years)]
    p = cross_val_predict(model(kind), train[F], train.crop, groups=train.year, cv=GroupKFold(5))
    out = {"tag": tag, "classes": cm, "prev": prev, "model": kind, "n_train": len(train),
           "cv_acc": round(accuracy_score(train.crop, p), 3), "cv_f1": round(f1_score(train.crop, p, average="macro"), 3)}
    if final:
        m = model(kind).fit(train[F], train.crop)
        pt = m.predict(test[F]); conf = m.predict_proba(test[F]).max(1)
        out.update(test_acc=round(accuracy_score(test.crop, pt), 3), test_f1=round(f1_score(test.crop, pt, average="macro"), 3),
                   n_test=len(test), test_years=[int(y) for y in test_years])
        out["by_conf"] = {t: [round(float((conf >= t).mean()), 2), round(accuracy_score(test.crop[conf >= t], pt[conf >= t]), 3)]
                          for t in [0.5, 0.6, 0.7, 0.8, 0.9]}
        out["per_class_f1"] = dict(zip(sorted(test.crop.unique()),
                                       np.round(f1_score(test.crop, pt, average=None, labels=sorted(test.crop.unique())), 2).tolist()))
    print(json.dumps(out))
