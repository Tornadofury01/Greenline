"""Model 1, round 2 features: dense gap-filled time series + weather timing (adds to features.py).

1. Every clear scene from Landsat 5/7/8/9 AND HLS L30 / S30 (2013+ / 2016+), per field. Same clear rule as round 1.
2. Season window Oct 1 (year before) -> Dec 31; NDVI / NDTI / BSI interpolated across cloud gaps onto a 10-day grid
   (46 steps), then a 3-step running mean. Plus gap stats so the model knows how much was filled.
3. Daymet daily weather per field: growing degree days (base 10 C, cap 30 C) from Oct 1, GDD at green-up / peak /
   dry-down, season GDD, rain by season, hot days (>= 35 C).
4. Sentinel-2 red-edge (NDRE) on the same 10-day grid where it exists (2016+), else empty.

Writes v2/data/model1/features_v2.pkl and series.npz (the dense series, for the neural network).
  python v2/models/model1/features_v2.py
"""
import glob
from pathlib import Path

import numpy as np
import pandas as pd

from features import EE, OUT, MAX_SNOW, MIN_CLEAR

GRID = np.arange(-90, 366, 10)          # days from Jan 1 of the season year (Oct 2 of the year before ... Dec 26)
IDX = ["ndvi", "ndti", "bsi"]


def load(pattern, extra=()):
    cols = ["fid", "date", "tot_count", "snow_count", "ndvi_count"] + [f"{v}_p50" for v in IDX + list(extra)]
    out = []
    for f in sorted(glob.glob(str(EE / pattern))):
        d = pd.read_csv(f, usecols=lambda c: c in cols)
        out.append(d[(d.tot_count > 0) & (d.ndvi_count >= MIN_CLEAR * d.tot_count) & (d.snow_count <= MAX_SNOW * d.tot_count)])
    return pd.concat(out, ignore_index=True)


def scenes():
    ls = load("ls[5789]*_*.csv").assign(src="landsat")
    l30 = load("hlsl30_*.csv").assign(src="hls_l30")
    s30 = load("hlss30_*.csv", extra=["ndre"]).assign(src="hls_s30")
    s = pd.concat([ls, l30, s30], ignore_index=True)
    s["date"] = pd.to_datetime(s.date)
    # one value per field per day (overlapping paths, Landsat + its HLS twin): median
    agg = {f"{v}_p50": "median" for v in IDX}
    agg["ndre_p50"] = "median"
    s = s.groupby(["fid", "date"], as_index=False).agg(agg)
    print(f"field-days with a clear view: {len(s):,} (Landsat + HLS)", flush=True)
    return s


def dense(s):
    s = s.assign(y=s.date.dt.year, m=s.date.dt.month)
    a = s.assign(season=s.y)
    b = s[s.m >= 10].assign(season=s.y + 1)
    x = pd.concat([a, b])
    x["t"] = (x.date - pd.to_datetime(x.season.astype(str) + "-01-01")).dt.days
    x = x[(x.t >= GRID[0] - 5) & (x.t <= GRID[-1] + 5)].sort_values(["fid", "season", "t"])
    keys, series, stats = [], [], []
    k = np.ones(3) / 3
    for (fid, season), g in x.groupby(["fid", "season"], sort=False):
        if not (1985 <= season <= 2025) or len(g) < 3:
            continue
        t = g.t.values
        chans = []
        for v in IDX + ["ndre"]:
            vals = g[f"{v}_p50"].values
            ok = ~np.isnan(vals)
            if ok.sum() < 2:
                chans.append(np.full(len(GRID), np.nan))
                continue
            z = np.interp(GRID, t[ok], vals[ok])
            z = np.convolve(np.pad(z, 1, mode="edge"), k, mode="valid")
            chans.append(z)
        gaps = np.diff(np.r_[GRID[0], t, GRID[-1]])
        near = np.min(np.abs(GRID[:, None] - t[None, :]), axis=1)
        keys.append((fid, season))
        series.append(np.stack(chans))
        stats.append({"n_views": len(t), "max_gap": gaps.max(), "filled_share": float((near > 15).mean()),
                      "views_winter": int(((t >= -90) & (t < 90)).sum()), "views_summer": int(((t >= 150) & (t < 270)).sum())})
    S = np.stack(series).astype(np.float32)            # (n, 4 channels, 46 steps)
    idx = pd.DataFrame(keys, columns=["fid", "year"])
    return idx, S, pd.DataFrame(stats)


