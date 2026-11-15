"""Model C (Field Shift v2): what kinds of growing seasons North Texas gets, and how often each comes in 2040.

Season = March-October, the 6-county study area (gridMET daily, averaged over the 1,711 fields).
Features (z-scored over 1985-2025): rain, heat days (>= 35 C), heavy-rain days (>= 25 mm), mean daily high,
water deficit (reference ET - rain), frost-free days (last spring frost -> first fall frost, from Jan-Dec).
Methods compared: k-means (k = 3..6), Gaussian mixture, Gaussian hidden Markov model over years (regimes that persist).
Unsupervised, so checked against things it never saw: US Drought Monitor (2000+), RMA drought/heat payouts,
NASS county yields, Model B area greenness.
2040: NEX-GDDP-CMIP6, 8 models x SSP2-4.5 / SSP5-8.5. Each model's change (2030-2050 vs its own 1985-2014) is applied
to every observed season's daily weather (delta method), then classified with the same k-means.

  python v2/models/modelC/train.py
Writes v2/models/modelC/: year_types.csv, model3.joblib, metrics.json, REPORT.md
"""
import glob, json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
EE = ROOT / "v2" / "data" / "ee"
DATA = ROOT / "v2" / "data"
FEATS = ["rain_mm", "heat_days", "heavy_rain_days", "tmax_mean", "deficit_mm", "frost_free_days"]
K = 4


def area_daily():
    """Area-mean daily gridMET series 1985-2025 (mean over fields of each day's value)."""
    cache = DATA / "modelC_area_daily.pkl"
    if cache.exists():
        return pd.read_pickle(cache)
    rows = []
    for f in sorted(glob.glob(str(EE / "gridmet_*.csv"))):
        d = pd.read_csv(f)
        mean = d.groupby(["year", "month"]).mean(numeric_only=True)
        for (y, m), r in mean.iterrows():
            for day in range(1, 32):
                try:
                    date = pd.Timestamp(int(y), int(m), day)
                except ValueError:
                    continue
                g = lambda b: r.get(f"d{day:02d}_{b}", np.nan)
                rows.append({"date": date, "pr": g("pr"), "tmax": g("tmmx") - 273.15, "tmin": g("tmmn") - 273.15, "eto": g("eto")})
    w = pd.DataFrame(rows).dropna(subset=["tmax"]).sort_values("date").reset_index(drop=True)
    w.to_pickle(cache)
    return w


def season_features(w):
    w = w.assign(year=w.date.dt.year, m=w.date.dt.month, doy=w.date.dt.dayofyear)
    s = w[w.m.between(3, 10)]
    g = s.groupby("year")
    out = pd.DataFrame({"rain_mm": g.pr.sum(), "heat_days": g.tmax.apply(lambda v: (v >= 35).sum()),
                        "heavy_rain_days": g.pr.apply(lambda v: (v >= 25).sum()), "tmax_mean": g.tmax.mean(),
                        "deficit_mm": g.eto.sum() - g.pr.sum()})
    fr = w[w.tmin <= 0]
    last = fr[fr.m <= 6].groupby("year").doy.max()
    first = fr[fr.m >= 7].groupby("year").doy.min()
    out["frost_free_days"] = (first.reindex(out.index).fillna(366) - last.reindex(out.index).fillna(0))
    return out[(out.index >= 1985) & (out.index <= 2025)]


def name_clusters(centers):
    """Centroids (z units) -> drought / wet / hot / normal, using rain, deficit and heat."""
    c = pd.DataFrame(centers, columns=FEATS)
    names = {}
    names[int((c.deficit_mm - c.rain_mm).idxmax())] = "drought"
    rest = [i for i in c.index if i not in names]
    names[int(c.loc[rest].rain_mm.idxmax())] = "wet"
    rest = [i for i in rest if i not in names]
    names[int(c.loc[rest].heat_days.idxmax())] = "hot"
    for i in c.index:
        names.setdefault(int(i), "normal" if "normal" not in names.values() else f"type{i}")
    return names


