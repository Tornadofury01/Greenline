"""Model C v2 (Field Shift v2): what kinds of growing seasons each North Texas county gets, and how often in 2040.

What changed from v1 (one area-wide March-October series, k-means on 41 years; the "drought" type held only 2011):
  - one row per COUNTY x CROP SEASON: summer crops Apr-Sep, winter grain Oct (year before)-May. 6 counties x 41 years
    x 2 seasons = 492 seasons instead of 41.
  - year types from FIXED CUTOFFS on each county's own 1985-2014 seasons (the CMIP6 baseline period), checked in order:
      drought  water deficit (reference ET - rain) in the county's driest 15 %
      wet      rain in the wettest 15 %
      hot      heat days (summer: >= 35 C; winter grain: >= 32 C in Mar-May, grain fill) in the hottest 20 %
      normal   everything else
    Every type has enough seasons to mean something, names can't flip between runs, and 2040 is classified with the
    same cutoffs. k-means is kept only as a cross-check (agreement reported).
  - 2040: quantile delta mapping (Cannon et al. 2015) per county, calendar month and variable, for each of the 8
    NEX-GDDP-CMIP6 models x SSP2-4.5 / SSP5-8.5 (2030-2050 vs the model's own 1985-2014). Each quantile shifts by its
    own amount, so heat extremes and rain variability change too (v1 shifted only the means). Reference ET comes
    from each model's own FAO-56 Penman-Monteith (temperature, humidity, sunlight, wind), not a flat 3 % per degree.
  - checks against things the types never saw, per county-season: US Drought Monitor D2+ area, RMA drought/heat loss
    ratio (indemnity / liability), NASS yield deviation from trend, Model B greenness z.

  python v2/models/modelC/train.py
Writes v2/models/modelC/: year_types.csv, model3.joblib, metrics.json, REPORT.md
"""
import glob, json, sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_rand_score, roc_auc_score
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
EE = ROOT / "v2" / "data" / "ee"
DATA = ROOT / "v2" / "data"
BASE = (1985, 2014)
SEASONS = {"summer": [4, 5, 6, 7, 8, 9], "winter": [10, 11, 12, 1, 2, 3, 4, 5]}
CUT = {"drought": 0.85, "wet": 0.85, "hot": 0.80}
FEATS = ["rain_mm", "deficit_mm", "heat_days", "heavy_rain_days", "tmax_mean", "freeze_days"]
TYPES = ["drought", "wet", "hot", "normal"]
LAT, ELEV = 32.1, 160.0                     # study-area centre, m


# ---------------- observed daily weather per county ----------------

def county_daily():
    cache = DATA / "modelC_county_daily.pkl"
    if cache.exists():
        return pd.read_pickle(cache)
    rows = []
    for f in sorted(glob.glob(str(EE / "gridmet_*.csv"))):
        d = pd.read_csv(f, dtype={"cfips": str})
        mean = d.groupby(["cfips", "year", "month"]).mean(numeric_only=True)
        for (c, y, m), r in mean.iterrows():
            for day in range(1, 32):
                try:
                    date = pd.Timestamp(int(y), int(m), day)
                except ValueError:
                    continue
                g = lambda b: r.get(f"d{day:02d}_{b}", np.nan)
                rows.append({"cfips": c, "date": date, "pr": g("pr"), "tmax": g("tmmx") - 273.15,
                             "tmin": g("tmmn") - 273.15, "eto": g("eto")})
    w = pd.DataFrame(rows).dropna(subset=["tmax"]).sort_values(["cfips", "date"]).reset_index(drop=True)
    w.to_pickle(cache)
    return w


def season_features(w):
    """Daily county weather -> one row per county x season x year (season year = harvest year)."""
    w = w.assign(month=w.date.dt.month)
    w["syear"] = np.where(w.month >= 10, w.date.dt.year + 1, w.date.dt.year)
    out = []
    for s, months in SEASONS.items():
        x = w[w.month.isin(months)].copy()
        if s == "summer":
            x["syear"] = x.date.dt.year
            x["hot"] = x.tmax >= 35
        else:
            x["hot"] = (x.tmax >= 32) & x.month.isin([3, 4, 5])
        x["heavy"] = x.pr >= 25
        x["freeze"] = (x.tmin <= -7) & x.month.isin([2, 3, 4]) if s == "winter" else False
        g = x.groupby(["cfips", "syear"])
        f = pd.DataFrame({"rain_mm": g.pr.sum(), "deficit_mm": g.eto.sum() - g.pr.sum(), "heat_days": g.hot.sum(),
                          "heavy_rain_days": g.heavy.sum(), "tmax_mean": g.tmax.mean(), "freeze_days": g.freeze.sum(),
                          "ndays": g.size()}).reset_index().rename(columns={"syear": "year"})
        f = f[f.ndays >= 0.95 * {"summer": 183, "winter": 243}[s]].drop(columns="ndays")
        out.append(f.assign(season=s))
    f = pd.concat(out, ignore_index=True)
    return f[f.year.between(1985, 2025)]


