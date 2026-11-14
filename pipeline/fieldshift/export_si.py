"""Field Shift models -> one SI file per app field: /shared/si/ec-NNN.json + /shared/si/index.json.
Format: /shared/data-format.md, "SI results (/shared/si/)" (schema 2: Field Shift models).

  Model 1 (season and crop): models/field_year_results.csv (labels from the model refit on all years),
           models/model1_heldout.json (evaluate_m1.py: trained before 2023, scored once on 2023-2025)
  Model 2 (vegetation stress, leak-free): models/field_month_stress_causal.csv, models/model2_metrics_causal.json
  Model 3 (year types): models/year_types.csv, models/model3_metrics.json

Run from the repo root after build_app_inputs.py:  python pipeline/fieldshift/export_si.py
"""
import json, math
from datetime import date
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
M = HERE / "models"
OUT = ROOT / "shared" / "si"
SCHEMA = 2
STRESS_THRESHOLD = 0.7          # model2_metrics_causal.json "threshold": stress_prob at or above this = flagged
YEARTYPE_APP = {"hot": "heat"}  # Model 3 says "hot"; the app's year-type key is "heat"
fid = lambda i: f"ec-{int(i):03d}"
clean = lambda v: None if v is None or (isinstance(v, float) and math.isnan(v)) else v


def main():
    m1 = json.loads((M / "model1_metrics.json").read_text())
    ho = json.loads((M / "model1_heldout.json").read_text())
    m2 = json.loads((M / "model2_metrics_causal.json").read_text())
    m3 = json.loads((M / "model3_metrics.json").read_text())
    fy = pd.read_csv(M / "field_year_results.csv")
    st = pd.read_csv(M / "field_month_stress_causal.csv")
    yt = pd.read_csv(M / "year_types.csv").rename(columns={"date": "year"})
    yt["yearType"] = yt.year_type.replace(YEARTYPE_APP)
    fields = pd.read_csv(ROOT / "pipeline" / "data" / "fields" / "fields.csv")

    held = {(f, y): (c, p) for f, y, c, p in ho["predictions"]}
    classes = sorted(ho["allFields"]["perClass"])
    summary = {
        "seasonCrop": {"approach": "gradientBoosting", "validation": "unseenYears", "years": ho["testYears"][::len(ho["testYears"]) - 1],
                       "heldOutAccuracy": ho["allFields"]["accuracy"], "heldOutBalancedAccuracy": ho["allFields"]["balancedAccuracy"],
                       "heldOutAccuracyClean": ho["cleanFields"]["accuracy"], "baselineAccuracy": ho["allFields"]["baselineSameAsLastYear"],
                       "nFieldYears": ho["allFields"]["n"], "trainPurityMin": ho["minPurity"], "classes": classes,
                       "perClass": ho["allFields"]["perClass"]},
        "vegStress": {"approach": "gradientBoosting_leakFree", "presentAs": "stressModel", "validation": "unseenYears",
                      "years": [2023, 2025], "heldOutAuc": m2["test_stress_auc"], "heldOutAccuracy": m2["test_stress_acc"],
                      "heldOutBalancedAccuracy": m2["test_stress_bal_acc"], "heldOutR2": m2["test_r2"],
                      "cvAuc": m2["cv_stress_auc"], "baselineCvAuc": 0.857, "threshold": STRESS_THRESHOLD,
                      "showSignalFor": [c for c in classes if c != "fallow"]},
        "yearPatterns": {"approach": "kmeans", "k": 4, "silhouette": m3["kmeans"]["silhouette"],
                         "agreementWithEm": m3["agreement_ARI"]["kmeans_vs_em"],
                         "years": [int(yt.year.min()), int(yt.year.max())],
                         "groups": {YEARTYPE_APP.get(k, k): v["years"] for k, v in m3["year_type_summary"].items()}},
    }

    # Replay presets: every drought year, plus the two most extreme hot and wet seasons (Model 3 labels).
    z = (yt[["rain_mm", "heat_days_35c"]] - yt[["rain_mm", "heat_days_35c"]].mean()) / yt[["rain_mm", "heat_days_35c"]].std()
    yt["severityZ"] = 0.0
    yt.loc[yt.yearType == "drought", "severityZ"] = (z.heat_days_35c - z.rain_mm)[yt.yearType == "drought"]
    yt.loc[yt.yearType == "heat", "severityZ"] = z.heat_days_35c[yt.yearType == "heat"]
    yt.loc[yt.yearType == "wet", "severityZ"] = z.rain_mm[yt.yearType == "wet"]
    presets = []
    for t, n in (("drought", 9), ("wet", 2), ("heat", 2)):
        g = yt[yt.yearType == t].sort_values("severityZ", ascending=False).head(n)
        presets += [{"year": int(r.year), "yearType": t, "severityZ": round(float(r.severityZ), 2)} for r in g.itertuples()]
    year_types = [{"year": int(r.year), "yearType": r.yearType, "p": round(float(getattr(r, f"p_{r.year_type}")), 2)}
                  for r in yt.itertuples()]
    ytype = {y["year"]: y["yearType"] for y in year_types}

    st["sid"] = st.field_id.map(fid)
    stress = {k: g for k, g in st.groupby(["sid", "year"])}
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    index = []
    for f in fields.itertuples():
        i = int(f.fieldId[3:])
        g = fy[(fy.field_id == i) & (fy.year <= 2025)].sort_values("year")
        years = []
        for r in g.itertuples():
            y = int(r.year)
            h = held.get((i, y))
            s = stress.get((f.fieldId, y))
            years.append({k: clean(v) for k, v in {
                "year": y,
                "cdlClass": clean(r.crop_cdl),                 # USDA label in the model's 5 classes (2008+), else null
                "predictedClass": r.crop_pred,                 # model label (refit on all years)
                "confidence": float(r.crop_confidence),
                "cropFinal": r.crop_final, "cropSource": r.crop_source,
                # right / wrong only where the model never saw the year (2023-2025, evaluate_m1.py); null elsewhere
                "heldOutPredicted": h[1] if h else None,
                "correct": (h[0] == h[1]) if h else None,
                "greenDays": clean(r.green_days), "residueDays": clean(r.residue_days), "bareDays": clean(r.bare_days),
                "greenUpDoy": clean(r.greenup_doy), "senescenceDoy": clean(r.senesce_doy), "peakDoy": clean(r.peak_doy),
                "cropDriver": None,
                "yearType": ytype.get(y),
                "stressMonths": sorted(int(m) for m in s[s.stressed == 1].month) if s is not None else None,
                "predictedStressMonths": sorted(int(m) for m in s[s.stress_prob >= STRESS_THRESHOLD].month) if s is not None else None,
                "stressDriver": None,
            }.items()})
        out = {"schemaVersion": SCHEMA, "fieldId": f.fieldId, "county": f.county, "state": f.state,
               "lat": f.lat, "lon": f.lon, "generated": date.today().isoformat(),
               "models": summary, "years": years, "yearTypes": year_types, "replayPresets": presets}
        (OUT / f"{f.fieldId}.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
        index.append({"fieldId": f.fieldId, "county": f.county, "state": f.state, "lat": f.lat, "lon": f.lon, "nYears": len(years)})
    (OUT / "index.json").write_text(json.dumps({"schemaVersion": SCHEMA, "models": summary, "fields": index}, indent=1))
    print(f"wrote {len(index)} SI files to shared/si/; presets:", [(p['year'], p['yearType']) for p in presets])


if __name__ == "__main__":
    main()
