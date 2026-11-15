"""Model 1 inputs: season-curve features per field-year from every clear Landsat scene, CDL labels, SSURGO soil.

Season window for field-year Y: October of Y-1 to December of Y (15 monthly bins), so fall-planted winter wheat is
seen from emergence. Landsat 5 / 7 / 8 / 9 per-scene medians inside the 45 m-buffered field; a scene counts when
>= 70 % of the field's pixels are clear and < 5 % snow.

Writes v2/data/model1/features.pkl (one row per field-year 1985-2025) and labels.pkl (CDL 2008-2025).
  python v2/models/model1/features.py
"""
import glob, re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
EE = ROOT / "v2" / "data" / "ee"
OUT = ROOT / "v2" / "data" / "model1"
OUT.mkdir(parents=True, exist_ok=True)
MIN_CLEAR, MAX_SNOW = 0.7, 0.05
IDX = ["ndvi", "ndti", "bsi"]
BANDS = ["nir", "swir1", "red"]

# CDL code -> fine class
CDL = {1: "corn", 4: "sorghum", 2: "cotton", 5: "soybeans", 24: "wheat", 26: "wheat", 225: "wheat", 236: "wheat",
       238: "wheat", 22: "wheat", 23: "wheat", 28: "small_grain", 27: "small_grain", 21: "small_grain",
       205: "small_grain", 29: "small_grain", 36: "hay_grass", 37: "hay_grass", 176: "hay_grass", 58: "hay_grass",
       59: "hay_grass", 60: "hay_grass", 62: "hay_grass", 61: "fallow", 6: "sunflower"}
NONCROP = {111, 121, 122, 123, 124, 131, 141, 142, 143, 152, 190, 195}
# fine -> grouped (the Field Shift 5 classes + soybeans/sunflower kept apart; app MODEL_CLASS uses the 5)
GROUP = {"corn": "summer_grain", "sorghum": "summer_grain", "wheat": "winter_grain", "small_grain": "winter_grain",
         "cotton": "cotton", "hay_grass": "grass_hay", "fallow": "fallow", "soybeans": "soybeans",
         "sunflower": "other", "other": "other", "noncrop": "noncrop"}


def scenes():
    cols = ["fid", "date", "sensor", "tot_count", "snow_count", "ndvi_count"] + [f"{b}_p50" for b in IDX + BANDS + ["st_c"]]
    parts = []
    for f in sorted(glob.glob(str(EE / "ls[5789]*_*.csv"))):
        d = pd.read_csv(f, usecols=lambda c: c in cols)
        d = d[(d.ndvi_count >= MIN_CLEAR * d.tot_count) & (d.snow_count <= MAX_SNOW * d.tot_count) & (d.tot_count > 0)]
        parts.append(d)
    s = pd.concat(parts, ignore_index=True)
    s["date"] = pd.to_datetime(s.date)
    # the same scene can come from two overlapping paths on one day: keep one row per field-date-sensor
    s = s.groupby(["fid", "date", "sensor"], as_index=False).median(numeric_only=True)
    print(f"clear scenes: {len(s):,} field-scenes, {s.fid.nunique()} fields, "
          f"{s.date.dt.year.min()}-{s.date.dt.year.max()}", flush=True)
    return s


