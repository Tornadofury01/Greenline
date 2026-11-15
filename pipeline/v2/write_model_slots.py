"""Field Shift v2: turn the trained models' outputs into one slot file per field, shared/v2/models/<fid>.json
(format: docs/v2-data-contract.md section 1; checked by scoring/modelSlots.js). Rerun after any model changes.

    python pipeline/v2/write_model_slots.py                         # every field in shared/v2/input-index.json
    python pipeline/v2/write_model_slots.py --counties 48139
    python pipeline/v2/write_model_slots.py --models ../Greenline-v2/v2/models

What each slot is built from (sections left out stay PLACEHOLDERS, tagged in the app):
  modelA        Model 1 v2 (`model1/predictions_v2.csv.gz`): crop per year 1985-2025, USDA label where clean, model
                otherwise. cropDates are the placeholder calendars (Model 1 does not estimate planting dates).
  modelC        Model C (`modelC/year_types.csv`): the field's county, summer-season type per year; 2040 shares =
                the 8-model mean for the summer season (`modelC/metrics.json` -> 2040). Types are hard rule cut-offs,
                so probability = 1.
  calibrationE  Calibration E (`calibrationE/predictions.csv`): the county's trend yield in its latest NASS year for
                wheat, corn, sorghum, cotton; every other crop keeps its placeholder yield.
  modelB        not written: Model B gives greenness response per SPEI / hot day, not the yield factors the engine
                needs (droughtKy, heatLossPerDay). Mapping one to the other is a modelling decision.
  modelD        not written: Model D gives volumetric soil moisture; the engine needs a share of plant-available water.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = 1
# Model 1 fine class -> crop library id ("other" = no record; the engine skips it, never guesses)
M1_TO_CROP = {"corn": "corn", "sorghum": "grain_sorghum", "cotton": "cotton", "soybeans": "soybeans",
              "wheat": "winter_wheat", "fallow": "fallow", "sunflower": "sunflower"}
E_TO_CROP = {"WHEAT": "winter_wheat", "CORN": "corn", "SORGHUM": "grain_sorghum", "COTTON": "cotton"}


def default_models_dir():
    here = ROOT / "v2" / "models"
    if (here / "model1" / "predictions_v2.csv.gz").exists():
        return here
    return ROOT.parent / "Greenline-v2" / "v2" / "models"   # pranav-work worktree


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", default=str(default_models_dir()))
    ap.add_argument("--counties", default="")
    ap.add_argument("--ids", default="")
    ap.add_argument("--index", default=str(ROOT / "shared" / "v2" / "input-index.json"))
    ap.add_argument("--out", default=str(ROOT / "shared" / "v2" / "models"))
    a = ap.parse_args()
    M, out = Path(a.models), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    fields = json.loads(Path(a.index).read_text())["fields"]
    if a.ids:
        fields = [f for f in fields if f["id"] in a.ids.split(",")]
    elif a.counties:
        fields = [f for f in fields if f["countyFips"] in a.counties.split(",")]
    ids = {f["id"] for f in fields}
    if not ids:
        raise SystemExit("no fields: build the input files first (pipeline/v2/build_inputs.py)")

    ph = json.loads((ROOT / "content" / "model-placeholders.json").read_text())
    p1 = pd.read_csv(M / "model1" / "predictions_v2.csv.gz", usecols=["fid", "year", "final", "source", "confidence"])
    p1 = p1[p1.fid.isin(ids)]
    yt = pd.read_csv(M / "modelC" / "year_types.csv")
    yt = yt[yt.season == "summer"]
    c2040 = json.loads((M / "modelC" / "metrics.json").read_text())["2040"]
    freq = {s: {t: round(c2040[s]["summer"]["meanShare"][t], 3) for t in ("drought", "hot", "wet", "normal")} for s in ("ssp245", "ssp585")}
    e = pd.read_csv(M / "calibrationE" / "predictions.csv", usecols=["cfips", "year", "crop", "trend"])
    e = e.sort_values("year").groupby(["cfips", "crop"]).last().reset_index()

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    written, missing = 0, {"A": 0, "C": 0, "E": 0}
    for f in fields:
        fid, cf = f["id"], int(f["countyFips"])
        doc = {"schemaVersion": SCHEMA, "fieldId": fid, "generatedAt": now,
               "modelVersions": {"A": "model1-v2", "B": None, "C": "modelC-1", "D": None, "E": "calibrationE-1"}}

        rows = p1[p1.fid == fid].sort_values("year")
        if len(rows):
            doc["modelA"] = {
                "_note": "cropByYear from Model 1 v2; cropDates are the placeholder calendars (no field planting-date model yet).",
                "cropByYear": [{"year": int(r.year), "crop": M1_TO_CROP.get(r.final, "other"),
                                "confidence": None if pd.isna(r.confidence) else round(float(r.confidence), 3),
                                "labelSource": "usda-cdl" if r.source == "usda_cdl" else "model"} for r in rows.itertuples()],
                "cropDates": ph["modelA"]["calendars"],
            }
        else:
            missing["A"] += 1

        c = yt[yt.cfips == cf].sort_values("year")
        if len(c):
            doc["modelC"] = {"_note": "County summer-season year types (rule cut-offs, so probability 1); 2040 = 8 CMIP6 models' mean share.",
                             "yearTypes": [{"year": int(r.year), "type": r.year_type, "probability": 1.0} for r in c.itertuples()],
                             "frequencies2040": freq}
        else:
            missing["C"] += 1

        ec = e[e.cfips == cf]
        if len(ec):
            crops = {k: dict(v) for k, v in ph["calibrationE"]["crops"].items()}
            fitted = []
            for r in ec.itertuples():
                crop = E_TO_CROP.get(r.crop)
                if crop and crop in crops and pd.notna(r.trend):
                    crops[crop]["typicalYield"] = round(float(r.trend), 1)
                    fitted.append(f"{crop} ({int(r.year)})")
            doc["calibrationE"] = {"_note": "County trend yield in its latest NASS year for: " + ", ".join(fitted)
                                            + ". Other crops keep the placeholder yield.",
                                   "crops": crops, "wpScale": ph["calibrationE"].get("wpScale", 1),
                                   "heatThresholdOffsetC": ph["calibrationE"].get("heatThresholdOffsetC", 0),
                                   "regionId": f"county-{cf}"}
        else:
            missing["E"] += 1

        (out / f"{fid}.json").write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        written += 1
    print(f"wrote {written} slot files to {out}; fields without a model row: {missing}")


if __name__ == "__main__":
    main()
