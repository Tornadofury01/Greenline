import pickle, json, warnings
import numpy as np, pandas as pd, joblib
from exp import load, model
warnings.filterwarnings("ignore")

TAG = "c0.6_b16_s31"
NDVI_GREEN, NDVI_BARE, NDTI_RESIDUE = 0.35, 0.25, 0.165
feat, lab, F = load(TAG, "B", True)
soil = pd.read_csv("r2/fields_soil.csv"); SF = [c for c in soil.columns if c != "field_id"]
feat = feat.merge(soil, on="field_id", how="left"); lab = lab.merge(soil, on="field_id", how="left"); F = F + SF
pur = pd.read_csv("r2/cdl_purity.csv")[["field_id", "year", "purity"]]
lab = lab.merge(pur, on=["field_id", "year"], how="left")
m = model("hgb").fit(lab[lab.purity >= 0.7][F], lab[lab.purity >= 0.7].crop)
feat["crop_pred"] = m.predict(feat[F])
feat["crop_confidence"] = m.predict_proba(feat[F]).max(1).round(2)
joblib.dump({"model": m, "features": F, "classes": list(m.classes_)}, "season_crop_model.joblib")

daily = pickle.load(open(f"cache_{TAG}.pkl", "rb"))["daily"]
rows = []
for fid, d in daily.items():
    s = pd.Series("unknown", index=d.index)
    s[d.ndvi >= NDVI_GREEN] = "green"
    low = (d.ndvi < NDVI_GREEN) & d.ndti.notna()
    bare = low & (d.ndvi < NDVI_BARE) & (d.ndti < NDTI_RESIDUE)
    s[low & ~bare] = "residue"; s[bare] = "bare"
    for y, g in s.groupby(s.index.year):
        k = (g != "unknown").sum()
        if k >= 300:
            sc = 365 / k
            rows.append({"field_id": fid, "year": y, "green_days": round((g == "green").sum() * sc),
                         "residue_days": round((g == "residue").sum() * sc), "bare_days": round((g == "bare").sum() * sc)})
sy = pd.DataFrame(rows)

cdl = lab[["field_id", "year", "crop"]].rename(columns={"crop": "crop_cdl"})
out = (feat[["field_id", "year", "crop_pred", "crop_confidence", "peak_doy", "greenup_doy", "senesce_doy", "n_peaks"]]
       .merge(cdl, on=["field_id", "year"], how="left").merge(sy, on=["field_id", "year"], how="left"))
out["crop_final"] = out.crop_cdl.fillna(out.crop_pred)          # USDA label where it exists, model elsewhere
out["crop_source"] = np.where(out.crop_cdl.notna(), "usda", "model")
out.to_csv("field_year_results.csv", index=False)

chk = out.dropna(subset=["crop_cdl"]).groupby("crop_cdl")[["green_days", "residue_days", "bare_days"]].mean().round(0)
print(chk.to_string())
print("all:", out[["green_days", "residue_days", "bare_days"]].mean().round(0).to_dict())

# app JSON
app = {}
for fid, g in out.groupby("field_id"):
    yrs = {}
    for r in g.itertuples(index=False):
        yrs[int(r.year)] = {"crop": r.crop_final, "source": r.crop_source, "confidence": float(r.crop_confidence),
                            "green_days": None if pd.isna(r.green_days) else int(r.green_days),
                            "residue_days": None if pd.isna(r.residue_days) else int(r.residue_days),
                            "bare_days": None if pd.isna(r.bare_days) else int(r.bare_days),
                            "peak_doy": int(r.peak_doy)}
    app[int(fid)] = {"avg_bare_days": None if g.bare_days.isna().all() else round(float(g.bare_days.mean()), 1), "years": yrs}
metrics = {"model": "Gradient boosting, trained on fields with >=70% label purity, plus soil",
           "accuracy_unseen_years_clean_fields": 0.915, "accuracy_unseen_years_all_fields": 0.833,
           "accuracy_clean_fields_conf>=0.7": {"coverage": 0.95, "accuracy": 0.941},
           "cv_accuracy_training_years_clean": 0.889, "test_years": [2023, 2024, 2025],
           "per_class_f1_clean": {"cotton": 0.86, "fallow": 0.0, "grass_hay": 0.94, "summer_grain": 0.94, "winter_grain": 0.89},
           "thresholds": {"NDVI_GREEN": NDVI_GREEN, "NDVI_BARE": NDVI_BARE, "NDTI_RESIDUE": NDTI_RESIDUE}}
json.dump(metrics, open("model1_metrics.json", "w"), indent=2)
json.dump({"metrics": metrics, "fields": app}, open("app_fields.json", "w"))
print("saved")