# ---------------- year types: fixed cutoffs ----------------

def fit_cutoffs(f):
    b = f[f.year.between(*BASE)]
    return {(c, s): {"deficit_mm": float(g.deficit_mm.quantile(CUT["drought"])),
                     "rain_mm": float(g.rain_mm.quantile(CUT["wet"])),
                     "heat_days": float(g.heat_days.quantile(CUT["hot"]))}
            for (c, s), g in b.groupby(["cfips", "season"])}


def classify(f, cut):
    lab = []
    for c, s, d, r, h in zip(f.cfips, f.season, f.deficit_mm, f.rain_mm, f.heat_days):
        k = cut[(c, s)]
        lab.append("drought" if d >= k["deficit_mm"] else "wet" if r >= k["rain_mm"]
                   else "hot" if h >= k["heat_days"] and h > 0 else "normal")
    return np.array(lab)


def percentile_ranks(f):
    """Where each season sits in its county's 1985-2014 seasons (0-100), the numbers behind the type."""
    out = f.copy()
    for (c, s), g in f.groupby(["cfips", "season"]):
        b = g[g.year.between(*BASE)]
        for v in ("rain_mm", "deficit_mm", "heat_days"):
            out.loc[g.index, f"pct_{v}"] = [round(100 * (b[v] < x).mean() + 50 * (b[v] == x).mean()) for x in g[v]]
    return out


# ---------------- checks against independent records ----------------

