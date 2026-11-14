"""Model 1: season and crop classifier.

Input: yearly Landsat NDVI / NDTI / BSI curves (monthly, 2008-2025) for ~200 North Texas fields,
labeled with the Cropland Data Layer (CDL) crop for that year.

Outputs per field-year:
  * crop class (corn, cotton, grain_sorghum, soybeans, winter_wheat, small_grain, double_crop, fallow, other)
  * monthly cover state: green / residue / bare (a transparent index rule, see `cover_state`)
  * bare-days score
  * green-up and senescence dates, checked against NASS Crop Progress

Validation: leave-one-YEAR-out. Every test year is a year the model never saw. Never a random split.
Approaches: random forest vs. gradient boosting, plus majority and "same as last year" baselines.

Run: pipeline/.venv/Scripts/python pipeline/models/season_crop.py
"""
import json

import numpy as np
import pandas as pd
import shap
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix, f1_score

from common import DATA, MONTHS, MONTH_NAMES, RESULTS, SEED, daily_curve, load_cdl, load_landsat

GREEN_NDVI = 0.40   # NDVI at or above: actively growing cover
BARE_NDVI = 0.25    # NDVI below: little live cover (same as BARE_NDVI in app/src/data/loadField.js)
# NDTI is NOT used for the cover states: on Blackland Prairie clays bare soil already reads NDTI ~0.15,
# so a fixed residue threshold (e.g. 0.07) labelled almost every day "residue". Needs field calibration.
MAX_MISSING = 3     # drop field-years with more than this many months missing after gap-filling

BANDS = ["ndvi", "ndti", "bsi"]
BAND_WORDS = {"ndvi": "greenness (NDVI)", "ndti": "crop residue (NDTI)", "bsi": "bare soil (BSI)"}


def build_table():
    ls = load_landsat()
    wide = ls.pivot_table(index=["fieldId", "year"], columns="month", values=BANDS)
    wide.columns = [f"{b}_{m:02d}" for b, m in wide.columns]
    raw_missing = ls.pivot_table(index=["fieldId", "year"], columns="month", values="ndvi", aggfunc="size")
    nmiss = wide[[f"ndvi_{m:02d}" for m in range(1, 13)]].isna().sum(axis=1)
    nfilled = ls.groupby(["fieldId", "year"]).filled.sum()
    t = wide[nmiss <= MAX_MISSING].copy()
    # Remaining gaps: fill with that band's value for the same month across all fields that year (tree models need numbers)
    for b in BANDS:
        for m in range(1, 13):
            col = f"{b}_{m:02d}"
            t[col] = t[col].fillna(t.groupby(level="year")[col].transform("median"))
    nd = t[[f"ndvi_{m:02d}" for m in range(1, 13)]].values
    t["ndvi_max"] = nd.max(1)
    t["ndvi_min"] = nd.min(1)
    t["ndvi_peak_month"] = nd.argmax(1) + 1
    t["green_months"] = (nd >= GREEN_NDVI).sum(1)
    t["ndvi_spring_minus_summer"] = nd[:, 2:5].mean(1) - nd[:, 6:9].mean(1)
    t["filledMonths"] = nfilled.reindex(t.index).fillna(0).astype(int)
    cdl = load_cdl().set_index(["fieldId", "year"])
    t = t.join(cdl[["code", "cls"]], how="inner")
    dropped = int((nmiss > MAX_MISSING).sum())
    return t, dropped


def feature_cols(t):
    return [c for c in t.columns if c.split("_")[0] in BANDS or c in
            ("ndvi_max", "ndvi_min", "ndvi_peak_month", "green_months", "ndvi_spring_minus_summer")]


def plain_feature(name, value=None):
    """Feature name -> plain words, e.g. ndvi_07 -> 'greenness (NDVI) in July'."""
    p = name.split("_")
    if len(p) == 2 and p[1].isdigit():
        return f"{BAND_WORDS[p[0]]} in {MONTH_NAMES[int(p[1]) - 1]}"
    return {"ndvi_max": "peak greenness", "ndvi_min": "lowest greenness", "ndvi_peak_month": "month of peak greenness",
            "green_months": "number of green months", "ndvi_spring_minus_summer": "spring vs. summer greenness"}[name]


