"""Export SI model results as one small JSON per field to /shared/si/, plus /shared/si/index.json.
Format: /shared/data-format.md, section "SI results (/shared/si/)".

Run after the three models:  pipeline/.venv/Scripts/python pipeline/models/export_si.py
"""
import json
import math
from datetime import date

import pandas as pd

from common import FIELDS, RESULTS

SHARED = RESULTS.parent.parent.parent / "shared" / "si"
SCHEMA = 1


def clean(v):
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def model_summary(sc, vs, yp):
    best1 = sc["scores"][sc["chosen"]]
    best2 = vs["scores"][vs["chosen"]]
    return {
        "seasonCrop": {"approach": sc["chosen"], "validation": "leave-one-year-out",
                       "heldOutAccuracy": best1["accuracy"], "heldOutBalancedAccuracy": best1["balancedAccuracy"],
                       "baselineAccuracy": sc["scores"]["baselineSameAsLastYear"]["accuracy"],
                       "years": sc["years"], "nFieldYears": sc["nFieldYears"]},
        "vegStress": {"approach": vs["chosen"], "presentAs": "weatherRiskSignal", "confidence": "low",
                      "showSignalFor": vs["showSignalFor"], "perCrop": vs["perCrop"], "validation": "leave-one-year-out",
                      "heldOutR2": best2["r2"], "heldOutBelowNormalBalancedAccuracy": best2["belowNormalBalancedAccuracy"],
                      "years": vs["years"]},
        "yearPatterns": {"approach": "kmeans", "validation": "leave-one-year-out",
                         "heldOutStability": yp["validation"]["leaveOneYearOutStability"], "years": yp["years"]},
    }


def driver(d, kind):
    """Driver as an i18n key + params (app) and English text (docs/debug)."""
    if not isinstance(d, dict) or not d.get("feature"):
        return None
    out = {"key": f"si.driver.{d['feature']}", "params": {}, "text": d.get("text")}
    if kind == "crop":
        p = d["feature"].split("_")
        if len(p) == 2 and p[1].isdigit():
            out = {"key": f"si.driver.{p[0]}Month", "params": {"month": int(p[1])}, "text": d.get("text")}
    else:
        out["params"] = {"month": d["month"], "direction": "low" if d["value"] < d.get("typical", 0) else "high"}
    return out


def main():
    SHARED.mkdir(parents=True, exist_ok=True)
    sc = json.loads((RESULTS / "season_crop.json").read_text())
    vs = json.loads((RESULTS / "veg_stress.json").read_text())
    yp = json.loads((RESULTS / "year_patterns.json").read_text())
    fy1 = pd.read_json(RESULTS / "season_crop_fieldyears.json")
    fy2 = pd.read_json(RESULTS / "veg_stress_fieldyears.json")
    fields = pd.read_csv(FIELDS / "fields.csv")
    summary = model_summary(sc, vs, yp)
    year_type = {int(k): v for k, v in yp["yearType"].items()}
    s2 = {(r.fieldId, r.year): r for r in fy2.itertuples()}
    index = []
    for f in fields.itertuples():
        g = fy1[fy1.fieldId == f.fieldId].sort_values("year")
        years = []
        for r in g.itertuples():
            st = s2.get((f.fieldId, r.year))
            years.append({k: clean(v) for k, v in {
                "year": int(r.year), "cdlClass": r.cdlClass, "predictedClass": r.predictedClass, "correct": None if clean(r.correct) is None else bool(r.correct),
                "doubleCropCdl": bool(r.doubleCropCdl), "doubleCropConfidence": r.doubleCropConfidence, "fallow": bool(r.fallow), "months": list(r.months),
                "greenDays": int(r.greenDays), "residueDays": int(r.residueDays), "bareDays": int(r.bareDays),
                "bareDaysScore": int(r.bareDaysScore), "filledMonths": int(r.filledMonths),
                "greenUpDoy": clean(getattr(r, "greenUpDoy", None)), "senescenceDoy": clean(getattr(r, "senescenceDoy", None)),
                "cropDriver": driver(r.topDriver, "crop"),
                "yearType": year_type.get(int(r.year)),
                "stressMonths": list(st.stressMonths) if st is not None else None,
                "predictedStressMonths": list(st.predictedStressMonths) if st is not None else None,
                "stressDriver": driver(st.topDriver, "stress") if st is not None else None,
            }.items()})
        out = {"schemaVersion": SCHEMA, "fieldId": f.fieldId, "county": f.county, "state": f.state,
               "lat": f.lat, "lon": f.lon, "generated": date.today().isoformat(),
               "models": summary, "years": years,
               "yearTypes": [{"year": int(y), "yearType": t} for y, t in sorted(year_type.items())],
               "replayPresets": yp["replayPresets"]}
        (SHARED / f"{f.fieldId}.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
        index.append({"fieldId": f.fieldId, "county": f.county, "state": f.state, "lat": f.lat, "lon": f.lon, "nYears": len(years)})
    (SHARED / "index.json").write_text(json.dumps({"schemaVersion": SCHEMA, "models": summary, "fields": index}, indent=1))
    print(f"wrote {len(index)} field files to shared/si/")


if __name__ == "__main__":
    main()
