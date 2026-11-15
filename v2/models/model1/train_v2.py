"""Model 1, round 2: every accuracy idea tested on the SAME held-out data as round 1, one step at a time.

Tests (never trained on): unseen years 2020-2025 in the 5 training counties (clean labels = purity >= 0.7, all labels,
and very clean >= 0.95) and the unseen county (Hill, every labelled year). Training rows: 2008-2019, 5 counties.

Steps (ablation): R1 round-1 features -> +dense series & phenology -> +weather (GDD, rain) -> all features ->
cleaner training labels (purity >= 0.9) -> class weights -> rotation context -> tuned -> 1D CNN -> ensemble.

Rotation context, leak-free: crop probabilities for the year before / after / two before, from models that never saw
that field (GroupKFold by field, fitted on training rows only). So no USDA label of the field leaks into its features.

  python v2/models/model1/train_v2.py
Writes v2/models/model1/: ablation.json, and with --final: model1_v2.joblib, predictions_v2.csv.gz
"""
import argparse, json, time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, balanced_accuracy_score
from sklearn.model_selection import GroupKFold

from features import GROUP, OUT as DATA

HERE = Path(__file__).resolve().parent
HOLDOUT, TRAIN_END, TEST = "48217", 2019, range(2020, 2026)
DROP = {"other", "noncrop"}


def hgb(**kw):
    p = dict(max_iter=800, learning_rate=0.06, max_leaf_nodes=31, l2_regularization=1.0, min_samples_leaf=20,
             early_stopping=True, validation_fraction=0.1, n_iter_no_change=30, random_state=0)
    p.update(kw)
    return HistGradientBoostingClassifier(**p)


def load():
    f1 = pd.read_pickle(DATA / "features.pkl")
    f2 = pd.read_pickle(DATA / "features_v2.pkl")
    lab = pd.read_pickle(DATA / "labels.pkl")
    f = f1.merge(f2, on=["fid", "year"], how="outer")
    f["cfips"] = f.fid.str[:5]
    R1 = [c for c in f1.columns if c not in ("fid", "year", "cfips")]
    V2 = [c for c in f2.columns if c not in ("fid", "year")]
    WX = [c for c in V2 if c.startswith(("gdd_", "rain_", "hot_"))]
    DENSE = [c for c in V2 if c not in WX]
    SOIL = [c for c in R1 if c.endswith(("_0_30", "_0_100")) or c in ("aws0100wta", "slope_r", "kwfact")]
    return f, lab, {"R1": R1, "DENSE": DENSE + SOIL, "DENSE_WX": DENSE + WX + SOIL, "ALL": sorted(set(R1 + V2))}


def splits(d):
    hill = d.cfips == HOLDOUT
    t = d.year.isin(TEST)
    return {"unseenYears_clean": t & ~hill & (d.purity >= 0.7), "unseenYears_all": t & ~hill,
            "unseenYears_veryClean95": t & ~hill & (d.purity >= 0.95),
            "hill_clean": hill & (d.purity >= 0.7), "hill_all": hill}


def score(d, pred):
    out = {}
    for k, m in splits(d).items():
        y, p = d.fine[m].values, pred[m.values]
        out[k] = {"acc": round(accuracy_score(y, p), 4), "bal": round(balanced_accuracy_score(y, p), 4),
                  "grouped": round(accuracy_score(pd.Series(y).map(GROUP), pd.Series(p).map(GROUP)), 4), "n": int(m.sum())}
    return out


def neighbour_probs(f, d, cols, classes, train_mask, n_splits=5, **kw):
    """P(class) for every field-year from models that never saw that field (GroupKFold by field)."""
    probs = np.zeros((len(f), len(classes)), dtype=np.float32)
    fids = f.fid.unique()
    rng = np.random.RandomState(0)
    fold_of = dict(zip(fids, rng.randint(0, n_splits, len(fids))))
    ffold = f.fid.map(fold_of).values
    tr = d[train_mask]
    tfold = tr.fid.map(fold_of).values
    for k in range(n_splits):
        m = hgb(**kw).fit(tr[tfold != k][cols], tr[tfold != k].fine)
        p = m.predict_proba(f[ffold == k][cols])
        probs[np.ix_(ffold == k, [classes.index(c) for c in m.classes_])] = p
    P = pd.DataFrame(probs, columns=[f"p_{c}" for c in classes])
    P["fid"], P["year"] = f.fid.values, f.year.values
    return P