def leave_years_out(t, feats, make_model):
    years = sorted(t.index.get_level_values("year").unique())
    pred = pd.Series(index=t.index, dtype=object)
    for y in years:
        test = t.index.get_level_values("year") == y
        tr = ~test & (t.cls != "double_crop")  # double crops: too few to learn (see MODELS.md)
        m = make_model().fit(t.loc[tr, feats], t.loc[tr, "cls"])
        pred[test] = m.predict(t.loc[test, feats])
    return pred


def scores(y, p):
    return {"accuracy": round(accuracy_score(y, p), 3), "balancedAccuracy": round(balanced_accuracy_score(y, p), 3),
            "macroF1": round(f1_score(y, p, average="macro", zero_division=0), 3)}


def per_year_acc(y, p):
    df = pd.DataFrame({"y": y, "p": p})
    return {int(k): round(float((g.y == g.p).mean()), 3) for k, g in df.groupby(level="year")}


# ------------------------------------------------------------------ cover states and dates
def cover_state(ndvi, ndti=None):
    """green: NDVI >= 0.40. bare: NDVI < 0.25 (the app's BARE_NDVI). residue: in between
    (sparse plants, stubble or residue; Landsat cannot tell these apart reliably here)."""
    if ndvi >= GREEN_NDVI:
        return "green"
    if ndvi < BARE_NDVI:
        return "bare"
    return "residue"


def daily_states(row):
    nd = daily_curve([row[f"ndvi_{m:02d}"] for m in range(1, 13)])
    green = nd >= GREEN_NDVI
    bare = nd < BARE_NDVI
    return nd, int(green.sum()), int(bare.sum()), int((~green & ~bare).sum()), int((nd < BARE_NDVI).sum())


def greenup_senescence(nd):
    """Day of year the NDVI curve rises through / falls back through half its seasonal amplitude
    around the main peak. Monthly data, so about +/- 15 days."""
    pk = int(np.nanargmax(nd))
    lo_before, lo_after = nd[:pk + 1].min(), nd[pk:].min()
    up_thr = lo_before + 0.5 * (nd[pk] - lo_before)
    dn_thr = lo_after + 0.5 * (nd[pk] - lo_after)
    up = next((d for d in range(pk, -1, -1) if nd[d] < up_thr), None)
    dn = next((d for d in range(pk, 365) if nd[d] < dn_thr), None)
    return (up + 1 if up is not None else None), (dn if dn is not None else None), pk


def nass_dates():
    """Day of year when Texas reaches 50% for a stage, from NASS end-of-month percentages."""
    n = pd.read_csv(DATA / "nass_crop_progress_tx_monthly.csv")
    out = {}
    eom = np.array([31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365])
    for (crop, stage, year), g in n.groupby(["crop", "stage", "year"]):
        g = g.sort_values("month")
        xs = [eom[m - 2] if m > 1 else 0 for m in g.month] + [eom[m - 1] for m in g.month]
        # use the end-of-month curve only
        days = np.array([eom[m - 1] for m in g.month])
        pct = g.pctEndOfMonth.values.astype(float)
        if pct.max() < 50:
            continue
        i = int(np.argmax(pct >= 50))
        if i == 0:
            prev_day = days[0] - 30
            prev_pct = 0.0
        else:
            prev_day, prev_pct = days[i - 1], pct[i - 1]
        doy = prev_day + (50 - prev_pct) / max(pct[i] - prev_pct, 1e-6) * (days[i] - prev_day)
        out[(crop, stage, int(year))] = float(doy)
    return out


NASS_CROP = {"corn": "corn", "cotton": "cotton", "grain_sorghum": "sorghum", "soybeans": "soybeans",
             "winter_wheat": None}  # winter wheat green-up spans two calendar years; not checked


def check_dates(t):
    nd50 = nass_dates()
    rows = []
    for (fid, yr), r in t.iterrows():
        crop = NASS_CROP.get(r.cls)
        if not crop:
            continue
        nd = daily_curve([r[f"ndvi_{m:02d}"] for m in range(1, 13)])
        if np.isnan(nd).any() or nd.max() - nd.min() < 0.2:
            continue
        up, dn, pk = greenup_senescence(nd)
        rows.append({"fieldId": fid, "year": yr, "crop": crop, "greenUp": up, "senescence": dn,
                     "nassPlanted": nd50.get((crop, "planted", yr)), "nassEmerged": nd50.get((crop, "emerged", yr)),
                     "nassHarvested": nd50.get((crop, "harvested", yr))})
    d = pd.DataFrame(rows)
    summary = {}
    for crop, g in d.groupby("crop"):
        s = {"fieldYears": len(g)}
        for sat, ref in (("greenUp", "nassEmerged"), ("greenUp", "nassPlanted"), ("senescence", "nassHarvested")):
            x = g.dropna(subset=[sat, ref])
            if len(x) >= 5:
                diff = x[sat] - x[ref]
                s[f"{sat}_minus_{ref}"] = {"n": len(x), "medianDays": round(float(diff.median()), 1),
                                           "meanAbsDays": round(float(diff.abs().mean()), 1),
                                           "within30DaysPct": round(float((diff.abs() <= 30).mean()), 3)}
        summary[crop] = s
    return d, summary


