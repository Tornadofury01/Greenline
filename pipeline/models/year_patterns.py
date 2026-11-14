"""Model 3: year pattern finder.

K-means on yearly NASA POWER climate features for the demo field. Each cluster is named
drought / wet / heat / normal from its centroid, and the worst past years of each kind become
"bad-year replay" presets (e.g. 2011).

Validation (k-means has no labels, so "accuracy" means two things here):
  * Leave-one-year-out stability: refit without year Y, assign Y to the nearest centroid,
    and check it gets the same label as the full fit. Y is never seen by the model that labels it.
  * Agreement with a simple percentile rule (the transparent baseline), on the same held-out setup.

Run from the repo root:  pipeline\\.venv\\Scripts\\python pipeline\\models\\year_patterns.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
OUT = HERE / "results"
SEED = 0
FEATURES = ["precipMm", "gsPrecipMm", "summerPrecipMm", "summerTmaxC", "heatStressDays", "frostFreeDays"]


def yearly_features():
    m = pd.read_csv(DATA / "power_monthly.csv")
    y = pd.read_csv(DATA / "power_yearly.csv")
    y = y[y.completeYear.astype(str) == "True"]
    g = m.groupby("year")
    f = pd.DataFrame({
        "precipMm": g.precipMm.sum(),
        "gsPrecipMm": m[m.month.between(4, 9)].groupby("year").precipMm.sum(),       # Apr-Sep
        "summerPrecipMm": m[m.month.between(6, 8)].groupby("year").precipMm.sum(),   # Jun-Aug
        "summerTmaxC": m[m.month.between(6, 8)].groupby("year").tMaxC.mean(),
        "heatStressDays": g.heatStressDays.sum(),
    })
    f = f.join(y.set_index("year")[["frostFreeDays"]], how="inner")
    # A few years have no fall frost (frostFreeDays empty). Fill with the median and say so.
    missing_ff = f.index[f.frostFreeDays.isna()].tolist()
    f["frostFreeDays"] = f.frostFreeDays.fillna(f.frostFreeDays.median())
    return f.dropna(), missing_ff


def name_clusters(centers_z):
    """Give each centroid (in z-scores) one label. Driest -> drought, wettest -> wet,
    hottest of the rest -> heat, the rest -> normal."""
    c = pd.DataFrame(centers_z, columns=FEATURES)
    wet = c.gsPrecipMm + c.summerPrecipMm
    hot = c.summerTmaxC + c.heatStressDays
    names, left = {}, set(c.index)
    for label, score in (("drought", hot - wet), ("wet", wet), ("heat", hot)):
        k = max(left, key=lambda i: score[i])
        names[k] = label
        left.remove(k)
    for k in left:
        names[k] = "normal"
    return names


def fit(X, k):
    sc = StandardScaler().fit(X)
    km = KMeans(k, n_init=50, random_state=SEED).fit(sc.transform(X))
    names = name_clusters(km.cluster_centers_)
    return sc, km, names


def rule_label(row, ref):
    """Transparent baseline: percentile thresholds computed on the training years only."""
    if row.gsPrecipMm <= ref.gsPrecipMm.quantile(0.2) and row.summerTmaxC >= ref.summerTmaxC.median():
        return "drought"
    if row.gsPrecipMm >= ref.gsPrecipMm.quantile(0.8):
        return "wet"
    if row.heatStressDays >= ref.heatStressDays.quantile(0.8):
        return "heat"
    return "normal"


def main():
    OUT.mkdir(exist_ok=True)
    f, missing_ff = yearly_features()
    X = f[FEATURES].values
    sil = {k: round(float(silhouette_score(StandardScaler().fit_transform(X),
                                          KMeans(k, n_init=50, random_state=SEED).fit_predict(StandardScaler().fit_transform(X)))), 3)
           for k in range(2, 8)}
    K = 4  # four named year types (drought / wet / heat / normal) are what the app needs
    sc, km, names = fit(X, K)
    full = pd.Series([names[c] for c in km.predict(sc.transform(X))], index=f.index)

    # Leave-one-year-out
    loo_km, loo_rule = {}, {}
    for yr in f.index:
        tr = f.drop(yr)
        s2, k2, n2 = fit(tr[FEATURES].values, K)
        loo_km[yr] = n2[int(k2.predict(s2.transform(f.loc[[yr], FEATURES].values))[0])]
        loo_rule[yr] = rule_label(f.loc[yr], tr)
    loo_km, loo_rule = pd.Series(loo_km), pd.Series(loo_rule)
    stability = float((loo_km == full).mean())
    agree_rule = float((loo_km == loo_rule).mean())

    # Replay presets: most extreme year of each bad type
    z = pd.DataFrame(sc.transform(X), index=f.index, columns=FEATURES)
    sev = {"drought": (z.summerTmaxC + z.heatStressDays) - (z.gsPrecipMm + z.summerPrecipMm),
           "wet": z.gsPrecipMm + z.summerPrecipMm,
           "heat": z.summerTmaxC + z.heatStressDays}
    presets = []
    for t, s in sev.items():
        yrs = full[full == t].index
        if len(yrs):
            best = s[yrs].sort_values(ascending=False).index[:2]
            presets += [{"year": int(y), "yearType": t, "severityZ": round(float(s[y]), 2)} for y in best]

    counts = full.value_counts().to_dict()
    flags = []
    if len(f) < 50:
        flags.append(f"Only {len(f)} years of data for clustering; clusters can shift if a few years change.")
    if min(counts.values()) <= 3:
        flags.append(f"Smallest cluster has {min(counts.values())} years: {counts}.")
    if missing_ff:
        flags.append(f"No fall frost recorded in {missing_ff}; frostFreeDays filled with the median.")
    flags.append("Single point (one NASA POWER ~50 km cell); the same labels apply to every field in that cell.")
    flags.append(f"Silhouette by k: {sil}. k=4 chosen for the app's four year types, not because it scored best."
                 if max(sil, key=sil.get) != 4 else f"Silhouette by k: {sil} (k=4 is best).")

    res = {
        "model": "year_patterns", "method": "k-means (k=4) on standardized yearly POWER features",
        "features": FEATURES, "years": [int(f.index.min()), int(f.index.max())], "nYears": len(f),
        "validation": {
            "leaveOneYearOutStability": round(stability, 3),
            "agreementWithPercentileRule": round(agree_rule, 3),
            "silhouetteByK": sil,
        },
        "clusterSizes": counts,
        "yearType": {int(y): t for y, t in full.items()},
        "yearTypeHeldOut": {int(y): t for y, t in loo_km.items()},
        "ruleYearType": {int(y): t for y, t in loo_rule.items()},
        "replayPresets": presets,
        "centroids": {names[i]: dict(zip(FEATURES, np.round(sc.inverse_transform(km.cluster_centers_)[i], 1).tolist()))
                      for i in range(K)},
        "flags": flags,
    }
    (OUT / "year_patterns.json").write_text(json.dumps(res, indent=1))
    print(json.dumps({k: res[k] for k in ("validation", "clusterSizes", "replayPresets", "centroids", "flags")}, indent=1))
    print("yearType:", res["yearType"])


if __name__ == "__main__":
    main()
