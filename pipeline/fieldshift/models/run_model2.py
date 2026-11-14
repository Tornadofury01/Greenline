"""Model 2: field-month vegetation stress from weather/water conditions.
Target: field-month NDVI anomaly vs that field's normal for the calendar month.
Drivers: same-month + previous-month POWER weather and soil wetness, SMAP; previous-month MODIS ET/LST only
(same-month ET/LST partly *are* vegetation, so they'd leak). Test on held-out years 2023-2025."""
import pickle, json, sys, warnings
import numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, HistGradientBoostingClassifier
from sklearn.metrics import r2_score, mean_absolute_error, balanced_accuracy_score, roc_auc_score, accuracy_score
from sklearn.model_selection import GroupKFold, cross_val_predict
warnings.filterwarnings("ignore")
FINAL = "final" in sys.argv
BASE = "baseline" in sys.argv
FORECAST = "forecast" in sys.argv


# ---------- CAUSAL field greenness: raw clear observations only, no smoothing, no interpolation ----------
ts = pd.read_csv("ndvi_timeseries.csv.gz", parse_dates=["date"])
ts = ts[(ts.clear_frac >= 0.6) & (ts.snow_frac < 0.1) & ts.ndvi.between(-0.2, 1.0)].dropna(subset=["ndvi"])
dd = ts.groupby(["field_id", "date"]).ndvi.median().reset_index()
dd["month_start"] = dd.date.dt.to_period("M").dt.to_timestamp()
mo = dd.groupby(["field_id", "month_start"]).agg(ndvi=("ndvi", "mean"), n_obs=("ndvi", "size")).reset_index()
grid = []
for fid, g in mo.groupby("field_id"):
    idx = pd.date_range(g.month_start.min(), g.month_start.max(), freq="MS")
    grid.append(g.set_index("month_start").reindex(idx).rename_axis("month_start").reset_index().assign(field_id=fid))
y = pd.concat(grid)
y["n_obs"] = y.n_obs.fillna(0)
y["year"], y["month"] = y.month_start.dt.year, y.month_start.dt.month
# normal from EARLIER years only (observed months)
y = y.sort_values(["field_id", "month", "year"])
y["ndvi_normal"] = y.groupby(["field_id", "month"]).ndvi.transform(lambda s: s.shift(1).expanding(min_periods=5).mean())
y["anom"] = y.ndvi - y.ndvi_normal
y["field_month_std"] = y.groupby(["field_id", "month"]).anom.transform(lambda s: s.shift(1).expanding(min_periods=5).std())
y = y.sort_values(["field_id", "month_start"])
g = y.groupby("field_id")
y["anom_prev1"] = g.anom.shift(1); y["anom_prev2"] = g.anom.shift(2); y["anom_prev3"] = g.anom.shift(3)
y["anom_prev12"] = g.anom.shift(12)
y["anom_last"] = g.anom.transform(lambda s: s.shift(1).ffill())            # most recent observed anomaly before t
obs = y.anom.notna().astype(int)
y["months_since_obs"] = g.month_start.transform(lambda s: 0) + 0
last_seen = y.month_start.where(y.anom.notna()).groupby(y.field_id).transform(lambda s: s.shift(1).ffill())
y["months_since_obs"] = ((y.month_start - last_seen).dt.days / 30.4).round()
y["momentum"] = y.anom_prev1 - y.anom_prev2
y["n_obs_prev1"] = g.n_obs.shift(1)
nb = y.groupby("month_start").anom.mean().sort_index().shift(1).rename("nbr_prev1")
y = y.merge(nb, left_on="month_start", right_index=True, how="left")
y["gap_to_nbr_prev1"] = y.anom_last - y.nbr_prev1
# expected green-up timing: median of this field's EARLIER years
fy = pd.read_csv("field_year_results.csv")[["field_id", "year", "greenup_doy"]].sort_values(["field_id", "year"])
fy["exp_greenup_doy"] = fy.groupby("field_id").greenup_doy.transform(lambda s: s.shift(1).expanding(min_periods=3).median())
y = y.merge(fy[["field_id", "year", "exp_greenup_doy"]], on=["field_id", "year"], how="left")
y["days_from_exp_greenup"] = (y.month_start + pd.Timedelta(days=14)).dt.dayofyear - y.exp_greenup_doy
y = y[y.anom.notna()].copy()                                           # train/test only on months with real observations