# ------------------------------------------------------------------ main
def main():
    t, dropped = build_table()
    feats = feature_cols(t)
    n_double = int((t.cls == "double_crop").sum())
    y_all = t.cls
    ev = t.cls != "double_crop"          # rows we train and score on
    y = t.cls[ev]
    counts = y.value_counts().to_dict()
    years = sorted(t.index.get_level_values("year").unique())
    print(f"{len(t)} field-years, {t.index.get_level_values('fieldId').nunique()} fields, years {years[0]}-{years[-1]}")
    print("classes:", counts)

    rf = lambda: RandomForestClassifier(400, min_samples_leaf=2, class_weight="balanced_subsample", n_jobs=-1, random_state=SEED)
    gb = lambda: HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, class_weight="balanced", random_state=SEED)
    p_rf_all = leave_years_out(t, feats, rf)
    p_gb_all = leave_years_out(t, feats, gb)
    p_rf, p_gb = p_rf_all[ev], p_gb_all[ev]
    # Baselines
    maj = pd.Series(y.value_counts().idxmax(), index=y.index)
    prev = load_cdl().set_index(["fieldId", "year"]).cls
    p_prev = pd.Series([prev.get((f, yr - 1), "unknown") for f, yr in y.index], index=y.index)

    res_scores = {"randomForest": scores(y, p_rf), "gradientBoosting": scores(y, p_gb),
                  "baselineMajorityClass": scores(y, maj), "baselineSameAsLastYear": scores(y, p_prev)}
    for k, v in res_scores.items():
        print(k, v)
    best_name = max(("randomForest", "gradientBoosting"), key=lambda k: res_scores[k]["macroF1"])
    p_best = p_rf if best_name == "randomForest" else p_gb
    p_best_all = p_rf_all if best_name == "randomForest" else p_gb_all
    report = classification_report(y, p_best, output_dict=True, zero_division=0)
    per_class = {c: {"recall": round(report[c]["recall"], 3), "precision": round(report[c]["precision"], 3), "n": int(report[c]["support"])}
                 for c in sorted(counts)}
    labels = sorted(counts)
    cm = confusion_matrix(y, p_best, labels=labels).tolist()

    # Final model on all years (for exports and SHAP). Held-out predictions are what we report and export.
    # Explanation model: a smaller random forest on all years (exact TreeSHAP on 400 deep trees is too slow).
    rf_all = RandomForestClassifier(150, max_depth=12, min_samples_leaf=2, class_weight="balanced_subsample",
                                    n_jobs=-1, random_state=SEED).fit(t.loc[ev, feats], y)
    expl = shap.TreeExplainer(rf_all)
    sv = expl.shap_values(t[feats], check_additivity=False)  # (n, feats, classes) in recent shap
    sv = np.asarray(sv)
    if sv.ndim == 3 and sv.shape[0] == len(rf_all.classes_):
        sv = np.moveaxis(sv, 0, -1)
    cls_idx = {c: i for i, c in enumerate(rf_all.classes_)}
    global_imp = pd.Series(np.abs(sv).mean(axis=(0, 2)), index=feats).sort_values(ascending=False)
    per_class_top = {}
    for c, i in cls_idx.items():
        imp = pd.Series(np.abs(sv[(y_all == c).values, :, i]).mean(0), index=feats).sort_values(ascending=False)
        per_class_top[c] = [plain_feature(f) for f in imp.index[:3]]

    # Per field-year outputs
    dates_df, date_summary = check_dates(t.assign(cls=p_best_all))
    dates_idx = dates_df.set_index(["fieldId", "year"]) if len(dates_df) else None
    rows = []
    for k, (idx, r) in enumerate(t.iterrows()):
        nd, g, b, res, low = daily_states(r)
        months = [cover_state(r[f"ndvi_{m:02d}"], r[f"ndti_{m:02d}"]) for m in range(1, 13)]
        pc = p_best_all[idx]
        contrib = pd.Series(sv[k, :, cls_idx[pc]], index=feats) if pc in cls_idx else None
        top = contrib.sort_values(ascending=False).index[0] if contrib is not None else None
        rec = {"fieldId": idx[0], "year": int(idx[1]), "cdlClass": r.cls, "predictedClass": pc,
               "predictedHeldOut": True, "correct": bool(pc == r.cls) if r.cls != "double_crop" else None,
               "doubleCropCdl": r.cls == "double_crop", "doubleCropConfidence": "low" if r.cls == "double_crop" else None,
               "fallow": pc == "fallow",
               "months": months, "greenDays": g, "residueDays": res, "bareDays": b, "lowNdviDays": low,
               "bareDaysScore": int(round(100 * (1 - b / 365))), "filledMonths": int(r.filledMonths),
               "topDriver": {"feature": top, "text": f"{plain_feature(top)[0].upper()}{plain_feature(top)[1:]} mattered most"} if top else None}
        if dates_idx is not None and idx in dates_idx.index:
            d = dates_idx.loc[idx]
            rec["greenUpDoy"], rec["senescenceDoy"] = d.greenUp, d.senescence
        rows.append(rec)

    flags = [f"Double-crop years: only {n_double} field-years in CDL. Not a model class; shown only as 'detected by CDL' (low confidence)."]
    if dropped:
        flags.append(f"{dropped} field-years dropped: more than {MAX_MISSING} cloudy/missing months.")
    small = {c: n for c, n in counts.items() if n < 50}
    if small:
        flags.append(f"Class imbalance: very few examples of {small}. Scores for these classes are unreliable.")
    top_share = max(counts.values()) / len(t)
    flags.append(f"Largest class is {max(counts, key=counts.get)} at {top_share:.0%} of field-years; "
                 f"a majority-class guess already scores {res_scores['baselineMajorityClass']['accuracy']:.0%} accuracy.")
    if res_scores[best_name]["accuracy"] > 0.95:
        flags.append("Accuracy above 95% — check for leakage before trusting it.")
    flags.append("Labels are CDL, which is itself a satellite classification (Texas accuracy for minor crops can be well below 90%). "
                 "The model learns CDL, including its mistakes.")
    flags.append("The same fields appear in training and test (different years). Held-out years test new weather, not new places.")
    flags.append(f"Green/residue/bare uses NDVI only ({GREEN_NDVI}/{BARE_NDVI}). 'Residue' means sparse cover or residue. "
                 "An NDTI residue threshold of 0.07 was tried and rejected: Blackland clays read NDTI ~0.15 even when bare, "
                 "so it marked almost no day as bare. Residue detection needs field calibration.")
    flags.append("Monthly Landsat composites: dates are about +/- 15 days at best; cloudy months are interpolated.")
    flags.append("NASS Crop Progress is Texas-wide (includes South Texas and the High Plains), not North Texas.")

    res = {
        "model": "season_crop", "validation": "leave-one-year-out", "years": [int(years[0]), int(years[-1])],
        "nFieldYears": len(t), "nFields": int(t.index.get_level_values("fieldId").nunique()), "classCounts": counts,
        "scores": res_scores, "chosen": best_name, "perClass": per_class,
        "confusion": {"labels": labels, "matrix": cm},
        "perYearAccuracy": {"randomForest": per_year_acc(y, p_rf), "gradientBoosting": per_year_acc(y, p_gb)},
        "doubleCropFieldYearsCdl": n_double,
        "fallowRecall": per_class.get("fallow", {}).get("recall"),
        "shapGlobalTop": [{"feature": f, "text": plain_feature(f), "meanAbsShap": round(float(v), 4)} for f, v in global_imp.head(8).items()],
        "shapTopByClass": per_class_top,
        "datesVsNass": date_summary,
        "thresholds": {"greenNdvi": GREEN_NDVI, "bareNdvi": BARE_NDVI, "residueNdti": None},
        "flags": flags,
    }
    (RESULTS / "season_crop.json").write_text(json.dumps(res, indent=1, default=str))
    pd.DataFrame(rows).to_json(RESULTS / "season_crop_fieldyears.json", orient="records")
    print(json.dumps({k: res[k] for k in ("perClass", "shapGlobalTop", "shapTopByClass", "datesVsNass", "flags")}, indent=1, default=str))


if __name__ == "__main__":
    main()
