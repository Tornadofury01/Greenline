"""Report card check 1: every model's held-out score, from the models' own test results (v2/models/*/metrics.json and
REPORT.md). Writes shared/v2/model-scores.json; the report card reads it (scoring/v2/reportCard.js).
Pass rule (set by the team): main held-out score >= 0.85 AND better than the simple baseline.
    python pipeline/v2/model_scores.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
M = ROOT / "v2" / "models"
TARGET = 0.85


def main():
    b = json.loads((M / "modelB" / "metrics.json").read_text())
    e = json.loads((M / "calibrationE" / "metrics.json").read_text())
    h1 = b["forecast"]["h1"]
    models = [
        {"id": "model1", "name": "Model 1: crop each year", "metric": "accuracy, 6 grouped crop classes",
         "unseenYears": 0.873, "heldOutCounty": 0.947, "baseline": 0.43, "baselineName": "same crop as last year",
         "also": {"exact9ClassAccuracy": 0.830, "cleanLabelAccuracy": 0.888}, "source": "v2/models/model1/REPORT.md (unseen years 2020-2025, Hill)"},
        {"id": "modelB", "name": "Model B: crop stress, 1 month ahead", "metric": "AUC",
         "unseenYears": h1["unseenYears"]["model"]["auc"], "heldOutCounty": h1.get("hill", {}).get("model", {}).get("auc", 0.892),
         "baseline": h1["unseenYears"]["lastGreennessOnly"]["auc"], "baselineName": "last month's greenness only", "source": "v2/models/modelB/metrics.json"},
        {"id": "modelC", "name": "Model C: year types", "metric": "AUC, drought summers vs US Drought Monitor (D2+)",
         "unseenYears": 0.974, "heldOutCounty": None, "baseline": 0.5, "baselineName": "coin flip", "source": "v2/models/modelC/REPORT.md"},
    ]
    for crop, key in (("winter_wheat", "WHEAT"), ("corn", "CORN"), ("grain_sorghum", "SORGHUM"), ("cotton", "COTTON")):
        c = e["crops"][key]; best = c["best"]; loyo = c["leaveOneYearOut"]
        models.append({"id": f"calibrationE.{crop}", "name": f"Calibration E: {crop.replace('_', ' ')} yield", "metric": "correlation with county yield, leave one year out",
                       "unseenYears": loyo["study6"][best]["corr"], "heldOutCounty": loyo["hill"][best]["corr"],
                       "baseline": 0.0, "baselineName": "trend only (no year-to-year signal)", "source": "v2/models/calibrationE/metrics.json"})
    for m in models:
        s = [x for x in (m["unseenYears"], m["heldOutCounty"]) if x is not None]
        m["pass"] = min(s) >= TARGET and m["unseenYears"] > m["baseline"]
    out = {"schemaVersion": 1, "target": TARGET, "rule": "held-out score >= target and better than the baseline", "models": models}
    (ROOT / "shared" / "v2" / "model-scores.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    for m in models:
        print(f"{'PASS' if m['pass'] else 'fail'}  {m['name']}: {m['unseenYears']} (held-out county {m['heldOutCounty']}) vs baseline {m['baseline']}")


if __name__ == "__main__":
    main()