def checks(yt):
    out = {}
    usdm = pd.read_csv(DATA / "usdm_county_weekly.csv")
    usdm["date"] = pd.to_datetime(usdm.MapDate.astype(str), format="%Y%m%d", errors="coerce")
    usdm = usdm[usdm.date.dt.month.between(3, 10)]
    usdm["d2plus"] = usdm[["D2"]].astype(float).sum(axis=1) if "D2" in usdm else np.nan
    d2 = usdm.groupby(usdm.date.dt.year).d2plus.mean()
    rma = pd.read_csv(DATA / "rma_county_year_cause.csv")
    pay = rma[rma.cause_desc.str.contains("DROUGHT|HEAT|HOT WIND")].groupby("commodity_year").indemnity.sum() / 1e6
    import sys
    sys.path.insert(0, str(HERE.parent))
    from nass_yields import county_yields
    y = county_yields()
    dev = []
    for (c, f), g in y.groupby(["commodity_desc", "cfips"]):
        if len(g) >= 8:
            tr = np.polyval(np.polyfit(g.year, g.value_num, 1), g.year)
            dev.append(g.assign(dev=100 * (g.value_num / tr - 1)))
    dev = pd.concat(dev).groupby(["commodity_desc", "year"]).dev.mean().unstack(0)
    mb = pd.read_pickle(DATA / "modelB" / "monthly.pkl")
    green = mb[(mb.growing == 1) & mb.month.between(3, 10)].groupby("year").z.mean()
    t = yt.set_index("year").join(d2.rename("usdm_d2plus_pct")).join(pay.rename("rma_drought_heat_musd")).join(green.rename("area_greenness_z"))
    for c in ("WHEAT", "CORN", "SORGHUM", "COTTON"):
        if c in dev:
            t = t.join(dev[c].rename(f"yield_dev_{c.lower()}_pct"))
    cols = [c for c in t.columns if c.startswith(("usdm", "rma", "area", "yield"))]
    out["byType"] = t.groupby("year_type")[cols].mean().round(2).to_dict(orient="index")
    out["nYearsByType"] = t.year_type.value_counts().to_dict()
    return out, t


def cmip6_2040(w, scaler, km, names, feats_obs):
    files = sorted(glob.glob(str(EE / "cmip6_*.csv")))
    cm = pd.concat([pd.read_csv(f) for f in files], ignore_index=True)
    cm["date"] = pd.to_datetime(cm.date)
    cm = cm[cm.date.dt.month.between(3, 10)]
    g = cm.groupby(["model", "scenario", cm.date.dt.year]).agg(pr=("pr", "mean"), tmax=("tasmax", "mean"), tmin=("tasmin", "mean"))
    g = g.reset_index().rename(columns={"date": "year"})
    res, freq = {}, {}
    for model in g.model.unique():
        h = g[(g.model == model) & (g.scenario == "historical")]
        for sc in ("ssp245", "ssp585"):
            f = g[(g.model == model) & (g.scenario == sc)]
            if not len(h) or not len(f):
                continue
            ratio = f.pr.mean() / h.pr.mean()
            dtx = f.tmax.mean() - h.tmax.mean()
            dtn = f.tmin.mean() - h.tmin.mean()
            ws = w.copy()
            ws["pr"] *= ratio
            ws["tmax"] += dtx
            ws["tmin"] += dtn
            ws["eto"] *= 1 + 0.03 * dtx                 # ~3 % more reference ET per degree of warming (FAO-56 sensitivity)
            fs = season_features(ws)
            lab = pd.Series(km.predict(scaler.transform(fs[FEATS]))).map(names)
            freq[(model, sc)] = lab.value_counts(normalize=True).to_dict()
            res[(model, sc)] = {"rainChangePct": round(100 * (ratio - 1), 1), "tmaxChangeC": round(dtx, 2), "tminChangeC": round(dtn, 2)}
    obs = pd.Series(km.labels_).map(names).value_counts(normalize=True).to_dict()
    summary = {"observed1985_2025": {k: round(v, 3) for k, v in obs.items()}}
    for sc in ("ssp245", "ssp585"):
        rows = pd.DataFrame([v for (m, s), v in freq.items() if s == sc]).fillna(0)
        summary[sc] = {"meanShare": rows.mean().round(3).to_dict(), "minShare": rows.min().round(3).to_dict(),
                       "maxShare": rows.max().round(3).to_dict(), "nModels": int(len(rows)),
                       "modelsWithMoreDroughtThanToday": int((rows.get("drought", 0) > obs.get("drought", 0)).sum()),
                       "climateChange": {m: res[(m, sc)] for (m, s) in res if s == sc}}
    return summary


