"""Field Shift study -> one small JSON file for the app: shared/fieldshift/ellis-study.json.

Reads (run the models and the replay first, see README.md):
  models/model1_metrics.json, models/model2_metrics_causal.json, models/model3_metrics.json, models/year_types.csv
  replay/outputs/recommendation.json
Writes only numbers, keys and grades. All words the app shows live in content/i18n (fieldShift.*).

Run from the repo root:  python pipeline/fieldshift/export_app.py
"""
import csv, json, os
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "shared", "fieldshift", "ellis-study.json")
load = lambda *p: json.load(open(os.path.join(HERE, *p), encoding="utf-8"))

m1 = load("models", "model1_metrics.json")
m2 = load("models", "model2_metrics_causal.json")
m3 = load("models", "model3_metrics.json")
rec = load("replay", "outputs", "recommendation.json")
with open(os.path.join(HERE, "models", "year_types.csv"), encoding="utf-8") as f:
    years = [{"year": int(r["date"]), "type": r["year_type"],
              "p": round(max(float(r[f"p_{t}"]) for t in ("hot", "wet", "normal", "drought")), 2)}
             for r in csv.DictReader(f)]

METRICS = ["bare_days", "soil_loss_t_ha", "return_above_var_typical", "return_above_var_worst10",
           "return_above_var_drought", "loss_years_pct", "fertilizer_n_lb", "n_credit_lb", "eqip_per_year", "pest_index"]


def card(c):
    return {"key": c["key"], "overall": c["overall"], "grade": c["grade"], "rank": c["rank"],
            "winsShare": c["wins_share"],
            "dims": {k: {"score": d["score"], "grade": d["grade"]} for k, d in c["dimensions"].items()},
            "metrics": {k: c["metrics"][k] for k in METRICS}}


def preset(r):
    return {"weights": r["weights"], "current": card(r["current"]), "recommended": card(r["recommended"]),
            "runnerUp": r["runner_up"]["key"], "keepCurrent": r["keep_current"],
            "confidence": r["confidence"], "closeCall": r["close_call"],
            "scenarios": r["robustness"]["scenarios_checked"], "gapPoints": r["robustness"]["gap_points"],
            "ranking": [{"key": x["key"], "overall": x["overall"], "grade": x["grade"],
                         "avg": x["score_across_scenarios"]} for x in r["ranking"]]}


out = {
    "schemaVersion": 1,
    "generated": date.today().isoformat(),
    "study": "fieldShift",
    "area": {"county": "Ellis", "state": "TX", "lat": 32.25, "lon": -96.75, "nFields": 300},
    "models": {
        "seasonCrop": {"approach": "gradientBoosting", "trainOn": "cleanLabelFields", "purityMin": 0.7,
                       "testYears": m1["test_years"],
                       "accCleanFields": m1["accuracy_unseen_years_clean_fields"],
                       "accAllFields": m1["accuracy_unseen_years_all_fields"],
                       "cvAccClean": m1["cv_accuracy_training_years_clean"],
                       "f1": m1["per_class_f1_clean"]},
        "vegStress": {"approach": "gradientBoosting", "leakFree": True, "testYears": [2023, 2025],
                      "testAuc": m2["test_stress_auc"], "testAcc": m2["test_stress_acc"],
                      "testBalAcc": m2["test_stress_bal_acc"], "testR2": m2["test_r2"],
                      "cvAuc": m2["cv_stress_auc"], "cvAcc": m2["cv_stress_acc"], "cvR2": m2["cv_r2"]},
        "yearPatterns": {"approach": "kmeans", "k": 4, "silhouette": m3["kmeans"]["silhouette"],
                         "silhouetteEm": m3["em_gmm"]["silhouette"],
                         "ariKmeansVsEm": m3["agreement_ARI"]["kmeans_vs_em"],
                         "groups": {k: v["years"] for k, v in m3["year_type_summary"].items()},
                         "droughtNdviAnom": m3["year_type_summary"].get("drought", {}).get("field_ndvi_anom")},
    },
    "yearTypes": years,
    "recommender": {
        "anchors": rec["how_scored"]["anchors"],
        "presets": {k: preset(v) for k, v in rec["recommendations"].items()},
    },
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, separators=(",", ":"))
print(f"wrote {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) / 1024:.1f} kB), "
      f"balanced pick: {out['recommender']['presets']['balanced']['recommended']['key']}")