def checks(t):
    sys.path.insert(0, str(HERE.parent))
    from nass_yields import county_yields
    usdm = pd.read_csv(DATA / "usdm_county_weekly.csv", dtype={"cfips": str})
    usdm["date"] = pd.to_datetime(usdm.MapDate.astype(str), format="%Y%m%d", errors="coerce")
    usdm["m"] = usdm.date.dt.month
    usdm["sy"] = np.where(usdm.m >= 10, usdm.date.dt.year + 1, usdm.date.dt.year)
    rows = []
    for s, months in SEASONS.items():
        u = usdm[usdm.m.isin(months)]
        u = u.assign(year=u.date.dt.year if s == "summer" else u.sy)
        rows.append(u.groupby(["cfips", "year"]).D2.mean().rename("usdm_d2plus_pct").reset_index().assign(season=s))
    usdm = pd.concat(rows)

    rma = pd.read_csv(DATA / "rma_county_year_cause.csv", dtype={"cfips": str})
    rma["season"] = np.where(rma.commodity_name.str.upper().str.contains("WHEAT"), "winter", "summer")
    rma = rma[rma.commodity_name.str.upper().str.contains("WHEAT|CORN|SORGHUM|COTTON")]
    bad = rma.cause_desc.str.contains("DROUGHT|HEAT|HOT WIND")
    liab = rma.drop_duplicates(["cfips", "commodity_name", "commodity_year"]).groupby(["cfips", "season", "commodity_year"]).liability.sum()
    paid = rma[bad].groupby(["cfips", "season", "commodity_year"]).indemnity.sum()
    rma = (paid.reindex(liab.index).fillna(0) / liab.replace(0, np.nan)).rename("rma_dry_loss_ratio").reset_index()
    rma = rma.rename(columns={"commodity_year": "year"})

    y = county_yields()
    dev = []
    for (crop, c), g in y.groupby(["commodity_desc", "cfips"]):
        if crop in ("WHEAT", "CORN", "SORGHUM", "COTTON") and len(g) >= 8:
            tr = np.polyval(np.polyfit(g.year, g.value_num, 2), g.year)      # quadratic trend: yields bend over 40 years
            dev.append(g.assign(dev=100 * (g.value_num / tr - 1),
                                season="winter" if crop == "WHEAT" else "summer"))
    dev = pd.concat(dev).groupby(["cfips", "season", "year"]).dev.mean().rename("yield_dev_pct").reset_index()

    mb = pd.read_pickle(DATA / "modelB" / "monthly.pkl")
    mb = mb[mb.growing == 1]
    gr = []
    for s, months in SEASONS.items():
        x = mb[mb.month.isin(months)]
        x = x.assign(year=x.year if s == "summer" else np.where(x.month >= 10, x.year + 1, x.year), season=s)
        gr.append(x.groupby(["cfips", "season", "year"]).z.mean().rename("greenness_z").reset_index())
    gr = pd.concat(gr)

    t = t.copy()
    t["cfips"] = t.cfips.astype(str)
    for extra in (usdm, rma, dev, gr):
        extra["cfips"] = extra.cfips.astype(str)
        t = t.merge(extra, on=["cfips", "season", "year"], how="left")
    cols = ["usdm_d2plus_pct", "rma_dry_loss_ratio", "yield_dev_pct", "greenness_z"]
    out = {"byType": {s: t[t.season == s].groupby("year_type")[cols].mean().round(3).to_dict(orient="index")
                      for s in SEASONS},
           "n": {s: t[t.season == s].year_type.value_counts().to_dict() for s in SEASONS}}
    # does "drought" pick out the bad seasons? AUC of drought-vs-not against each record's worst 15 %
    auc = {}
    for s in SEASONS:
        x = t[t.season == s]
        for col, worst_high in (("usdm_d2plus_pct", True), ("rma_dry_loss_ratio", True), ("yield_dev_pct", False), ("greenness_z", False)):
            v = x[[col, "deficit_mm"]].dropna()
            if len(v) > 30 and v[col].nunique() > 5:
                bad = v[col] >= v[col].quantile(0.85) if worst_high else v[col] <= v[col].quantile(0.15)
                auc[f"{s}:{col}"] = {"auc_deficit": round(float(roc_auc_score(bad, v.deficit_mm)), 3),
                                     "share_of_worst_typed_drought": round(float((x.loc[v.index[bad], "year_type"] == "drought").mean()), 3),
                                     "n": int(len(v))}
    out["worstSeasons"] = auc
    # gaps: drought minus normal, with a bootstrap 90 % range
    rng = np.random.default_rng(0)
    gap = {}
    for s in SEASONS:
        x = t[t.season == s]
        for col in cols:
            a, b = x.loc[x.year_type == "drought", col].dropna().values, x.loc[x.year_type == "normal", col].dropna().values
            if len(a) >= 5 and len(b) >= 5:
                bs = [rng.choice(a, len(a)).mean() - rng.choice(b, len(b)).mean() for _ in range(2000)]
                gap[f"{s}:{col}"] = {"droughtMinusNormal": round(float(a.mean() - b.mean()), 3),
                                     "range90": [round(float(np.percentile(bs, 5)), 3), round(float(np.percentile(bs, 95)), 3)]}
    out["droughtVsNormal"] = gap
    return out, t


# ---------------- 2040: quantile delta mapping ----------------