crops = pd.read_csv("field_year_results.csv")[["field_id", "year", "crop_final"]]
y = y.merge(crops, on=["field_id", "year"], how="left")

def monthly(path, agg):
    d = pd.read_csv(path, parse_dates=["date"]).set_index("date").replace(-999, np.nan)
    return d.resample("MS").agg(agg)

pw = pd.read_csv("power_daily.csv", parse_dates=["date"]).set_index("date")
pw["heat35"] = (pw.T2M_MAX >= 35).astype(int)
w = pw.resample("MS").agg({"T2M": "mean", "T2M_MAX": "mean", "heat35": "sum", "PRECTOTCORR": "sum",
                          "RH2M": "mean", "ALLSKY_SFC_SW_DWN": "mean", "frost": "sum", "gdd_base10": "sum"})
w = w.join(monthly("power_soil_wetness.csv", "mean"))
w = w.join(monthly("smap_soil_moisture.csv", "mean"))
im = pd.read_csv("r2/imerg_daily_rain.csv", parse_dates=["date"]).set_index("date").replace(-999, np.nan)
im["heavy25"] = (im.rain_max_mm >= 25).astype(float)
w = w.join(im.resample("MS").agg({"rain_mm": "sum", "rain_max_mm": "max", "heavy25": "sum"}))
lag_only = monthly("modis_et.csv", "mean").join(monthly("modis_lst.csv", "mean"))
lag_only["et_ratio"] = lag_only.et_mm_8day / lag_only.pet_mm_8day
# anomalies vs calendar-month climate
clim = w.groupby(w.index.month).transform(lambda s: s.shift(1).expanding(min_periods=5).mean())  # earlier years only
wa = (w - clim).add_suffix("_anom")
W = w.join(wa)
W1 = W.shift(1).add_suffix("_prev1")
W2 = W[["PRECTOTCORR", "GWETROOT", "heat35"]].shift(2).add_suffix("_prev2")
L1 = lag_only.shift(1).add_suffix("_prev1")
X = W.join(W1).join(W2).join(L1)
X["rain_3mo"] = w.PRECTOTCORR.rolling(3).sum()
X.index.name = "month_start"
df = y.merge(X.reset_index(), on="month_start", how="left")
df = df[df.year >= 1985].copy()
df["crop_code"] = df.crop_final.astype("category").cat.codes
soil = pd.read_csv("r2/fields_soil.csv"); df = df.merge(soil, on="field_id", how="left")
FEAT = ["month", "crop_code", "ndvi_normal", "anom_prev1", "anom_prev2", "anom_prev3", "anom_prev12", "anom_last", "months_since_obs", "momentum", "n_obs_prev1", "field_month_std", "nbr_prev1", "gap_to_nbr_prev1", "exp_greenup_doy", "days_from_exp_greenup"]
if not BASE:
    FEAT += [c for c in X.columns if (not FORECAST) or c.endswith(("_prev1", "_prev2")) or c == "rain_3mo_prev"] + [c for c in soil.columns if c != "field_id"]
df = df.dropna(subset=["anom"]).copy()
thr = {Y: df.loc[df.year < Y, "anom"].quantile(0.2) for Y in sorted(df.year.unique())
       if df.loc[df.year < Y, "year"].nunique() >= 5}          # cut-off from earlier years only
df = df[df.year.isin(thr)].copy()
df["stress_cut"] = df.year.map(thr)
df["stressed"] = (df.anom <= df.stress_cut).astype(int)

