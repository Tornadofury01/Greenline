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
  calibrationE  Calibration E (`calibrationE/predictions.csv`): the county's fitted yield trend (a straight line per
                county and crop) read at TREND_YEAR, for wheat, corn, sorghum, cotton; every other crop keeps its
                placeholder yield.
  modelB        Model B (`modelB/field_sensitivity.csv` + `metrics.json`): how much THIS field's crop browns per unit of
                drought (z per SPEI) and per hot day, relative to the average field with that crop. The engine's
                textbook factors (FAO-33 droughtKy, heatLossPerDay) are scaled by that ratio, clipped to 0.5-2x, so
                the level stays textbook and the field-to-field spread comes from the satellite record. Heat is only
                scaled for crops whose average greenness falls on hot days (summer and winter grain). Crops Model B
                has no group for keep the textbook values. stressOutlook is not written: the forecast needs this
                month's data and the record ends in Dec 2025, so the fixed calendar outlook stays (tagged in the app).
  modelD        SMAP L4 root-zone soil moisture (v2/data/ee/smapl4_*.csv, 9 km, 2015-2025), the root-zone product
                Model D's own report recommends for the simulator start (Model D itself only downscales SURFACE
                moisture). rootZoneFraction = the latest value placed in this field's own 2015-2025 range (5th
                percentile = 0, 95th = 1, clipped), a stand-in for "share of plant-available water"; asOf = its date
                (the record ends in 2025, so it is not today's value); daily = the last 90 days.
"""
import argparse
import glob
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = 1
# Model 1 fine class -> crop library id ("other" = no record; the engine skips it, never guesses)
M1_TO_CROP = {"corn": "corn", "sorghum": "grain_sorghum", "cotton": "cotton", "soybeans": "soybeans",
              "wheat": "winter_wheat", "fallow": "fallow", "sunflower": "sunflower"}
E_TO_CROP = {"WHEAT": "winter_wheat", "CORN": "corn", "SORGHUM": "grain_sorghum", "COTTON": "cotton"}
# Model B crop group -> crop library ids it speaks for (cash crops of that group)
B_GROUP_CROPS = {"summer_grain": ["corn", "grain_sorghum"], "winter_grain": ["winter_wheat"], "cotton": ["cotton"],
                 "soybeans": ["soybeans"]}
TREND_YEAR = 2025         # Calibration E: typical yield = the county trend in this year
B_RATIO = (0.5, 2.0)      # clip on field / average sensitivity
B_HEAT_MIN = -0.005       # scale heat only where the crop's average greenness clearly drops on hot days (z per day)


def clip(x, lo, hi):
    return max(lo, min(hi, x))


def smap_rootzone(data, ids):
    """{fid: Series(date -> m3/m3)} of SMAP L4 root-zone moisture, daily, 2015-2025."""
    parts = []
    for f in sorted(glob.glob(str(data / "ee" / "smapl4_*.csv"))):
        head = pd.read_csv(f, nrows=0).columns
        cols = [c for c in head if re.fullmatch(r"d\d\d_sm_rootzone", c)]
        d = pd.read_csv(f, usecols=["fid", "year", "month"] + cols)
        d = d[d.fid.isin(ids)].melt(id_vars=["fid", "year", "month"], var_name="day", value_name="sm").dropna()
        d["date"] = pd.to_datetime(dict(year=d.year, month=d.month, day=d.day.str[1:3].astype(int)), errors="coerce")
        parts.append(d.dropna(subset=["date"])[["fid", "date", "sm"]])
    s = pd.concat(parts).sort_values(["fid", "date"])
    return {fid: g.set_index("date").sm for fid, g in s.groupby("fid")}


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
    ap.add_argument("--data", default=str(ROOT / "v2" / "data"))
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
    # the trend is linear per county and crop: read it at TREND_YEAR from any two of its points
    trend_rows = []
    for (cfips, crop), g in e.dropna(subset=["trend"]).groupby(["cfips", "crop"]):
        g = g.drop_duplicates("year").sort_values("year")
        if len(g) >= 2:
            (y1, t1), (y2, t2) = g[["year", "trend"]].iloc[0], g[["year", "trend"]].iloc[-1]
            v = t1 + (t2 - t1) * (TREND_YEAR - y1) / (y2 - y1)
        else:
            v = g.trend.iloc[0]
        trend_rows.append({"cfips": cfips, "crop": crop, "trend": max(0.0, float(v)), "year": TREND_YEAR, "lastNass": int(g.year.max())})
    e = pd.DataFrame(trend_rows)
    bs = pd.read_csv(M / "modelB" / "field_sensitivity.csv")
    bs = bs[bs.fid.isin(ids)].set_index(["fid", "crop"])
    bmean = json.loads((M / "modelB" / "metrics.json").read_text())["sensitivityByCrop"]

    sm = smap_rootzone(Path(a.data), ids)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    written, missing = 0, {"A": 0, "B": 0, "C": 0, "D": 0, "E": 0}
    for f in fields:
        fid, cf = f["id"], int(f["countyFips"])
        doc = {"schemaVersion": SCHEMA, "fieldId": fid, "generatedAt": now,
               "modelVersions": {"A": "model1-v2", "B": "modelB-1", "C": "modelC-1", "D": "smapl4-rootzone-1", "E": "calibrationE-1"}}

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

        crops_b, scaled = {k: dict(v) for k, v in ph["modelB"]["crops"].items()}, []
        for group, crop_ids in B_GROUP_CROPS.items():
            if (fid, group) not in bs.index or group not in bmean:
                continue
            r, avg = bs.loc[(fid, group)], bmean[group]
            dr = clip(r.z_per_spei90 / avg["z_per_spei90"], *B_RATIO) if avg["z_per_spei90"] > 0 else 1.0
            hr = clip(r.z_per_hot_day / avg["z_per_hot_day"], *B_RATIO) if avg["z_per_hot_day"] < B_HEAT_MIN else 1.0
            for c in crop_ids:
                if c in crops_b:
                    crops_b[c]["droughtKy"] = round(crops_b[c]["droughtKy"] * dr, 3)
                    crops_b[c]["heatLossPerDay"] = round(crops_b[c]["heatLossPerDay"] * hr, 4)
            scaled.append(f"{group} drought x{dr:.2f} heat x{hr:.2f} ({int(r.n_months)} months)")
        if scaled:
            doc["modelB"] = {"_note": "Textbook factors scaled by this field's Model B sensitivity vs the average field: " + "; ".join(scaled)
                                      + ". Other crops: textbook. No stress outlook (record ends Dec 2025).",
                             "crops": crops_b}
        else:
            missing["B"] += 1

        ser = sm.get(fid)
        if ser is not None and len(ser) > 365:
            lo, hi = ser.quantile(0.05), ser.quantile(0.95)
            frac = lambda v: round(float(min(1.0, max(0.0, (v - lo) / (hi - lo)))), 3) if hi > lo else 0.5
            last = ser.iloc[-90:]
            doc["modelD"] = {"_note": f"SMAP L4 root-zone moisture (9 km) placed in this field's 2015-2025 range "
                                      f"(5th pct {lo:.3f} = 0, 95th {hi:.3f} = 1 m3/m3). Satellite value for the area, "
                                      f"not measured on the field; latest date {ser.index[-1].date()}.",
                             "rootZoneFraction": frac(ser.iloc[-1]), "asOf": ser.index[-1].date().isoformat(),
                             "daily": [{"date": d.date().isoformat(), "fraction": frac(v)} for d, v in last.items()]}
        else:
            missing["D"] += 1

        ec = e[e.cfips == cf]
        if len(ec):
            crops = {k: dict(v) for k, v in ph["calibrationE"]["crops"].items()}
            fitted = []
            for r in ec.itertuples():
                crop = E_TO_CROP.get(r.crop)
                if crop and crop in crops and pd.notna(r.trend):
                    crops[crop]["typicalYield"] = round(float(r.trend), 1)
                    fitted.append(f"{crop} (last NASS year {r.lastNass})")
            doc["calibrationE"] = {"_note": f"County yield trend read at {TREND_YEAR} for: " + ", ".join(fitted)
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
