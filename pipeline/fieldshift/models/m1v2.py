import sys, json, warnings, numpy as np, pandas as pd
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import accuracy_score, f1_score
from exp import load, model
warnings.filterwarnings("ignore")
MINP = float(sys.argv[1]); SOIL = sys.argv[2] == "1"; FINAL = len(sys.argv) > 3
feat, lab, F = load("c0.6_b16_s31", "B", True)
pur = pd.read_csv("r2/cdl_purity.csv")[["field_id", "year", "purity"]]
conf = pd.read_csv("r2/cdl_confidence.csv")
lab = lab.merge(pur, on=["field_id", "year"], how="left").merge(conf, on=["field_id", "year"], how="left")
if SOIL:
    soil = pd.read_csv("r2/fields_soil.csv"); lab = lab.merge(soil, on="field_id", how="left")
    F = F + [c for c in soil.columns if c != "field_id"]
test_years = sorted(lab.year.unique())[-3:]
tr_all, te_all = lab[~lab.year.isin(test_years)], lab[lab.year.isin(test_years)]
tr = tr_all[tr_all.purity >= MINP]
p = cross_val_predict(model("hgb"), tr[F], tr.crop, groups=tr.year, cv=GroupKFold(5))
out = {"min_purity": MINP, "soil": SOIL, "n_train": len(tr), "cv_acc_clean": round(accuracy_score(tr.crop, p), 3)}
if FINAL:
    m = model("hgb").fit(tr[F], tr.crop)
    for name, te in [("all_test_fields", te_all), ("clean_test_fields", te_all[te_all.purity >= MINP])]:
        pt = m.predict(te[F]); c = m.predict_proba(te[F]).max(1)
        out[name] = {"n": len(te), "acc": round(accuracy_score(te.crop, pt), 3), "macro_f1": round(f1_score(te.crop, pt, average="macro"), 3),
                     "conf>=0.7": [round(float((c >= .7).mean()), 2), round(accuracy_score(te.crop[c >= .7], pt[c >= .7]), 3)],
                     "conf>=0.8": [round(float((c >= .8).mean()), 2), round(accuracy_score(te.crop[c >= .8], pt[c >= .8]), 3)]}
        if name == "clean_test_fields":
            labs = sorted(te.crop.unique()); out["per_class_f1_clean"] = dict(zip(labs, np.round(f1_score(te.crop, pt, average=None, labels=labs), 2).tolist()))
print(json.dumps(out))
