"""Model 3: year pattern finder. Clusters growing seasons (Mar-Oct) 1985-2025 by climate, compares k-means, EM (Gaussian mixture), e-means."""
import json, warnings, numpy as np, pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from sklearn.mixture import GaussianMixture
from sklearn.metrics import silhouette_score, adjusted_rand_score
try:
    from faiss.contrib.e_means import NumpyEmeans   # optional: pip install faiss-cpu>=1.16
except ImportError:
    NumpyEmeans = None
warnings.filterwarnings("ignore")
K = 4

pw = pd.read_csv("power_daily.csv", parse_dates=["date"]).set_index("date")
sw = pd.read_csv("power_soil_wetness.csv", parse_dates=["date"]).set_index("date")
d = pw.join(sw)
d = d[(d.index.month >= 3) & (d.index.month <= 10) & (d.index.year <= 2025)]
def dry_spell(r):
    run = best = 0
    for v in r:
        run = run + 1 if v < 1 else 0; best = max(best, run)
    return best
yr = d.groupby(d.index.year).agg(rain_mm=("PRECTOTCORR", "sum"), heat_days_35c=("T2M_MAX", lambda x: (x >= 35).sum()),
                                 tmax_mean=("T2M_MAX", "mean"), root_wetness=("GWETROOT", "mean"),
                                 heavy_rain_days=("PRECTOTCORR", lambda x: (x >= 25).sum()),
                                 longest_dry_spell=("PRECTOTCORR", dry_spell))
COLS = list(yr.columns)
X = StandardScaler().fit_transform(yr.values)

km = KMeans(K, n_init=50, random_state=0).fit(X)
gm = GaussianMixture(K, covariance_type="diag", n_init=20, random_state=0).fit(X)
labs = {"kmeans": km.labels_, "em_gmm": gm.predict(X)}
if NumpyEmeans is not None:   # e-means is only a comparison; labels come from k-means
    em = NumpyEmeans(X.shape[1], K, nepochs=25, seed=0)
    cent, _ = em.train(np.ascontiguousarray(X, dtype="float32"))
    labs["e_means"] = np.argmin(((X[:, None, :] - np.asarray(cent)[None]) ** 2).sum(-1), axis=1)
res = {m: {"silhouette": round(float(silhouette_score(X, l)), 3)} for m, l in labs.items()}
res["agreement_ARI"] = {f"kmeans_vs_{'em' if m == 'em_gmm' else m}": round(adjusted_rand_score(labs["kmeans"], l), 2)
                        for m, l in labs.items() if m != "kmeans"}

# name clusters: k-means labels (best silhouette); EM fitted from k-means centres gives aligned probabilities
yr["cluster"] = labs["kmeans"]
z = pd.DataFrame(X, index=yr.index, columns=COLS).groupby(yr.cluster).mean()
sev = (z.heat_days_35c + z.tmax_mean + z.longest_dry_spell - z.rain_mm - z.root_wetness)
order = sev.sort_values().index.tolist()          # wettest ... harshest
names = {order[0]: "wet", order[-1]: "drought"}
mid = order[1:-1]
hot = max(mid, key=lambda c: z.loc[c, "heat_days_35c"] + z.loc[c, "tmax_mean"])
names[hot] = "hot"; names[[c for c in mid if c != hot][0]] = "normal"
yr["year_type"] = yr.cluster.map(names)
gm2 = GaussianMixture(K, covariance_type="diag", means_init=km.cluster_centers_, random_state=0).fit(X)
P = gm2.predict_proba(X)
for c in range(K):
    yr[f"p_{names[c]}"] = P[:, c].round(2)

# validation: crop greenness in each year type (Model 2 field-month anomalies, Apr-Sep)
st = pd.read_csv("field_month_stress_causal.csv")   # Model 2, leak-free version
g = st[st.month.between(4, 9)].groupby("year").anom.mean()
yr["field_ndvi_anom"] = g.reindex(yr.index).round(3)
summary = yr.groupby("year_type").agg(years=("rain_mm", "size"), rain_mm=("rain_mm", "mean"), heat_days=("heat_days_35c", "mean"),
                                      root_wetness=("root_wetness", "mean"), field_ndvi_anom=("field_ndvi_anom", "mean")).round(2)
yr.round(3).to_csv("year_types.csv")
res["year_type_summary"] = summary.to_dict(orient="index")
res["notable"] = {str(y): yr.loc[y, "year_type"] for y in [1998, 2006, 2011, 2015, 2018, 2022, 2023] if y in yr.index}
json.dump(res, open("model3_metrics.json", "w"), indent=2, default=str)
print(json.dumps(res, default=str))
