"""Landsat 5/7 -> 8/9 harmonization check (results: docs/landsat-harmonization-results.md).

Inputs (make them first):
    pipeline/sample_fields.py landsat_overlap landsat_harmonized
    GREENLINE_RESULTS_SUFFIX=_baseline season_crop.py
    GREENLINE_LANDSAT_CSV=landsat_monthly_harmonized.csv GREENLINE_RESULTS_SUFFIX=_harmonized season_crop.py

Three checks, with pass rules fixed before looking at results:
  1. Sensor overlap (2013-2021): same field, same month, Landsat 7 alone vs Landsat 8 alone.
     Pass if |mean NDVI bias| after correction is <= 0.01 and smaller than before.
  2. Cover statistics before (2008-2012) vs after (2013-2025) the switch to Landsat 8, within each CDL crop.
     Pass if the bare-day gap shrinks for at least 3 of corn, winter wheat, cotton, grain sorghum.
  3. Model 1, same leave-one-year-out splits and settings. Pass if accuracy and balanced accuracy each drop <= 0.005.
Prints markdown tables to stdout.
"""
import json

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, precision_recall_fscore_support

from common import FIELDS, RESULTS

MAJOR = ["corn", "winter_wheat", "cotton", "grain_sorghum"]
BARE = 0.25
RNG = np.random.default_rng(0)


def md(df, floatfmt=3):
    df = df.copy()
    for c in df.columns:
        if df[c].dtype.kind == "f":
            df[c] = df[c].map(lambda v: "" if pd.isna(v) else f"{v:.{floatfmt}f}")
    head = "| " + " | ".join(map(str, df.columns)) + " |"
    sep = "|" + "|".join("---" for _ in df.columns) + "|"
    rows = ["| " + " | ".join(map(str, r)) + " |" for r in df.astype(str).values]
    return "\n".join([head, sep, *rows])


# ---------------------------------------------------------------- 1. sensor overlap
def overlap():
    d = pd.read_csv(FIELDS / "landsat_overlap_l7_l8.csv")
    both = d.dropna(subset=["l7_ndvi", "l7h_ndvi", "l8_ndvi"])
    print(f"## 1. Sensor overlap\n\n{len(both):,} field-months with both a Landsat 7 and a Landsat 8 composite "
          f"({both.year.min()}-{both.year.max()}, {both.fieldId.nunique()} fields).\n")
    rows = []
    for b in ("ndvi", "ndti", "bsi"):
        for k, name in (("l7", "raw"), ("l7h", "harmonized")):
            diff = both[f"{k}_{b}"] - both[f"l8_{b}"]
            rows.append({"index": b.upper(), "Landsat 7": name, "mean bias (L7-L8)": diff.mean(),
                         "median bias": diff.median(), "MAD": (diff - diff.median()).abs().median(),
                         "RMSE": float(np.sqrt((diff ** 2).mean())), "r": both[f"{k}_{b}"].corr(both[f"l8_{b}"])})
    t = pd.DataFrame(rows)
    print(md(t, 4), "\n")

    # Where on the NDVI scale: the bare cutoff (0.25) is what matters for bare days
    both = both.assign(bin=pd.cut(both.l8_ndvi, [-1, 0.25, 0.4, 0.6, 1], labels=["<0.25 (bare)", "0.25-0.40", "0.40-0.60", ">=0.60"]))
    g = both.groupby("bin", observed=True)
    t2 = pd.DataFrame({"field-months": g.size(), "raw bias": g.apply(lambda x: (x.l7_ndvi - x.l8_ndvi).mean()),
                       "harmonized bias": g.apply(lambda x: (x.l7h_ndvi - x.l8_ndvi).mean())}).reset_index() \
        .rename(columns={"bin": "Landsat 8 NDVI"})
    print("NDVI bias by Landsat 8 NDVI range:\n")
    print(md(t2, 4), "\n")

    # Same-month bare calls
    bare = pd.DataFrame({"Landsat 7 raw": [(both.l7_ndvi < BARE).mean()], "Landsat 7 harmonized": [(both.l7h_ndvi < BARE).mean()],
                         "Landsat 8": [(both.l8_ndvi < BARE).mean()]})
    agree = pd.DataFrame({"raw": [((both.l7_ndvi < BARE) == (both.l8_ndvi < BARE)).mean()],
                          "harmonized": [((both.l7h_ndvi < BARE) == (both.l8_ndvi < BARE)).mean()]})
    print("Share of field-months called bare (NDVI < 0.25):\n")
    print(md(bare), "\n")
    print("Agreement with Landsat 8 on bare / not bare:\n")
    print(md(agree), "\n")

    g = both.groupby("year")
    t3 = pd.DataFrame({"field-months": g.size(), "raw bias": g.apply(lambda x: (x.l7_ndvi - x.l8_ndvi).mean()),
                       "harmonized bias": g.apply(lambda x: (x.l7h_ndvi - x.l8_ndvi).mean())}).reset_index()
    print("NDVI bias by year:\n")
    print(md(t3, 4), "\n")

    raw_b = (both.l7_ndvi - both.l8_ndvi).mean()
    h_b = (both.l7h_ndvi - both.l8_ndvi).mean()
    ok = abs(h_b) <= 0.01 and abs(h_b) < abs(raw_b)
    print(f"**Gate 1 (overlap):** mean NDVI bias {raw_b:+.4f} raw -> {h_b:+.4f} harmonized. "
          f"Rule |bias| <= 0.01 and smaller: **{'PASS' if ok else 'FAIL'}**\n")
    return ok