test_years = [2023, 2024, 2025]
tr, te = df[~df.year.isin(test_years) & (df.year <= 2022)], df[df.year.isin(test_years)]
reg = HistGradientBoostingRegressor(max_iter=500, learning_rate=0.05, l2_regularization=1.0, random_state=0,
                                    categorical_features=[FEAT.index("crop_code"), FEAT.index("month")])
clf = HistGradientBoostingClassifier(max_iter=900, learning_rate=0.03, max_leaf_nodes=63, min_samples_leaf=60, l2_regularization=2.0, class_weight="balanced",
                                     random_state=0, categorical_features=[FEAT.index("crop_code"), FEAT.index("month")])
WT = (tr.n_obs.clip(upper=3) / 3).values
cvp = cross_val_predict(reg, tr[FEAT], tr.anom, groups=tr.year, cv=GroupKFold(5), params={"sample_weight": WT})
cvc = cross_val_predict(clf, tr[FEAT], tr.stressed, groups=tr.year, cv=GroupKFold(5), method="predict_proba", params={"sample_weight": WT})[:, 1]
out = {"n_train": len(tr), "cv_r2": round(r2_score(tr.anom, cvp), 3), "cv_mae": round(mean_absolute_error(tr.anom, cvp), 4),
       "cv_stress_auc": round(roc_auc_score(tr.stressed, cvc), 3),
       "cv_stress_bal_acc": round(balanced_accuracy_score(tr.stressed, cvc >= 0.5), 3),
       "cv_stress_acc": round(accuracy_score(tr.stressed, cvc >= 0.5), 3)}
THR = max(np.arange(0.2, 0.8, 0.02), key=lambda t: accuracy_score(tr.stressed, cvc >= t))   # chosen on training years only
out["threshold"] = round(float(THR), 2); out["cv_stress_acc_at_thr"] = round(accuracy_score(tr.stressed, cvc >= THR), 3)
out["cv_stress_bal_acc_at_thr"] = round(balanced_accuracy_score(tr.stressed, cvc >= THR), 3)
if FINAL:
    import joblib
    reg.fit(tr[FEAT], tr.anom, sample_weight=WT); clf.fit(tr[FEAT], tr.stressed, sample_weight=WT)
    pr, pc = reg.predict(te[FEAT]), clf.predict_proba(te[FEAT])[:, 1]
    out.update(n_test=len(te), test_r2=round(r2_score(te.anom, pr), 3), test_mae=round(mean_absolute_error(te.anom, pr), 4),
               test_stress_auc=round(roc_auc_score(te.stressed, pc), 3),
               test_stress_bal_acc=round(balanced_accuracy_score(te.stressed, pc >= THR), 3),
               test_stress_acc=round(accuracy_score(te.stressed, pc >= THR), 3))
    from sklearn.inspection import permutation_importance
    s = te.sample(min(4000, len(te)), random_state=0)
    imp = permutation_importance(clf, s[FEAT], s.stressed, n_repeats=3, random_state=0, scoring="roc_auc")
    out["top_drivers"] = pd.Series(imp.importances_mean, index=FEAT).sort_values(ascending=False).head(8).round(4).to_dict()
    # refit on all years for the app, save
    reg.fit(df[FEAT], df.anom); clf.fit(df[FEAT], df.stressed)
    joblib.dump({"regressor": reg, "stress_classifier": clf, "features": FEAT,
                 "crop_categories": list(df.crop_final.astype("category").cat.categories)}, "stress_model_causal.joblib")
    df["stress_prob"] = clf.predict_proba(df[FEAT])[:, 1].round(3)
    df[["field_id", "year", "month", "crop_final", "ndvi", "n_obs", "ndvi_normal", "anom", "stressed", "stress_prob"]].to_csv(
        "field_month_stress_causal.csv", index=False)
    json.dump(out, open("model2_metrics_causal.json", "w"), indent=2)
print(json.dumps(out))
