"""Build smoothed daily series + per field-year features (same logic as the training notebook), cached to pickle."""
import sys, pickle, warnings
import numpy as np, pandas as pd
from scipy.signal import savgol_filter, find_peaks
warnings.filterwarnings("ignore")

MIN_CLEAR = float(sys.argv[1]) if len(sys.argv) > 1 else 0.6
BIN_DAYS = int(sys.argv[2]) if len(sys.argv) > 2 else 16
SMOOTH_DAYS = int(sys.argv[3]) if len(sys.argv) > 3 else 31
MAX_GAP_DAYS = 60
tag = f"c{MIN_CLEAR}_b{BIN_DAYS}_s{SMOOTH_DAYS}"

ts = pd.read_csv("ndvi_timeseries.csv.gz", parse_dates=["date"])
ts = ts[(ts.clear_frac >= MIN_CLEAR) & (ts.snow_frac < 0.1) & ts.ndvi.between(-0.2, 1.0)].dropna(subset=["ndvi"])

def daily_series(g):
    d = g.groupby("date")[["ndvi", "ndti", "bsi"]].median()
    idx = pd.date_range(d.index.min(), d.index.max(), freq="D")
    d = d.reindex(idx).interpolate(limit=MAX_GAP_DAYS, limit_area="inside")
    for c in d.columns:
        ok = d[c].notna()
        if ok.sum() > SMOOTH_DAYS:
            d.loc[ok, c] = savgol_filter(d.loc[ok, c].values, SMOOTH_DAYS, 2)
    return d

daily = {int(f): daily_series(g) for f, g in ts.groupby("field_id")}
N_BINS = int(np.ceil(487 / BIN_DAYS))

def year_features(d, year):
    start, end = pd.Timestamp(year - 1, 9, 1), pd.Timestamp(year, 12, 31)
    w = d.loc[start:end]
    if len(w) < 300 or w.ndvi.notna().mean() < 0.6:
        return None
    b = w.groupby((w.index - start).days // BIN_DAYS).mean().reindex(range(N_BINS)).interpolate(limit_direction="both")
    f = {f"{c}_b{i:02d}": v for c in ["ndvi", "ndti", "bsi"] for i, v in enumerate(b[c].values)}
    nd = d.loc[pd.Timestamp(year, 1, 1):end, "ndvi"].dropna()
    if len(nd) < 200:
        return None
    amp = nd.max() - nd.min()
    above = nd[nd >= nd.min() + 0.5 * amp]
    peaks, _ = find_peaks(nd.values, prominence=0.15, distance=60)
    # extra shape features: monthly means of the calendar year, summer bare-soil and residue summaries
    cy = d.loc[pd.Timestamp(year, 1, 1):end]
    mon = cy.groupby(cy.index.month).mean()
    for m in range(1, 13):
        for c in ["ndvi", "bsi"]:
            f[f"{c}_m{m:02d}"] = mon[c].get(m, np.nan)
    f.update(ndvi_max=nd.max(), ndvi_min=nd.min(), ndvi_mean=nd.mean(), ndvi_amp=amp,
             peak_doy=nd.idxmax().dayofyear, greenup_doy=above.index.min().dayofyear,
             senesce_doy=above.index.max().dayofyear, season_len=(above.index.max() - above.index.min()).days,
             n_peaks=len(peaks),
             ndvi_integral=nd.clip(lower=0).sum() / len(nd),
             summer_bsi=cy.loc[f"{year}-06-15":f"{year}-09-15", "bsi"].mean(),
             winter_ndvi=d.loc[pd.Timestamp(year - 1, 12, 1):pd.Timestamp(year, 2, 28), "ndvi"].mean(),
             fall_prev_ndvi=d.loc[pd.Timestamp(year - 1, 10, 1):pd.Timestamp(year - 1, 11, 30), "ndvi"].mean())
    return f

rows = []
for fid, d in daily.items():
    for year in range(d.index.min().year + 1, d.index.max().year + 1):
        f = year_features(d, year)
        if f:
            rows.append({"field_id": fid, "year": year, **f})
feat = pd.DataFrame(rows)
pickle.dump({"feat": feat, "daily": daily}, open(f"cache_{tag}.pkl", "wb"))
print(tag, "field-years:", len(feat), "features:", feat.shape[1] - 2)
