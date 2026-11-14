"""Model 1 held-out report for the app: the m1v2.py final setup (train on clean-label fields, purity >= 0.7, + soil,
years before 2023), scored once on the unseen years 2023-2025. Writes model1_heldout.json with overall accuracy,
per-class recall / precision, and the "same crop as last year" baseline on the same test rows.

(final_m1.py then refits on all years for the app's labels; its metrics are copied from this setup.)
Run after features.py:  python evaluate_m1.py
"""
import json, warnings
import numpy as np, pandas as pd
from sklearn.metrics import accuracy_score, balanced_accuracy_score, precision_recall_fscore_support
from exp import load, model
warnings.filterwarnings("ignore")
MINP = 0.7

feat, lab, F = load("c0.6_b16_s31", "B", True)
soil = pd.read_csv("r2/fields_soil.csv")
lab = lab.merge(soil, on="field_id", how="left").merge(
    pd.read_csv("r2/cdl_purity.csv")[["field_id", "year", "purity"]], on=["field_id", "year"], how="left")
F = F + [c for c in soil.columns if c != "field_id"]
test_years = sorted(lab.year.unique())[-3:]
tr = lab[~lab.year.isin(test_years) & (lab.purity >= MINP)]
te = lab[lab.year.isin(test_years)].copy()
m = model("hgb").fit(tr[F], tr.crop)
te["pred"] = m.predict(te[F])

# baseline: the USDA label of the same field the year before
prev = lab[["field_id", "year", "crop"]].assign(year=lambda d: d.year + 1).rename(columns={"crop": "prev_crop"})
te = te.merge(prev, on=["field_id", "year"], how="left")


def report(d):
    labs = sorted(d.crop.unique())
    p, r, f, n = precision_recall_fscore_support(d.crop, d.pred, labels=labs, zero_division=0)
    b = d.dropna(subset=["prev_crop"])
    return {"n": len(d), "accuracy": round(accuracy_score(d.crop, d.pred), 3),
            "balancedAccuracy": round(balanced_accuracy_score(d.crop, d.pred), 3),
            "baselineSameAsLastYear": round(float((b.crop == b.prev_crop).mean()), 3),
            "perClass": {c: {"recall": round(float(r[i]), 3), "precision": round(float(p[i]), 3), "f1": round(float(f[i]), 2),
                             "n": int(n[i])} for i, c in enumerate(labs)}}


out = {"testYears": [int(y) for y in test_years], "minPurity": MINP, "nTrain": len(tr),
       "allFields": report(te), "cleanFields": report(te[te.purity >= MINP]),
       "predictions": te[["field_id", "year", "crop", "pred"]].astype({"field_id": int, "year": int}).values.tolist()}
json.dump(out, open("model1_heldout.json", "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k != "predictions"}, indent=1))