# ---------------------------------------------------------------- 2. cover statistics around 2013
def cover():
    fy = {k: pd.read_json(RESULTS / f"season_crop_{k}_fieldyears.json") for k in ("baseline", "harmonized")}
    print("## 2. Cover statistics before vs. after 2013\n")
    print("Per CDL crop (so changes in crop mix don't count). Bare days = days with NDVI < 0.25, green = NDVI >= 0.40, "
          "same rule as model 1. Pre = 2008-2012 (Landsat 5/7 only), post = 2013-2025.\n")
    out, shrink = [], {}
    for crop in MAJOR + ["fallow", "all"]:
        r = {"crop": crop}
        for k, f in fy.items():
            f = f if crop == "all" else f[f.cdlClass == crop]
            pre, post = f[f.year <= 2012], f[f.year >= 2013]
            r["n pre/post"] = f"{len(pre)}/{len(post)}"
            for v, lab in (("bareDays", "bare"), ("greenDays", "green")):
                r[f"{lab} pre ({k[:4]})"] = pre[v].median()
                r[f"{lab} post ({k[:4]})"] = post[v].median()
                r[f"{lab} gap ({k[:4]})"] = post[v].median() - pre[v].median()
        if crop in MAJOR:
            shrink[crop] = abs(r["bare gap (harm)"]) < abs(r["bare gap (base)"])
        out.append(r)
    t = pd.DataFrame(out)
    cols = ["crop", "n pre/post", "bare pre (base)", "bare post (base)", "bare gap (base)",
            "bare pre (harm)", "bare post (harm)", "bare gap (harm)"]
    print("Median bare days per year:\n")
    print(md(t[cols], 0), "\n")
    cols = ["crop", "green pre (base)", "green post (base)", "green gap (base)",
            "green pre (harm)", "green post (harm)", "green gap (harm)"]
    print("Median green days per year:\n")
    print(md(t[cols], 0), "\n")

    # Sensitivity: years right next to the switch (less real-world change in between). 2011 drought is in the pre window.
    out = []
    for crop in MAJOR + ["all"]:
        r = {"crop": crop}
        for k, f in fy.items():
            f = f if crop == "all" else f[f.cdlClass == crop]
            pre, post = f[f.year.between(2010, 2012)], f[f.year.between(2013, 2015)]
            r[f"bare gap ({k[:4]})"] = post.bareDays.median() - pre.bareDays.median()
        out.append(r)
    print("Sensitivity, adjacent years only (2013-2015 minus 2010-2012), median bare days:\n")
    print(md(pd.DataFrame(out), 0), "\n")

    # Bare days per year, all crops (shows the step and what is left of it)
    yr = pd.DataFrame({k: f.groupby("year").bareDays.median() for k, f in fy.items()}).reset_index()
    yr.columns = ["year", "median bare days (baseline)", "median bare days (harmonized)"]
    print("Median bare days by year, all field-years:\n")
    print(md(yr, 0), "\n")

    n = sum(shrink.values())
    ok = n >= 3
    print(f"**Gate 2 (cover):** bare-day gap shrinks for {n} of 4 major crops "
          f"({', '.join(c for c, s in shrink.items() if s) or 'none'}). Rule >= 3: **{'PASS' if ok else 'FAIL'}**\n")
    return ok


# ---------------------------------------------------------------- 3. model 1
def year_bootstrap(a, b, metric, n=2000):
    """Paired difference (b - a) with a 95% interval from resampling whole years (field-years in a year are not independent)."""
    years = a.year.unique()
    by = {y: (a[a.year == y], b[b.year == y]) for y in years}
    diffs = []
    for _ in range(n):
        s = RNG.choice(years, len(years))
        A = pd.concat([by[y][0] for y in s]); B = pd.concat([by[y][1] for y in s])
        diffs.append(metric(B.cls, B.p) - metric(A.cls, A.p))
    return np.percentile(diffs, [2.5, 97.5])