def season_features(s):
    rows = []
    s = s.assign(y=s.date.dt.year, m=s.date.dt.month)
    # each scene feeds season Y (Jan-Dec of Y -> bins 1..12) and, if Oct-Dec, season Y+1 (bins -2..0)
    a = s.assign(season=s.y, bin=s.m)
    b = s[s.m >= 10].assign(season=s.y + 1, bin=s.m - 12)
    x = pd.concat([a, b])
    x["doy"] = (x.date - pd.to_datetime(x.season.astype(str) + "-01-01")).dt.days + 1
    g = x.groupby(["fid", "season", "bin"])
    mon = g[[f"{v}_p50" for v in IDX]].median().unstack("bin")
    mon.columns = [f"{v[:-4]}_m{int(b):+d}" for v, b in mon.columns]
    nobs = g.size().unstack("bin").fillna(0)
    feats = mon.join(pd.DataFrame({"n_obs": nobs.sum(axis=1), "n_months": (nobs > 0).sum(axis=1)}))

    gg = x.groupby(["fid", "season"])
    nd = x.ndvi_p50
    def stat(mask, col, fn, name):
        feats[name] = x[mask].groupby(["fid", "season"])[col].agg(fn)
    stat(x.bin.between(-2, 3), "ndvi_p50", "median", "ndvi_winter")      # Oct-Mar: wheat green, summer crops bare
    stat(x.bin.between(4, 6), "ndvi_p50", "median", "ndvi_spring")       # Apr-Jun: corn / sorghum up, wheat ripens
    stat(x.bin.between(7, 9), "ndvi_p50", "median", "ndvi_summer")       # Jul-Sep: cotton peak, corn done
    stat(x.bin.between(1, 12), "ndvi_p50", "max", "ndvi_max")
    stat(x.bin.between(1, 12), "ndvi_p50", "min", "ndvi_min")
    stat(x.bin.between(1, 12), "ndvi_p50", lambda v: v.quantile(0.9) - v.quantile(0.1), "ndvi_range")
    stat(x.bin.between(5, 9), "st_c_p50", "median", "st_summer")
    stat(x.bin.between(1, 12), "ndti_p50", "median", "ndti_med")
    stat(x.bin.between(1, 12), "bsi_p50", "max", "bsi_max")
    # peak timing: day of year of the greenest clear scene (Jan-Dec)
    yr = x[x.bin.between(1, 12)]
    idx = yr.groupby(["fid", "season"]).ndvi_p50.idxmax()
    feats["peak_doy"] = yr.loc[idx.values].set_index(["fid", "season"]).doy
    # green-up / dry-down: first and last day above half the season's range
    lo, hi = feats.ndvi_min, feats.ndvi_max
    thr = (lo + 0.5 * (hi - lo)).rename("thr")
    t = yr.join(thr, on=["fid", "season"])
    above = t[t.ndvi_p50 >= t.thr]
    feats["greenup_doy"] = above.groupby(["fid", "season"]).doy.min()
    feats["drydown_doy"] = above.groupby(["fid", "season"]).doy.max()
    feats["green_span"] = feats.drydown_doy - feats.greenup_doy
    sens = x.groupby(["fid", "season"]).sensor.agg(lambda v: "l89" if v.isin(["ls8", "ls9"]).mean() > 0.5 else "l57")
    feats["l89"] = (sens == "l89").astype(int)
    feats = feats.reset_index().rename(columns={"season": "year"})
    return feats[(feats.year >= 1985) & (feats.year <= 2025)]


def labels():
    d = pd.read_csv(EE / "cdl.csv")
    out = []
    for r in d.itertuples():
        kv = {int(float(k)): float(v) for k, v in re.findall(r"([0-9.]+)=([0-9.]+)", r.cropland_histogram)}
        if not kv:
            continue
        code = max(kv, key=kv.get)
        fine = CDL.get(code, "noncrop" if code in NONCROP else "other")
        out.append({"fid": r.fid, "year": int(r.year), "cdl_code": code, "purity": kv[code] / sum(kv.values()),
                    "fine": fine, "group": GROUP[fine]})
    return pd.DataFrame(out)


def soil():
    s = pd.read_csv(ROOT / "v2" / "data" / "ssurgo_fields.csv")
    keep = ["fid", "claytotal_r_0_30", "sandtotal_r_0_30", "om_r_0_30", "awc_r_0_100", "ph1to1h2o_r_0_30",
            "ksat_r_0_30", "aws0100wta", "slope_r", "kwfact"]
    return s[[c for c in keep if c in s.columns]]


def main():
    s = scenes()
    f = season_features(s).merge(soil(), on="fid", how="left")
    f["cfips"] = f.fid.str[:5]
    f.to_pickle(OUT / "features.pkl")
    lab = labels()
    lab.to_pickle(OUT / "labels.pkl")
    print(f"features: {len(f):,} field-years x {f.shape[1]} columns; labels: {len(lab):,} field-years "
          f"({(lab.purity >= 0.7).mean():.0%} with purity >= 0.7)")
    print(lab[lab.purity >= 0.7].fine.value_counts().to_dict())


if __name__ == "__main__":
    main()