def eto_pm(tmax, tmin, rh, rs_wm2, u10, doy):
    """FAO-56 Penman-Monteith grass reference ET (mm/day) from daily model output."""
    tmean = (tmax + tmin) / 2
    es = lambda t: 0.6108 * np.exp(17.27 * t / (t + 237.3))
    es_mean = (es(tmax) + es(tmin)) / 2
    ea = es_mean * np.clip(rh, 1, 100) / 100
    delta = 4098 * es(tmean) / (tmean + 237.3) ** 2
    p = 101.3 * ((293 - 0.0065 * ELEV) / 293) ** 5.26
    gamma = 0.000665 * p
    u2 = u10 * 4.87 / np.log(67.8 * 10 - 5.42)
    rs = rs_wm2 * 0.0864
    phi = np.radians(LAT)
    dr = 1 + 0.033 * np.cos(2 * np.pi * doy / 365)
    dec = 0.409 * np.sin(2 * np.pi * doy / 365 - 1.39)
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(dec), -1, 1))
    ra = 24 * 60 / np.pi * 0.082 * dr * (ws * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(ws))
    rso = (0.75 + 2e-5 * ELEV) * ra
    rns = 0.77 * rs
    sb = 4.903e-9
    rnl = sb * (((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2) * (0.34 - 0.14 * np.sqrt(ea)) * (1.35 * np.clip(rs / rso, 0.3, 1) - 0.35)
    rn = rns - rnl
    return np.clip((0.408 * delta * rn + gamma * 900 / (tmean + 273) * u2 * (es_mean - ea)) / (delta + gamma * (1 + 0.34 * u2)), 0, None)


def load_cmip6():
    cm = pd.concat([pd.read_csv(f, dtype={"cfips": str}) for f in sorted(glob.glob(str(EE / "cmip6_*.csv")))], ignore_index=True)
    cm["date"] = pd.to_datetime(cm.date)
    cm["pr"] = cm.pr * 86400                         # kg m-2 s-1 -> mm/day
    cm["tmax"] = cm.tasmax - 273.15
    cm["tmin"] = cm.tasmin - 273.15
    cm["eto"] = eto_pm(cm.tmax.values, cm.tmin.values, cm.hurs.values, cm.rsds.values, cm.sfcWind.values, cm.date.dt.dayofyear.values)
    cm["month"] = cm.date.dt.month
    return cm[["cfips", "date", "month", "model", "scenario", "pr", "tmax", "tmin", "eto"]]


Q = np.linspace(0.01, 0.99, 99)


def qdm(obs, base_obs, hist, fut, kind):
    """Shift each observed daily value by the model change at its own quantile.
    kind 'add' (temperature): x + (F_fut^-1(q) - F_hist^-1(q)); 'mul' (rain, ET): x * F_fut^-1(q) / F_hist^-1(q)."""
    if kind == "mul":
        wet = obs > 0.1
        out = obs.copy()
        bo, h, f = base_obs[base_obs > 0.1], hist[hist > 0.1], fut[fut > 0.1]
        if len(bo) < 20 or len(h) < 20 or len(f) < 20:
            return out * (fut.mean() / max(hist.mean(), 1e-6))
        q = np.interp(obs[wet], np.quantile(bo, Q), Q)
        ratio = np.interp(q, Q, np.quantile(f, Q)) / np.maximum(np.interp(q, Q, np.quantile(h, Q)), 1e-3)
        # wet-day frequency change, applied as an amount factor (keeps the observed day sequence)
        freq = (f.size / fut.size) / max(h.size / hist.size, 1e-6)
        out[wet] = obs[wet] * np.clip(ratio, 0.2, 5) * np.clip(freq, 0.5, 2)
        return out
    q = np.interp(obs, np.quantile(base_obs, Q), Q)
    return obs + np.interp(q, Q, np.quantile(fut, Q)) - np.interp(q, Q, np.quantile(hist, Q))


def cmip6_2040(w, cut):
    cm = load_cmip6()
    w = w.assign(month=w.date.dt.month)
    base = w[w.date.dt.year.between(*BASE)]
    obs_f = season_features(w)
    obs_share = pd.Series(classify(obs_f, cut)).value_counts(normalize=True)
    freq, change = {}, {}
    for model in sorted(cm.model.unique()):
        for sc in ("ssp245", "ssp585"):
            ws = w.copy()
            ok = True
            for c in w.cfips.unique():
                h = cm[(cm.model == model) & (cm.scenario == "historical") & (cm.cfips == c)]
                f = cm[(cm.model == model) & (cm.scenario == sc) & (cm.cfips == c)]
                if not len(h) or not len(f):
                    ok = False
                    break
                for m in range(1, 13):
                    idx = (ws.cfips == c) & (ws.month == m)
                    bo = base[(base.cfips == c) & (base.month == m)]
                    hm, fm = h[h.month == m], f[f.month == m]
                    for v, kind in (("tmax", "add"), ("tmin", "add"), ("pr", "mul"), ("eto", "mul")):
                        ws.loc[idx, v] = qdm(w.loc[idx, v].values, bo[v].values, hm[v].values, fm[v].values, kind)
            if not ok:
                continue
            fs = season_features(ws)
            lab = classify(fs, cut)
            for s in SEASONS:
                freq[(model, sc, s)] = pd.Series(lab[fs.season.values == s]).value_counts(normalize=True).reindex(TYPES).fillna(0).to_dict()
            hh, ff = cm[(cm.model == model) & (cm.scenario == "historical")], cm[(cm.model == model) & (cm.scenario == sc)]
            change[(model, sc)] = {"rainChangePct": round(100 * (ff.pr.mean() / hh.pr.mean() - 1), 1),
                                   "tmaxChangeC": round(ff.tmax.mean() - hh.tmax.mean(), 2),
                                   "etoChangePct": round(100 * (ff.eto.mean() / hh.eto.mean() - 1), 1),
                                   "hot99thChangeC": round(float(ff.tmax.quantile(0.99) - hh.tmax.quantile(0.99)), 2)}
            print(f"  2040 {model} {sc}: summer {freq[(model, sc, 'summer')]}", flush=True)
    summary = {"observed1985_2025": {s: pd.Series(classify(obs_f[obs_f.season == s], cut)).value_counts(normalize=True).round(3).to_dict() for s in SEASONS},
               "baseline1985_2014": "drought 15 %, wet ~15 %, hot ~20 % of the rest, by construction"}
    for sc in ("ssp245", "ssp585"):
        summary[sc] = {}
        for s in SEASONS:
            rows = pd.DataFrame([v for (m, x, ss), v in freq.items() if x == sc and ss == s])
            obs_s = summary["observed1985_2025"][s]
            summary[sc][s] = {"meanShare": rows.mean().round(3).to_dict(), "minShare": rows.min().round(3).to_dict(),
                              "maxShare": rows.max().round(3).to_dict(), "nModels": int(len(rows)),
                              "modelsMoreDroughtThanToday": int((rows.drought > obs_s.get("drought", 0)).sum()),
                              "modelsMoreHotThanToday": int((rows.hot > obs_s.get("hot", 0)).sum())}
        summary[sc]["climateChange"] = {m: change[(m, x)] for (m, x) in change if x == sc}
    return summary


# ---------------- main ----------------

def main():
    w = county_daily()
    f = season_features(w)
    cut = fit_cutoffs(f)
    f["year_type"] = classify(f, cut)
    f = percentile_ranks(f)
    res = {"rows": int(len(f)), "counties": sorted(f.cfips.unique().tolist()), "baseline": list(BASE), "cutoffs": CUT,
           "cutoffValues": {f"{c}:{s}": {k: round(v, 1) for k, v in d.items()} for (c, s), d in cut.items()}}
    for s in SEASONS:
        x = f[f.season == s]
        print(f"{s}: {x.year_type.value_counts().to_dict()}")
    # cross-check: k-means on the same features, per season
    agree = {}
    for s in SEASONS:
        x = f[f.season == s]
        cols = [c for c in FEATS if x[c].std() > 0]
        X = StandardScaler().fit_transform(x[cols])
        km = KMeans(4, n_init=50, random_state=0).fit(X)
        agree[s] = round(adjusted_rand_score(x.year_type, km.labels_), 3)
    res["kmeansAgreementARI"] = agree
    # area-wide summer type per year (most common across the 6 counties), what the app shows as "the year"
    area = f[f.season == "summer"].groupby("year").year_type.agg(lambda v: v.value_counts().idxmax())
    res["areaSummerYears"] = {t: sorted(int(y) for y in area.index[area == t]) for t in TYPES}
    for t, ys in res["areaSummerYears"].items():
        print(f"  area summer {t:<8} {len(ys):>2}: {ys}")
    chk, table = checks(f)
    res["checks"] = chk
    for k, v in chk["droughtVsNormal"].items():
        print(f"  drought - normal {k}: {v}")
    for k, v in chk["worstSeasons"].items():
        print(f"  worst 15% {k}: {v}")
    print("2040 (quantile delta mapping) ...", flush=True)
    res["2040"] = cmip6_2040(w, cut)
    for sc in ("ssp245", "ssp585"):
        for s in SEASONS:
            r = res["2040"][sc][s]
            print(f"2040 {sc} {s}: {r['meanShare']} | more drought than today: {r['modelsMoreDroughtThanToday']}/{r['nModels']}")
    print("observed 1985-2025:", res["2040"]["observed1985_2025"])
    table.to_csv(HERE / "year_types.csv", index=False)
    joblib.dump({"cutoffs": cut, "cutoffQuantiles": CUT, "seasons": SEASONS, "features": FEATS, "baseline": BASE,
                 "order": ["drought", "wet", "hot", "normal"]}, HERE / "model3.joblib")
    (HERE / "metrics.json").write_text(json.dumps(res, indent=1, default=str))
    write_report(res)
    print("wrote year_types.csv, model3.joblib, metrics.json, REPORT.md")


def write_report(res):
    pct = lambda v: f"{100 * v:.0f}%"
    L = ["# Model C v2: season types per county and crop season, and 2040", "",
         f"{res['rows']} county-seasons: 6 counties x 1985-2025 x 2 crop seasons (summer crops Apr-Sep, winter grain "
         "Oct-May). Types come from fixed cutoffs on each county's own 1985-2014 seasons, checked in order: "
         "**drought** (water deficit in the driest 15%), **wet** (rain in the wettest 15%), **hot** (heat days in the "
         "hottest 20%; winter = days >= 32 C in Mar-May), **normal**.", "",
         "## How often each type happened (1985-2025)", "", "| Season | drought | wet | hot | normal |", "|---|---|---|---|---|"]
    for s in SEASONS:
        o = res["2040"]["observed1985_2025"][s]
        L.append(f"| {s} | " + " | ".join(pct(o.get(t, 0)) for t in TYPES) + " |")
    L += ["", "Area-wide summer type (most common across the 6 counties): " +
          "; ".join(f"**{t}** {', '.join(map(str, ys))}" for t, ys in res["areaSummerYears"].items() if t != "normal"), "",
          "## Checks against records the types never saw", "",
          "Mean per type: US Drought Monitor D2+ area (%), RMA drought/heat loss ratio (indemnity per $100 liability), "
          "NASS yield deviation from trend (%), Model B greenness z.", ""]
    for s in SEASONS:
        L += [f"**{s.title()}**", "", "| Type | Drought Monitor D2+ | RMA dry loss ratio | Yield vs trend | Greenness z |", "|---|---|---|---|---|"]
        for t in TYPES:
            v = res["checks"]["byType"][s].get(t)
            if v:
                L.append(f"| {t} | {v['usdm_d2plus_pct']:.1f} | {v['rma_dry_loss_ratio']:.2f} | {v['yield_dev_pct']:+.1f}% | {v['greenness_z']:+.2f} |")
        L.append("")
    L += ["Drought minus normal (bootstrap 90% range):", ""]
    for k, v in res["checks"]["droughtVsNormal"].items():
        L.append(f"- {k}: {v['droughtMinusNormal']:+.2f} ({v['range90'][0]:+.2f} to {v['range90'][1]:+.2f})")
    L += ["", "Does the deficit pick out the worst 15% of seasons in each record? (AUC; share of those seasons typed drought)", ""]
    for k, v in res["checks"]["worstSeasons"].items():
        L.append(f"- {k}: AUC {v['auc_deficit']}, {pct(v['share_of_worst_typed_drought'])} typed drought (n {v['n']})")
    L += ["", f"Cross-check: k-means on the same features agrees with the cutoff types at ARI "
          f"{res['kmeansAgreementARI']['summer']} (summer) / {res['kmeansAgreementARI']['winter']} (winter). The cutoffs "
          "are the model; k-means is only a sanity check (the seasons don't form tight natural clusters, silhouette ~0.28 in v1).",
          "", "Reading the winter types: a winter-grain **hot** season is a warm spring, and it came with *better* wheat "
          "(see the table), so for wheat it is not a stress type. Winter **wet** came with lower wheat yields "
          "(waterlogging, disease, late planting).", "",
          "## 2040 (2030-2050), quantile delta mapping, 8 NEX-GDDP-CMIP6 models", "",
          "Each quantile of daily max/min temperature, rain and Penman-Monteith reference ET shifts by its own model change "
          "(per county and calendar month), then the same cutoffs classify the shifted seasons.", "",
          "| Scenario | Season | drought | wet | hot | normal | models with more drought / more hot than today |", "|---|---|---|---|---|---|---|"]
    for sc in ("ssp245", "ssp585"):
        for s in SEASONS:
            r = res["2040"][sc][s]
            cell = lambda t: f"{pct(r['meanShare'][t])} ({pct(r['minShare'][t])}-{pct(r['maxShare'][t])})"
            L.append(f"| {sc} | {s} | " + " | ".join(cell(t) for t in TYPES) +
                     f" | {r['modelsMoreDroughtThanToday']}/{r['nModels']} · {r['modelsMoreHotThanToday']}/{r['nModels']} |")
    L += ["", "Mean (min-max across models). Per-model climate change (rain %, mean max temp, reference ET %, 99th "
          "percentile max temp) is in `metrics.json` under `2040.<scenario>.climateChange`.", "",
          "**Files:** `year_types.csv` (every county-season: features, percentile ranks, type, checks), `model3.joblib` "
          "(cutoffs per county and season), `metrics.json`.", ""]
    (HERE / "REPORT.md").write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    if "--report" in sys.argv:
        write_report(json.loads((HERE / "metrics.json").read_text()))
        print("wrote REPORT.md")
    else:
        main()