def model1():
    res = {k: json.loads((RESULTS / f"season_crop_{k}.json").read_text()) for k in ("baseline", "harmonized")}
    ho = {k: pd.read_csv(RESULTS / f"season_crop_{k}_heldout.csv") for k in ("baseline", "harmonized")}
    a, b = ho["baseline"], ho["harmonized"]
    same = a[["fieldId", "year", "cls"]].equals(b[["fieldId", "year", "cls"]])
    print("## 3. Model 1 (season and crop), leave-one-year-out\n")
    print(f"Same {len(a):,} field-years, labels and year splits in both runs: **{same}**. Same model settings and seed.\n")

    rows = []
    for m in ("gradientBoosting", "randomForest", "baselineSameAsLastYear", "baselineMajorityClass"):
        sa, sb = res["baseline"]["scores"][m], res["harmonized"]["scores"][m]
        rows.append({"approach": m, "accuracy old": sa["accuracy"], "accuracy new": sb["accuracy"],
                     "balanced acc. old": sa["balancedAccuracy"], "balanced acc. new": sb["balancedAccuracy"],
                     "macro F1 old": sa["macroF1"], "macro F1 new": sb["macroF1"]})
    print(md(pd.DataFrame(rows)), "\n")
    print(f"Chosen model (by macro F1): old **{res['baseline']['chosen']}**, new **{res['harmonized']['chosen']}**.\n")

    out = {}
    for m in ("gradientBoosting", "randomForest"):
        A, B = a.assign(p=a[m]), b.assign(p=b[m])
        ci_acc = year_bootstrap(A, B, accuracy_score)
        ci_bal = year_bootstrap(A, B, balanced_accuracy_score)
        pa = A.groupby("year").apply(lambda g: (g.cls == g.p).mean())
        pb = B.groupby("year").apply(lambda g: (g.cls == g.p).mean())
        out[m] = (ci_acc, ci_bal, pa, pb)
        print(f"{m}: change in accuracy 95% interval (resampling years) [{ci_acc[0]:+.3f}, {ci_acc[1]:+.3f}], "
              f"balanced accuracy [{ci_bal[0]:+.3f}, {ci_bal[1]:+.3f}]. "
              f"Years better / same / worse: {(pb > pa + 1e-9).sum()} / {(abs(pb - pa) <= 1e-9).sum()} / {(pb < pa - 1e-9).sum()}.\n")

    m = "gradientBoosting"
    labels = sorted(a.cls.unique())
    pra = precision_recall_fscore_support(a.cls, a[m], labels=labels, zero_division=0)
    prb = precision_recall_fscore_support(b.cls, b[m], labels=labels, zero_division=0)
    t = pd.DataFrame({"crop": labels, "n": pra[3], "recall old": pra[1], "recall new": prb[1],
                      "precision old": pra[0], "precision new": prb[0], "F1 old": pra[2], "F1 new": prb[2]})
    t["F1 change"] = t["F1 new"] - t["F1 old"]
    t = t.sort_values("n", ascending=False)
    print("Per crop, gradient boosting (held out):\n")
    print(md(t), "\n")

    pa, pb = out[m][2], out[m][3]
    t = pd.DataFrame({"year": pa.index, "old": pa.values, "new": pb.values, "change": (pb - pa).values})
    print("Accuracy by held-out year, gradient boosting (sensor: 2008-2012 Landsat 5/7, 2013+ mixed L7/L8/L9):\n")
    print(md(t), "\n")
    pre = t[t.year <= 2012]; post = t[t.year >= 2013]
    print(f"Mean change in yearly accuracy: 2008-2012 {pre.change.mean():+.3f}, 2013-2025 {post.change.mean():+.3f}.\n")

    gb_a, gb_b = res["baseline"]["scores"][m], res["harmonized"]["scores"][m]
    d_acc, d_bal = gb_b["accuracy"] - gb_a["accuracy"], gb_b["balancedAccuracy"] - gb_a["balancedAccuracy"]
    ok = d_acc >= -0.005 and d_bal >= -0.005
    print(f"**Gate 3 (model 1, gradient boosting):** accuracy {d_acc:+.3f}, balanced accuracy {d_bal:+.3f}. "
          f"Rule each >= -0.005: **{'PASS' if ok else 'FAIL'}**\n")
    return ok


if __name__ == "__main__":
    g1 = overlap()
    g2 = cover()
    g3 = model1()
    print(f"## Verdict\n\nCover lines up (gates 1 and 2): **{g1 and g2}**. Model 1 not worse (gate 3): **{g3}**. "
          f"Adopt: **{g1 and g2 and g3}**.")
