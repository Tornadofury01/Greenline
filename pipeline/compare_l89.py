"""Old (mixed Landsat 7 + 8/9) vs new (Landsat 8/9 only) cover numbers, for docs/landsat89-cover-results.md.

Reads only the built field files (shared/fields/*.json) and the two monthly Landsat tables. Prints markdown.
    pipeline/.venv/Scripts/python pipeline/compare_l89.py [fieldId]      # default nt-103
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
F = ROOT / "pipeline" / "data" / "fields"
FIELDS = ROOT / "shared" / "fields"
DEMO = sys.argv[1] if len(sys.argv) > 1 else "nt-103"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
MAIN = ["corn", "winter_wheat", "cotton", "grain_sorghum", "soybeans", "small_grain", "fallow", "other"]
OLD_FROM, NEW_FROM, LAST = 2013, 2014, 2025   # old: what build_calendars.mjs uses today; new: first full L8/9 year


def md(df, nd=0):
    df = df.copy()
    for c in df.columns:
        if df[c].dtype.kind == "f":
            df[c] = df[c].map(lambda v: "–" if pd.isna(v) else f"{v:.{nd}f}")
    df = df.fillna("–")
    return "\n".join(["| " + " | ".join(map(str, df.columns)) + " |", "|" + "|".join("---" for _ in df.columns) + "|",
                      *["| " + " | ".join(map(str, r)) + " |" for r in df.astype(str).values]])


def load():
    files = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in FIELDS.glob("*.json") if p.stem != "index"}
    return {k: v for k, v in files.items() if k.startswith("nt-")}  # the 200 sampled fields + nothing else


def calendar(fields, key, y0):
    """Same counting as scoring/tools/build_calendars.mjs: per CDL class, bare / clear months."""
    acc = {}
    for d in fields.values():
        cov = {c["year"]: c["months"] for c in d[key]}
        for h in d["cropHistory"]:
            if not (y0 <= h["year"] <= LAST) or h["year"] not in cov or not h.get("cdlClass"):
                continue
            a = acc.setdefault(h["cdlClass"], np.zeros((2, 12)))
            for i, st in enumerate(cov[h["year"]]):
                if st:
                    a[1, i] += 1
                    a[0, i] += st == "bare"
    return {c: (a[0] / np.where(a[1] > 0, a[1], np.nan), a[1]) for c, a in acc.items()}


def cal_table(old, new, crops):
    rows = []
    for c in crops:
        for lab, cal, y0 in (("old", old, OLD_FROM), ("new", new, NEW_FROM)):
            if c not in cal:
                continue
            share, n = cal[c]
            rows.append({"crop": c, "version": f"{lab} ({y0}-{LAST % 100})", "field-years": int(n.max()),
                         **{m: share[i] for i, m in enumerate(MONTHS)},
                         "≈ bare days": float(np.nansum(share * DAYS))})
    t = pd.DataFrame(rows)
    for m in MONTHS:
        t[m] = t[m].map(lambda v: "–" if pd.isna(v) else f"{v:.2f}")
    return md(t, 0)


def bare_series(d):
    old = {b["year"]: b["days"] for b in d["bareDaysPerYear"] if b["year"] >= 2008}
    new = {b["year"]: b["days"] for b in d["bareDaysPerYearL89"]}
    return old, new


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    fields = load()
    demo = json.loads((FIELDS / f"{DEMO}.json").read_text(encoding="utf-8"))
    print(f"_{len(fields)} sampled fields (nt-001…nt-200). Demo field: {DEMO}._\n")

    # ---------------- missing months
    a = pd.read_csv(F / "landsat_monthly.csv")
    b = pd.read_csv(F / "landsat_monthly_l89.csv")
    a = a[a.fieldId.str.startswith("nt-")]; b = b[b.fieldId.str.startswith("nt-")]
    m = b.merge(a, on=["fieldId", "year", "month"], suffixes=("_new", "_old"))
    print("## Cloudy / missing months\n")
    print("A month is missing when no clear Landsat pixel was seen that month. 2013 counts April–December only.\n")
    g = m.groupby("year")
    t = pd.DataFrame({"missing old %": 100 * g.ndvi_old.apply(lambda s: s.isna().mean()),
                      "missing new %": 100 * g.ndvi_new.apply(lambda s: s.isna().mean()),
                      "scenes/month old": g.scenes_old.mean(), "scenes/month new": g.scenes_new.mean()})
    tot = pd.DataFrame({"missing old %": [100 * m.ndvi_old.isna().mean()], "missing new %": [100 * m.ndvi_new.isna().mean()],
                        "scenes/month old": [m.scenes_old.mean()], "scenes/month new": [m.scenes_new.mean()]}, index=["all"])
    t = pd.concat([t, tot]).reset_index().rename(columns={"index": "year"})
    print(md(t, 1), "\n")
    added = int(m.ndvi_new.isna().sum() - m.ndvi_old.isna().sum())
    print(f"Dropping Landsat 7 adds **{added:,} missing field-months** of {len(m):,} "
          f"({100 * m.ndvi_old.isna().mean():.1f}% → {100 * m.ndvi_new.isna().mean():.1f}%).\n")

    # field-years that still get a bare-day number (>= 9 clear months after filling gaps of <= 2)
    yrs = range(NEW_FROM, LAST + 1)
    n_old = sum(1 for d in fields.values() for x in d["bareDaysPerYear"] if x["year"] in yrs)
    n_new = sum(1 for d in fields.values() for x in d["bareDaysPerYearL89"])
    print(f"Field-years {NEW_FROM}–{LAST} with a bare-day number (≥ 9 clear months): old **{n_old:,}**, new **{n_new:,}** "
          f"of {len(fields) * len(yrs):,} ({n_old - n_new:,} lost to clouds).\n")
    dm_old = m[m.fieldId == DEMO].ndvi_old.isna().sum(); dm_new = m[m.fieldId == DEMO].ndvi_new.isna().sum()
    print(f"{DEMO}: {dm_old} → {dm_new} missing months of {len(m[m.fieldId == DEMO])} (April 2013–2025). "
          f"Years with a bare-day number {NEW_FROM}–{LAST}: old {sum(1 for x in demo['bareDaysPerYear'] if x['year'] in yrs)}, "
          f"new {len(demo['bareDaysPerYearL89'])}.\n")

    # ---------------- bare days per year
    print("## Bare days per year\n")
    print("Days with NDVI < 0.25 (monthly values interpolated to daily). Old = current `bareDaysPerYear` (mixed sensors). "
          "New = `bareDaysPerYearL89` (Landsat 8/9 only, from 2014). Before 2013 there is no new value; those years are "
          "now flagged `lowConfidence`.\n")
    o, n = bare_series(demo)
    crops = {h["year"]: h["cdlClass"] for h in demo["cropHistory"]}
    t = pd.DataFrame([{"year": y, "CDL crop": crops.get(y, ""), "old": o.get(y, np.nan), "new": n.get(y, np.nan),
                       "change": (n[y] - o[y]) if y in n and y in o else np.nan,
                       "flag": "low confidence (L5/L7)" if y < 2013 else ("partial year, no new value" if y == 2013 else "")}
                      for y in range(2008, LAST + 1)])
    print(f"**{DEMO}**\n")
    print(md(t), "\n")
    both = t.dropna(subset=["old", "new"])
    print(f"{DEMO}, {NEW_FROM}–{LAST}, years with both: mean old **{both.old.mean():.0f}**, new **{both.new.mean():.0f}** bare days/yr. "
          f"(Old 2008–2012 mean: {t[t.year <= 2012].old.mean():.0f}.)\n")

    rows = []
    for d in fields.values():
        o, n = bare_series(d)
        for y in range(2008, LAST + 1):
            rows.append({"fieldId": d["field"]["id"], "year": y, "old": o.get(y), "new": n.get(y)})
    r = pd.DataFrame(rows).astype({"old": float, "new": float})
    g = r.groupby("year")
    pair = r.dropna()
    gp = pair.groupby("year")
    t = pd.DataFrame({"median old": g.old.median(), "median new": g.new.median(),
                      "median old (same field-years)": gp.old.median(), "median new (same field-years)": gp.new.median(),
                      "field-years old": g.old.count(), "field-years new": g.new.count()}).reset_index()
    print("**All fields** (median across fields; 'same field-years' = only field-years that have both numbers)\n")
    print(md(t), "\n")
    p = pair[pair.year >= NEW_FROM]
    print(f"All fields {NEW_FROM}–{LAST}, same field-years (n = {len(p):,}): median old **{p.old.median():.0f}**, "
          f"new **{p.new.median():.0f}**; mean old {p.old.mean():.0f}, new {p.new.mean():.0f}; "
          f"new lower in {100 * (p.new < p.old).mean():.0f}% of field-years. "
          f"For comparison, old 2008–2012 median: {r[r.year <= 2012].old.median():.0f}.\n")
    late = pair[pair.year >= 2024]
    print(f"Check: 2024–2025 (almost no Landsat 7 left), old vs new median {late.old.median():.0f} vs {late.new.median():.0f}, "
          f"identical in {100 * (late.old == late.new).mean():.0f}% of field-years.\n")

    # ---------------- per-crop calendars
    print("## Per-crop bare-month calendars\n")
    print("Share of field-years each month was bare, for field-years where CDL says that crop. Old = how "
          "`scoring/tools/build_calendars.mjs` computes `bareShare` today (`coverYearly`, 2013–2025, mixed sensors; "
          "2013+ cover comes from model 1). New = `shared/crop-calendars-l89.json` (`coverYearlyL89`, 2014–2025). "
          "'≈ bare days' = Σ share × days in month.\n")
    old = calendar(fields, "coverYearly", OLD_FROM)
    new = calendar(fields, "coverYearlyL89", NEW_FROM)
    print("**All fields**\n")
    print(cal_table(old, new, MAIN), "\n")
    one = {DEMO: fields.get(DEMO, demo)}
    old1 = calendar(one, "coverYearly", OLD_FROM)
    new1 = calendar(one, "coverYearlyL89", NEW_FROM)
    print(f"**{DEMO}** (one field: 2–6 years per crop, so read these as anecdotes)\n")
    print(cal_table(old1, new1, [c for c in MAIN if c in old1 or c in new1]), "\n")


if __name__ == "__main__":
    main()
