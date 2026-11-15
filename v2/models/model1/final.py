"""Model 1 final (round 2): tuned gradient-boosted trees + 1D CNN ensemble, rotation context, refit on every clean
USDA label (purity >= 0.7) in all 6 counties, 2008-2025. Labels every field-year 1985-2025 with a probability.
Test numbers for this setup are in ablation.json (row "10 ensemble"), measured before this refit.

  python v2/models/model1/final.py
Writes model1_v2_trees.joblib, model1_v2_cnn.pt, predictions_v2.csv.gz
"""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from features import GROUP
from train_v2 import DROP, HERE, add_rotation, cnn_predict, hgb, load, neighbour_probs


def main():
    f, lab, C = load()
    best = json.loads((HERE / "ablation.json").read_text())["tuning"]["best"]
    fr = f.merge(lab, on=["fid", "year"], how="left")
    fr["fine"] = fr.fine.where(~fr.fine.isin(DROP))
    train = fr.fine.notna() & (fr.purity >= 0.7)
    classes = sorted(fr[train].fine.unique())
    P = neighbour_probs(f, fr, C["ALL"], classes, train)
    fr = add_rotation(fr, P)
    ROT = [c for c in fr.columns if c.startswith(("prev_p_", "next_p_", "prev2_p_"))]
    cols = C["ALL"] + ROT
    trees = hgb(**best).fit(fr[train][cols], fr[train].fine)
    Pt = np.zeros((len(fr), len(classes)))
    Pt[:, [classes.index(c) for c in trees.classes_]] = trees.predict_proba(fr[cols])
    static = [c for c in C["ALL"] if not c.startswith(("ndvi_t", "ndti_t", "bsi_t", "ndre_t"))] + ROT
    fr["fine"] = fr.fine.fillna(classes[0])        # placeholder for unlabelled rows (masked out of training)
    Pc, net, meta = cnn_predict(f, fr, train, classes, static, return_net=True)
    Pc = np.where(np.isnan(Pc), Pt, Pc)
    Pe = 0.5 * Pt + 0.5 * Pc

    out = fr[["fid", "year"]].copy()
    out["pred"] = np.array(classes)[Pe.argmax(1)]
    out["confidence"] = Pe.max(1).round(3)
    out["pred_group"] = out.pred.map(GROUP)
    for i, c in enumerate(classes):
        out[f"p_{c}"] = Pe[:, i].round(3)
    out = out.merge(lab[["fid", "year", "fine", "purity"]].rename(columns={"fine": "cdl"}), on=["fid", "year"], how="left")
    out["source"] = np.where(out.cdl.notna() & (out.purity >= 0.7) & ~out.cdl.isin(DROP), "usda_cdl", "model")
    out["final"] = np.where(out.source == "usda_cdl", out.cdl, out.pred)
    out.to_csv(HERE / "predictions_v2.csv.gz", index=False)
    joblib.dump({"model": trees, "features": cols, "classes": classes, "tuned": best}, HERE / "model1_v2_trees.joblib")
    import torch
    torch.save({"state_dict": net.state_dict(), **meta}, HERE / "model1_v2_cnn.pt")
    pre = out[out.year < 2008]
    print(f"wrote predictions_v2.csv.gz ({len(out):,} field-years). 1985-2007 by the model: "
          f"{pre.pred_group.value_counts(normalize=True).round(2).to_dict()}; median confidence {pre.confidence.median():.2f}")


if __name__ == "__main__":
    main()
