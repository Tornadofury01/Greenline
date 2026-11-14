"""Shared loading and helpers for the SI models. No model code here."""
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
FIELDS = HERE.parent / "data" / "fields"
DATA = HERE.parent / "data"
RESULTS = HERE / "results"
RESULTS.mkdir(exist_ok=True)
SEED = 0
# Harmonization experiments (docs/landsat-harmonization-results.md): point the models at another Landsat table
# and write results under a suffix, so the default results are never overwritten. Defaults = current behavior.
import os  # noqa: E402
LANDSAT_CSV = os.environ.get("GREENLINE_LANDSAT_CSV", "landsat_monthly.csv")
RESULTS_SUFFIX = os.environ.get("GREENLINE_RESULTS_SUFFIX", "")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August",
               "September", "October", "November", "December"]

# CDL code -> model class. Ids match /content/crops.json where one exists.
# Double crops (26, 225-254) and fallow (61) are their own classes: the app needs those years flagged.
CDL_GROUP = {1: "corn", 2: "cotton", 4: "grain_sorghum", 5: "soybeans", 24: "winter_wheat",
             21: "small_grain", 23: "small_grain", 27: "small_grain", 28: "small_grain", 29: "small_grain",
             61: "fallow"}
DOUBLE = set([26]) | set(range(225, 255))


def cdl_group(code):
    if code in DOUBLE:
        return "double_crop"
    return CDL_GROUP.get(int(code), "other")


def load_cdl():
    c = pd.read_csv(FIELDS / "cdl.csv")
    c["cls"] = c.code.map(cdl_group)
    return c


def load_landsat():
    """Monthly Landsat per field, gaps filled by linear interpolation along each field's
    continuous monthly series (max 2 missing months in a row). Adds `filled` flags."""
    d = pd.read_csv(FIELDS / LANDSAT_CSV).sort_values(["fieldId", "year", "month"])
    out = []
    for fid, g in d.groupby("fieldId"):
        g = g.copy()
        for b in ("ndvi", "ndti", "bsi"):
            g[b + "_raw"] = g[b]
            g[b] = g[b].interpolate(limit=2, limit_area="inside")
        out.append(g)
    d = pd.concat(out)
    d["filled"] = d.ndvi_raw.isna() & d.ndvi.notna()
    return d


def daily_curve(monthly_vals):
    """12 monthly values (mid-month) -> 365 daily values by linear interpolation, clamped at the ends."""
    mid = np.array([15, 45, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349])
    v = np.asarray(monthly_vals, dtype=float)
    ok = ~np.isnan(v)
    if ok.sum() < 2:
        return np.full(365, np.nan)
    return np.interp(np.arange(365), mid[ok], v[ok])