def phenology(S):
    """Timing from the dense NDVI curve: green-up / peak / dry-down day, area, slopes."""
    nd = S[:, 0, :]
    yr = (GRID >= 0)
    lo = np.nanmin(nd[:, yr], axis=1)
    hi = np.nanmax(nd[:, yr], axis=1)
    thr = lo + 0.5 * (hi - lo)
    above = (nd >= thr[:, None]) & yr[None, :]
    first = np.where(above.any(1), GRID[np.argmax(above, axis=1)], np.nan)
    last = np.where(above.any(1), GRID[len(GRID) - 1 - np.argmax(above[:, ::-1], axis=1)], np.nan)
    peak = GRID[np.nanargmax(np.where(yr[None, :], nd, -9), axis=1)]
    d = np.diff(nd, axis=1)
    return pd.DataFrame({"d_greenup": first, "d_drydown": last, "d_peak": peak, "d_span": last - first,
                         "d_amp": hi - lo, "d_area": np.nansum(np.clip(nd[:, yr] - lo[:, None], 0, None), axis=1),
                         "d_maxrise": np.nanmax(d, axis=1), "d_maxfall": np.nanmin(d, axis=1),
                         "d_winter_peak": np.nanmax(nd[:, GRID < 120], axis=1),
                         "d_summer_peak": np.nanmax(nd[:, (GRID >= 150) & (GRID < 300)], axis=1)})


def weather(idx, ph):
    """Daymet per field-day -> GDD since Oct 1 at the curve's timing points, plus season rain / heat."""
    rows = []
    for f in sorted(glob.glob(str(EE / "daymet_*.csv"))):
        d = pd.read_csv(f)
        long = []
        for v in ("tmax", "tmin", "prcp"):
            cols = [c for c in d.columns if c.endswith(f"_{v}")]
            m = d[["fid", "year", "month"] + cols].melt(id_vars=["fid", "year", "month"], var_name="c", value_name=v)
            m["day"] = m.c.str[1:3].astype(int)
            long.append(m.drop(columns="c").set_index(["fid", "year", "month", "day"]))
        rows.append(pd.concat(long, axis=1).dropna(how="all").reset_index())
    w = pd.concat(rows, ignore_index=True)
    w["date"] = pd.to_datetime(dict(year=w.year, month=w.month, day=w.day), errors="coerce")
    w = w.dropna(subset=["date"])
    w["gdd"] = ((w.tmax.clip(upper=30) + w.tmin.clip(lower=10)) / 2 - 10).clip(lower=0)
    w["hot"] = (w.tmax >= 35).astype(int)
    a = w.assign(season=w.date.dt.year)
    b = w[w.date.dt.month >= 10].assign(season=w.date.dt.year + 1)
    x = pd.concat([a, b])
    x["t"] = (x.date - pd.to_datetime(x.season.astype(str) + "-01-01")).dt.days
    x = x[x.t >= -91].drop_duplicates(["fid", "season", "t"]).sort_values(["fid", "season", "t"])
    x["cgdd"] = x.groupby(["fid", "season"]).gdd.cumsum()
    cg = x.set_index(["fid", "season", "t"]).cgdd
    out = idx.copy()
    for name in ("d_greenup", "d_peak", "d_drydown"):
        t = ph[name].round().fillna(-999).astype(int).values
        out[f"gdd_at_{name[2:]}"] = cg.reindex(pd.MultiIndex.from_arrays([idx.fid, idx.year, t])).values
    seas = x.groupby(["fid", "season"])
    tt = x.t
    def s(mask, col, fn):
        return x[mask].groupby(["fid", "season"])[col].agg(fn)
    agg = pd.DataFrame({"gdd_year": s((tt >= 0) & (tt < 365), "gdd", "sum"),
                        "gdd_to_may": s((tt >= 0) & (tt < 151), "gdd", "sum"),
                        "rain_fall_winter": s(tt < 90, "prcp", "sum"), "rain_spring": s((tt >= 90) & (tt < 181), "prcp", "sum"),
                        "rain_summer": s((tt >= 181) & (tt < 273), "prcp", "sum"), "hot_days": s(tt >= 0, "hot", "sum")})
    agg.index.names = ["fid", "year"]
    return out.merge(agg.reset_index(), on=["fid", "year"], how="left")


def main():
    cache = OUT / "dense_cache.pkl"
    if cache.exists():
        idx, S, st = pd.read_pickle(cache)
    else:
        s = scenes()
        idx, S, st = dense(s)
        pd.to_pickle((idx, S, st), cache)
    print(f"dense series: {S.shape} (field-years, channels ndvi/ndti/bsi/ndre, 10-day steps)", flush=True)
    ph = phenology(S)
    flat = pd.DataFrame(S[:, :3, :].reshape(len(S), -1),
                        columns=[f"{v}_t{t:+d}" for v in IDX for t in GRID])
    re_ = pd.DataFrame(S[:, 3, ::3], columns=[f"ndre_t{t:+d}" for t in GRID[::3]])
    wx = weather(idx, ph)
    feats = pd.concat([idx, flat, re_, ph, st], axis=1).merge(wx, on=["fid", "year"], how="left")
    feats.to_pickle(OUT / "features_v2.pkl")
    np.savez_compressed(OUT / "series.npz", S=S, fid=idx.fid.values, year=idx.year.values)
    print(f"features_v2: {feats.shape[0]:,} field-years x {feats.shape[1]} columns; median views/year "
          f"{st.n_views.median():.0f} (1985-2012: {st.n_views[idx.year < 2013].median():.0f}, 2013+: {st.n_views[idx.year >= 2013].median():.0f})")


if __name__ == "__main__":
    main()