def main():
    w = area_daily()
    f = season_features(w)
    scaler = StandardScaler().fit(f[FEATS])
    X = scaler.transform(f[FEATS])
    sil = {k: round(float(silhouette_score(X, KMeans(k, n_init=50, random_state=0).fit_predict(X))), 3) for k in range(3, 7)}
    km = KMeans(K, n_init=100, random_state=0).fit(X)
    names = name_clusters(km.cluster_centers_)
    gmm = GaussianMixture(K, covariance_type="diag", n_init=20, random_state=0).fit(X)
    from hmmlearn.hmm import GaussianHMM
    hmm = GaussianHMM(K, covariance_type="diag", n_iter=500, random_state=0).fit(X)
    hl = hmm.predict(X)
    res = {"silhouetteByK": sil, "k": K,
           "agreement": {"kmeans_vs_gmm_ARI": round(adjusted_rand_score(km.labels_, gmm.predict(X)), 3),
                         "kmeans_vs_hmm_ARI": round(adjusted_rand_score(km.labels_, hl), 3)},
           "hmmStayProbability": [round(float(p), 2) for p in np.diag(hmm.transmat_)],
           "centersZ": {names[i]: dict(zip(FEATS, np.round(c, 2))) for i, c in enumerate(km.cluster_centers_)},
           "centersRaw": {names[i]: dict(zip(FEATS, np.round(scaler.inverse_transform(c[None])[0], 1))) for i, c in enumerate(km.cluster_centers_)}}
    dist = km.transform(X)
    p = np.exp(-dist ** 2) / np.exp(-dist ** 2).sum(1, keepdims=True)
    yt = f.reset_index().rename(columns={"index": "year"})
    yt["year_type"] = pd.Series(km.labels_).map(names).values
    yt["p_type"] = p.max(1).round(2)
    for i in range(K):
        yt[f"p_{names[i]}"] = p[:, i].round(2)
    yt["gmm_type"] = pd.Series(gmm.predict(X)).map(lambda i: i).values
    yt["hmm_state"] = hl
    res["years"] = {n: sorted(int(v) for v in yt.year[yt.year_type == n]) for n in names.values()}
    print("silhouette by k:", sil, "| k-means vs GMM ARI", res["agreement"]["kmeans_vs_gmm_ARI"], "| vs HMM", res["agreement"]["kmeans_vs_hmm_ARI"])
    for n, ys in res["years"].items():
        print(f"  {n:<8} {len(ys):>2} years: {ys}")
    chk, table = checks(yt)
    res["checks"] = chk
    print("checks by year type:")
    print(pd.DataFrame(chk["byType"]).T.round(1).to_string())
    res["2040"] = cmip6_2040(w, scaler, km, names, f)
    for sc in ("ssp245", "ssp585"):
        print(f"2040 {sc}: mean share {res['2040'][sc]['meanShare']} | models with more drought than today: "
              f"{res['2040'][sc]['modelsWithMoreDroughtThanToday']} of {res['2040'][sc]['nModels']}")
    print("observed 1985-2025:", res["2040"]["observed1985_2025"])
    table.reset_index().to_csv(HERE / "year_types.csv", index=False)
    joblib.dump({"kmeans": km, "scaler": scaler, "names": names, "features": FEATS, "gmm": gmm, "hmm": hmm}, HERE / "model3.joblib")
    (HERE / "metrics.json").write_text(json.dumps(res, indent=1, default=str))
    print("wrote year_types.csv, model3.joblib, metrics.json")


if __name__ == "__main__":
    main()