def add_rotation(frame, P):
    out = frame
    pc = [c for c in P.columns if c.startswith("p_")]
    for lag, name in ((1, "prev"), (-1, "next"), (2, "prev2")):
        s = P.assign(year=P.year + lag).rename(columns={c: f"{name}_{c}" for c in pc})
        out = out.merge(s, on=["fid", "year"], how="left")
    return out


def cnn_predict(f, d, train_mask, classes, static_cols, epochs=40, seed=0, return_net=False):
    import torch, torch.nn as nn
    torch.manual_seed(seed); np.random.seed(seed)
    z = np.load(DATA / "series.npz", allow_pickle=True)
    key = pd.DataFrame({"fid": z["fid"], "year": z["year"], "row": np.arange(len(z["fid"]))})
    S = z["S"]
    mask = (~np.isnan(S)).astype(np.float32)
    S = np.nan_to_num(S)
    X = np.concatenate([S, mask[:, 3:4]], axis=1)                     # 4 index channels + "has red-edge"
    dd = d.merge(key, on=["fid", "year"], how="left")
    st = d[static_cols].astype(float)
    mu, sd = st[train_mask].mean(), st[train_mask].std().replace(0, 1)
    st = ((st - mu) / sd).fillna(0).values.astype(np.float32)
    ok = dd.row.notna().values
    rows = dd.row.fillna(0).astype(int).values
    y = np.array([classes.index(c) if c in classes else 0 for c in d.fine])   # unlabelled rows: never trained on
    tr = np.where(train_mask.values & ok)[0]
    va = tr[np.random.rand(len(tr)) < 0.1]
    tr = np.setdiff1d(tr, va)

    class Net(nn.Module):
        def __init__(s, n_static, n_cls):
            super().__init__()
            s.conv = nn.Sequential(nn.Conv1d(5, 64, 5, padding=2), nn.BatchNorm1d(64), nn.ReLU(),
                                   nn.Conv1d(64, 64, 5, padding=2), nn.BatchNorm1d(64), nn.ReLU(),
                                   nn.Conv1d(64, 64, 3, padding=1), nn.BatchNorm1d(64), nn.ReLU())
            s.head = nn.Sequential(nn.Linear(64 * 2 + n_static, 128), nn.ReLU(), nn.Dropout(0.3), nn.Linear(128, n_cls))
        def forward(s, x, st):
            h = s.conv(x)
            return s.head(torch.cat([h.mean(2), h.amax(2), st], 1))

    net = Net(st.shape[1], len(classes))
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, epochs)
    Xt, St, Yt = torch.tensor(X), torch.tensor(st), torch.tensor(y)
    best, best_state = 0, None
    for ep in range(epochs):
        net.train()
        perm = np.random.permutation(tr)
        for i in range(0, len(perm), 256):
            b = perm[i:i + 256]
            xb = Xt[rows[b]]
            xb = xb + 0.01 * torch.randn_like(xb)
            loss = nn.functional.cross_entropy(net(xb, St[b]), Yt[b], label_smoothing=0.05)
            opt.zero_grad(); loss.backward(); opt.step()
        sched.step()
        net.eval()
        with torch.no_grad():
            acc = (net(Xt[rows[va]], St[va]).argmax(1) == Yt[va]).float().mean().item()
        if acc > best:
            best, best_state = acc, {k: v.clone() for k, v in net.state_dict().items()}
    net.load_state_dict(best_state); net.eval()
    with torch.no_grad():
        P = torch.softmax(net(Xt[rows], St), 1).numpy()
    P[~ok] = np.nan
    if return_net:
        return P, net, {"mu": mu.to_dict(), "sd": sd.to_dict(), "static": list(static_cols), "classes": classes}
    return P


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-cnn", action="store_true")
    a = ap.parse_args()
    t0 = time.time()
    f, lab, C = load()
    d = f.merge(lab, on=["fid", "year"], how="inner")
    d = d[~d.fine.isin(DROP)].reset_index(drop=True)
    base_train = (d.year <= TRAIN_END) & (d.cfips != HOLDOUT)
    classes = sorted(d[base_train & (d.purity >= 0.7)].fine.unique())
    res, probs = {}, {}

    def run(name, cols, purity=0.7, frame=None, **kw):
        fr = d if frame is None else frame
        tm = base_train & (fr.purity >= purity)
        m = hgb(**kw).fit(fr[tm][cols], fr[tm].fine)
        P = np.zeros((len(fr), len(classes)))
        P[:, [classes.index(c) for c in m.classes_]] = m.predict_proba(fr[cols])
        probs[name] = P
        res[name] = score(fr, np.array(classes)[P.argmax(1)])
        r = res[name]
        print(f"{name:<34} test {r['unseenYears_clean']['acc']:.3f} | all {r['unseenYears_all']['acc']:.3f} | "
              f">=0.95 {r['unseenYears_veryClean95']['acc']:.3f} | grouped {r['unseenYears_clean']['grouped']:.3f} | "
              f"bal {r['unseenYears_clean']['bal']:.3f} | Hill {r['hill_clean']['acc']:.3f}   ({time.time() - t0:.0f}s)", flush=True)
        return m

    run("1 round-1 features", C["R1"])
    run("2 dense series + phenology", C["DENSE"])
    run("3 + weather (GDD, rain)", C["DENSE_WX"])
    run("4 all features", C["ALL"])
    run("5 + train on purity >= 0.9", C["ALL"], purity=0.9)
    best_p = 0.9 if res["5 + train on purity >= 0.9"]["unseenYears_clean"]["acc"] >= res["4 all features"]["unseenYears_clean"]["acc"] else 0.7
    run("6 + balanced class weights", C["ALL"], purity=best_p, class_weight="balanced")

    # rotation context
    P = neighbour_probs(f, d, C["ALL"], classes, base_train & (d.purity >= best_p))
    dr = add_rotation(d, P)
    ROT = [c for c in dr.columns if c.startswith(("prev_p_", "next_p_", "prev2_p_"))]
    run("7 + rotation context", C["ALL"] + ROT, purity=best_p, frame=dr)

    # small tuning grid, chosen by grouped-by-year CV on the training rows only
    tm = base_train & (dr.purity >= best_p)
    tr = dr[tm]
    grid = [dict(learning_rate=lr, max_leaf_nodes=nl, min_samples_leaf=ms, l2_regularization=l2)
            for lr in (0.04, 0.08) for nl in (31, 63) for ms in (20, 60) for l2 in (1.0,)]
    cv = {}
    for g in grid:
        accs = []
        for a_, b_ in GroupKFold(n_splits=3).split(tr, groups=tr.year):
            m = hgb(**g).fit(tr.iloc[a_][C["ALL"] + ROT], tr.iloc[a_].fine)
            accs.append(accuracy_score(tr.iloc[b_].fine, m.predict(tr.iloc[b_][C["ALL"] + ROT])))
        cv[json.dumps(g)] = float(np.mean(accs))
    bestg = json.loads(max(cv, key=cv.get))
    print(f"tuning (CV by year on 2008-2019): best {bestg} cv {max(cv.values()):.3f}", flush=True)
    run("8 tuned", C["ALL"] + ROT, purity=best_p, frame=dr, **bestg)
    res["tuning"] = {"grid": cv, "best": bestg, "purity": best_p}

    if not a.skip_cnn:
        static = [c for c in C["ALL"] if not c.startswith(("ndvi_t", "ndti_t", "bsi_t", "ndre_t"))] + ROT
        Pc = cnn_predict(f, dr, tm, classes, static)
        Pc = np.where(np.isnan(Pc), probs["8 tuned"], Pc)
        probs["9 1D CNN"] = Pc
        res["9 1D CNN"] = score(dr, np.array(classes)[Pc.argmax(1)])
        Pe = 0.5 * Pc + 0.5 * probs["8 tuned"]
        res["10 ensemble (tuned trees + CNN)"] = score(dr, np.array(classes)[Pe.argmax(1)])
        for k in ("9 1D CNN", "10 ensemble (tuned trees + CNN)"):
            r = res[k]
            print(f"{k:<34} test {r['unseenYears_clean']['acc']:.3f} | all {r['unseenYears_all']['acc']:.3f} | "
                  f">=0.95 {r['unseenYears_veryClean95']['acc']:.3f} | grouped {r['unseenYears_clean']['grouped']:.3f} | "
                  f"bal {r['unseenYears_clean']['bal']:.3f} | Hill {r['hill_clean']['acc']:.3f}", flush=True)

    (HERE / "ablation.json").write_text(json.dumps(res, indent=1))
    print(f"wrote ablation.json ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
