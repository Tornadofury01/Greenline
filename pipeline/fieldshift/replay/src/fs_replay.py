"""
Field Shift: season replay engine
=================================

Runs each candidate rotation through every past season of real weather, then
through the same seasons adjusted to today's climate and to NASA's 2040
projections (NEX-GDDP-CMIP6).

For every rotation and every season it computes, day by day:
  * soil water (FAO-56 water balance with Penman-Monteith reference ET)
  * crop water stress and a relative yield (FAO-33 yield response factor Ky)
  * frost and heat hits in each crop's sensitive weeks
  * whether a cover crop got enough rain to establish
  * green / residue / bare state of the soil (same three states as Model 1)
  * soil loss (RUSLE with daily erosivity and a daily cover factor)
  * nitrogen fixed by legume covers

Every number in CROPS, ROTATIONS and DEFAULTS is a starting value from FAO-56,
FAO-33, TR-55 and RUSLE. They are meant to be reviewed with Texas A&M AgriLife
or your local NRCS office. Nothing here is a full crop simulator (DSSAT, APSIM).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# 1. Settings
# ---------------------------------------------------------------------------

DEFAULTS = dict(
    lat=32.25,               # demo field (Ellis County, TX)
    elevation_m=150.0,
    profile_depth_m=1.5,     # soil depth the water balance tracks
    baseline_years=(1991, 2020),
    r_factor_us=300.0,       # mean annual rain erosivity, US units. ASSUMPTION:
                             # approximate Blackland Prairie value; replace with
                             # the RUSLE2 climate value for your county.
    slope_length_m=60.0,
    support_practice_p=1.0,  # 1.0 = no contouring or terracing
    heat_day_c=35.0,         # "heat day" for year types (95 F)
    recent_years=15,         # "last 15 years" view
    future_center_year=2040,
    till_after_harvest_days=30,  # conventional tillage pass after harvest
    detrend_base_year=2000,  # centre of the CMIP6 historical baseline 1985-2014
)

# Crop table. Days are stage lengths (FAO-56 Table 11 style); Kc from FAO-56
# Table 12; Ky from FAO-33. Windows are days after planting.
CROPS = {
    "winter_wheat": dict(
        label="Winter wheat", kind="cash", family="grass", plant=(10, 15),
        stages=(30, 130, 40, 30), kc=(0.70, 1.15, 0.30), p=0.55, ky=1.0,
        fc_max=0.90, fc_end=0.6, height_m=0.5, close_seeded=True,
        residue=0.75, n_fix_lb=0,
        frost=dict(window=(150, 195), tmin_c=-2.0, penalty=0.30),
        heat=dict(window=(190, 220), tmax_c=34.0),
        establish=None),
    "corn": dict(
        label="Corn", kind="cash", family="grass", plant=(3, 15),
        stages=(25, 40, 45, 35), kc=(0.30, 1.20, 0.35), p=0.55, ky=1.25,
        fc_max=0.90, fc_end=0.7, height_m=1.0, close_seeded=False,
        residue=0.85, n_fix_lb=0,
        frost=dict(window=(25, 60), tmin_c=-1.0, penalty=0.25),
        heat=dict(window=(65, 85), tmax_c=35.0),
        establish=None),
    "sorghum": dict(
        label="Grain sorghum", kind="cash", family="grass", plant=(4, 1),
        stages=(20, 35, 40, 30), kc=(0.30, 1.05, 0.55), p=0.55, ky=0.9,
        fc_max=0.85, fc_end=0.7, height_m=0.8, close_seeded=False,
        residue=0.70, n_fix_lb=0,
        frost=dict(window=(10, 50), tmin_c=0.0, penalty=0.20),
        heat=dict(window=(55, 75), tmax_c=38.0),
        establish=None),
    "cotton": dict(
        label="Cotton", kind="cash", family="mallow", plant=(5, 1),
        stages=(30, 50, 55, 25), kc=(0.35, 1.15, 0.60), p=0.65, ky=0.85,
        fc_max=0.85, fc_end=0.5, height_m=0.6, close_seeded=False,
        residue=0.25, n_fix_lb=0,
        frost=dict(window=(7, 40), tmin_c=1.0, penalty=0.25),
        heat=dict(window=(60, 110), tmax_c=38.0),
        establish=None),
    "soybean_dc": dict(
        label="Double-crop soybean", kind="cash", family="legume", plant=(6, 12),
        stages=(15, 25, 45, 30), kc=(0.40, 1.15, 0.50), p=0.50, ky=0.85,
        fc_max=0.85, fc_end=0.5, height_m=0.3, close_seeded=True,
        residue=0.35, n_fix_lb=0,   # grain removes most fixed N
        frost=dict(window=(7, 40), tmin_c=-1.0, penalty=0.30),
        heat=dict(window=(40, 70), tmax_c=35.0),
        establish=dict(days=21, rain_mm=25.0, poor_stand_yield=0.5)),
    "cowpea_cover": dict(
        label="Cowpea cover (summer)", kind="cover", family="legume", plant=(6, 15),
        stages=(15, 25, 30, 8), kc=(0.40, 1.05, 0.90), p=0.45, ky=None,
        fc_max=0.80, fc_end=0.8, height_m=0.2, close_seeded=True,
        residue=0.60, n_fix_lb=80,
        frost=dict(window=(0, 999), tmin_c=0.0, kill=True),
        heat=None,
        establish=dict(days=21, rain_mm=25.0)),
    "cereal_rye_cover": dict(
        label="Cereal rye cover (winter)", kind="cover", family="grass", plant=(10, 20),
        stages=(20, 60, 60, 6), kc=(0.40, 1.00, 1.00), p=0.55, ky=None,
        fc_max=0.85, fc_end=0.85, height_m=0.2, close_seeded=True,
        residue=0.90, n_fix_lb=0,
        frost=None, heat=None,
        establish=dict(days=21, rain_mm=15.0)),
    "crimson_clover_cover": dict(
        label="Crimson clover cover (winter)", kind="cover", family="legume", plant=(10, 1),
        stages=(25, 70, 70, 17), kc=(0.40, 1.00, 1.00), p=0.50, ky=None,
        fc_max=0.80, fc_end=0.8, height_m=0.2, close_seeded=True,
        residue=0.60, n_fix_lb=90,
        frost=dict(window=(0, 40), tmin_c=-12.0, kill=True),
        heat=None,
        establish=dict(days=21, rain_mm=20.0)),
}

# A rotation repeats every `cycle` years. Each planting is (crop, year offset in
# the cycle). "current" is the farmer's existing rotation: replace it with the
# rotation Model 1 finds for the field.
ROTATIONS = {
    "current": dict(
        label="Current: wheat, bare summer", cycle=1, tillage="conventional",
        plantings=[("winter_wheat", 0)]),
    "wheat_cowpea": dict(
        label="Wheat + summer cowpea cover", cycle=1, tillage="no-till",
        plantings=[("cowpea_cover", 0), ("winter_wheat", 0)]),
    "wheat_soy": dict(
        label="Wheat + double-crop soybean", cycle=1, tillage="no-till",
        plantings=[("soybean_dc", 0), ("winter_wheat", 0)]),
    "corn_wheat_soy": dict(
        label="Corn, wheat, double-crop soybean (2 yr)", cycle=2, tillage="no-till",
        plantings=[("corn", 0), ("winter_wheat", 0), ("soybean_dc", 1)]),
    "sorghum_rye": dict(
        label="Sorghum + winter rye cover", cycle=1, tillage="no-till",
        plantings=[("sorghum", 0), ("cereal_rye_cover", 0)]),
    "sorghum_clover": dict(
        label="Sorghum + crimson clover cover", cycle=1, tillage="no-till",
        plantings=[("sorghum", 0), ("crimson_clover_cover", 0)]),
    "sorghum_wheat_cowpea": dict(
        label="Sorghum, wheat, cowpea cover (2 yr)", cycle=2, tillage="no-till",
        plantings=[("sorghum", 0), ("winter_wheat", 0), ("cowpea_cover", 1)]),
}

# How the robustness check ranks rotations. Change to the farmer's priorities.
PRIORITY_WEIGHTS = dict(
    soil_cover=0.25,        # fewer bare days
    erosion=0.25,           # less soil loss
    crop_output=0.20,       # harvests x relative yield, typical year
    bad_year_output=0.20,   # same, worst 10% of years
    nitrogen=0.10,          # N fixed by legume covers
)

# SCS curve numbers (TR-55), by hydrologic soil group A-D.
CURVE_NUMBERS = {
    "bare":    dict(A=77, B=86, C=91, D=94),
    "residue": dict(A=74, B=83, C=88, D=90),
    "row":     dict(A=67, B=78, C=85, D=89),
    "close":   dict(A=63, B=75, C=83, D=87),
}


# ---------------------------------------------------------------------------
# 2. Weather: reference ET, year types, warming trend, future scenarios
# ---------------------------------------------------------------------------

WEATHER_COLS = ["tmax", "tmin", "rain", "rh", "wind", "srad"]


def et0_penman_monteith(w: pd.DataFrame, lat: float, elevation_m: float) -> np.ndarray:
    """FAO-56 daily reference ET (mm/day). Needs tmax, tmin (C), rh (%),
    wind (m/s at 2 m) and srad (MJ/m2/day)."""
    tmax, tmin = w.tmax.values, w.tmin.values
    t = (tmax + tmin) / 2
    u2, rs = w.wind.values, w.srad.values
    e_s = lambda x: 0.6108 * np.exp(17.27 * x / (x + 237.3))
    es = (e_s(tmax) + e_s(tmin)) / 2
    ea = es * np.clip(w.rh.values, 1, 100) / 100
    delta = 4098 * e_s(t) / (t + 237.3) ** 2
    pres = 101.3 * ((293 - 0.0065 * elevation_m) / 293) ** 5.26
    gamma = 0.000665 * pres
    j = w.index.dayofyear.values
    phi = math.radians(lat)
    dr = 1 + 0.033 * np.cos(2 * np.pi * j / 365)
    dec = 0.409 * np.sin(2 * np.pi * j / 365 - 1.39)
    ws = np.arccos(np.clip(-math.tan(phi) * np.tan(dec), -1, 1))
    ra = 24 * 60 / np.pi * 0.082 * dr * (ws * math.sin(phi) * np.sin(dec)
                                         + math.cos(phi) * np.cos(dec) * np.sin(ws))
    rso = (0.75 + 2e-5 * elevation_m) * ra
    rns = 0.77 * rs
    ratio = np.clip(rs / np.maximum(rso, 0.1), 0.25, 1.0)
    rnl = 4.903e-9 * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2 \
        * (0.34 - 0.14 * np.sqrt(ea)) * (1.35 * ratio - 0.35)
    rn = rns - rnl
    et0 = (0.408 * delta * rn + gamma * 900 / (t + 273) * u2 * (es - ea)) \
        / (delta + gamma * (1 + 0.34 * u2))
    return np.maximum(et0, 0.0)


def prepare_weather(w: pd.DataFrame, cfg: dict = DEFAULTS) -> pd.DataFrame:
    """Checks columns, fills short gaps, adds et0."""
    missing = [c for c in WEATHER_COLS if c not in w.columns]
    if missing:
        raise ValueError(f"weather is missing columns {missing}")
    w = w[WEATHER_COLS].copy().sort_index()
    w.index = pd.to_datetime(w.index)
    w = w.asfreq("D")
    w["rain"] = w["rain"].fillna(0.0).clip(lower=0)
    w = w.interpolate(limit=7).ffill().bfill()
    w["et0"] = et0_penman_monteith(w, cfg["lat"], cfg["elevation_m"])
    return w


def year_types(w: pd.DataFrame, cfg: dict = DEFAULTS, model3_labels: pd.Series | None = None) -> pd.DataFrame:
    """Labels each calendar year drought / wet / heat-wave / normal.

    Placeholder for Model 3: simple z-score rules on rain and heat days. If
    Model 3 labels are available, pass them as a Series indexed by year and
    they are used instead."""
    y = pd.DataFrame({
        "rain_mm": w.rain.resample("YS").sum(),
        "warm_rain_mm": w.rain[w.index.month.isin([5, 6, 7, 8, 9])].resample("YS").sum(),
        "heat_days": (w.tmax > cfg["heat_day_c"]).resample("YS").sum(),
    })
    y.index = y.index.year
    b0, b1 = cfg["baseline_years"]
    base = y.loc[b0:b1] if len(y.loc[b0:b1]) >= 10 else y
    z = (y - base.mean()) / base.std(ddof=0)
    t = np.where((z.warm_rain_mm < -0.8) | (z.rain_mm < -1.0), "drought",
        np.where(z.heat_days > 0.8, "heat-wave",
        np.where(z.rain_mm > 0.8, "wet", "normal")))
    y["year_type"] = t
    if model3_labels is not None:
        y["year_type"] = model3_labels.reindex(y.index).fillna(pd.Series(t, index=y.index))
    y[["z_rain", "z_warm_rain", "z_heat"]] = z[["rain_mm", "warm_rain_mm", "heat_days"]].round(2).values
    return y


def warming_trend(w: pd.DataFrame) -> dict:
    """Linear trend of annual mean tmax and tmin, C per year."""
    a = w[["tmax", "tmin"]].resample("YS").mean()
    a = a[w.resample("YS").size() >= 360]
    yrs = a.index.year.values
    return {c: float(np.polyfit(yrs, a[c].values, 1)[0]) for c in ["tmax", "tmin"]}


def shift_to_year(w: pd.DataFrame, trend: dict, to_year: int, cfg: dict = DEFAULTS) -> pd.DataFrame:
    """Moves every year's temperatures to `to_year` along the observed trend
    ("1998 replayed with today's heat"). Rain is left as observed."""
    out = w.copy()
    gap = to_year - out.index.year.values
    out["tmax"] = out.tmax + trend["tmax"] * gap
    out["tmin"] = out.tmin + trend["tmin"] * gap
    out["et0"] = et0_penman_monteith(out, cfg["lat"], cfg["elevation_m"])
    return out


def apply_delta(w_base: pd.DataFrame, delta: pd.DataFrame, cfg: dict = DEFAULTS) -> pd.DataFrame:
    """Delta-change method: observed weather (already moved to the CMIP6
    baseline year) plus each month's change between the model's 1985-2014
    climate and its 2030-2050 climate. Keeps the real day-to-day pattern of
    each past season. `delta` has columns month, dtmax, dtmin, pr_ratio."""
    d = delta.set_index("month")
    m = w_base.index.month
    out = w_base.copy()
    out["tmax"] = out.tmax + d.dtmax.reindex(m).values
    out["tmin"] = out.tmin + d.dtmin.reindex(m).values
    out["rain"] = out.rain * d.pr_ratio.reindex(m).clip(0.5, 2.0).values
    out["et0"] = et0_penman_monteith(out, cfg["lat"], cfg["elevation_m"])
    return out


def cmip6_deltas(monthly: pd.DataFrame) -> pd.DataFrame:
    """Turns the Earth Engine export (model, scenario, month, tasmax, tasmin,
    pr; scenario 'historical' plus future ones) into per-model monthly deltas."""
    h = monthly[monthly.scenario == "historical"].set_index(["model", "month"])
    rows = []
    for scen in sorted(set(monthly.scenario) - {"historical"}):
        f = monthly[monthly.scenario == scen].set_index(["model", "month"])
        common = f.index.intersection(h.index)
        d = pd.DataFrame({
            "dtmax": f.loc[common, "tasmax"] - h.loc[common, "tasmax"],
            "dtmin": f.loc[common, "tasmin"] - h.loc[common, "tasmin"],
            "pr_ratio": f.loc[common, "pr"] / h.loc[common, "pr"].replace(0, np.nan),
        }).reset_index()
        d["scenario"] = scen
        rows.append(d)
    out = pd.concat(rows, ignore_index=True)
    out["pr_ratio"] = out.pr_ratio.fillna(1.0)
    complete = out.groupby(["scenario", "model"]).month.transform("nunique") == 12
    return out[complete]


# ---------------------------------------------------------------------------
# 3. Soil and slope
# ---------------------------------------------------------------------------

def soil_params(clay: float, sand: float, org_carbon_pct: float, slope_pct: float,
                cfg: dict = DEFAULTS) -> dict:
    """Available water, evaporation layer, hydrologic group, RUSLE K and LS."""
    clay, sand = float(clay), float(sand)
    silt = max(0.0, 100 - clay - sand)
    if clay >= 40:
        awc, rew, tew, tex = 0.16, 10, 28, "clay"
    elif clay >= 27:
        awc, rew, tew, tex = 0.17, 9, 24, "clay loam"
    elif sand >= 70:
        awc, rew, tew, tex = 0.08, 6, 12, "sand / loamy sand"
    elif sand >= 50:
        awc, rew, tew, tex = 0.12, 8, 18, "sandy loam"
    else:
        awc, rew, tew, tex = 0.18, 9, 22, "loam / silt loam"
    hsg = "D" if clay >= 40 else "C" if clay >= 20 else "A" if sand >= 70 else "B"

    # RUSLE K (Williams 1995, EPIC), converted to SI: t ha h / (ha MJ mm)
    sn = 1 - sand / 100
    oc = max(org_carbon_pct, 0.0)
    f_sand = 0.2 + 0.3 * math.exp(-0.256 * sand * (1 - silt / 100))
    f_clsi = (silt / max(clay + silt, 1e-6)) ** 0.3
    f_orgc = 1 - 0.25 * oc / (oc + math.exp(3.72 - 2.95 * oc))
    f_hisand = 1 - 0.7 * sn / (sn + math.exp(-5.51 + 22.9 * sn))
    k_us = f_sand * f_clsi * f_orgc * f_hisand
    k_si = k_us * 0.1317

    # LS (Wischmeier and Smith)
    s = slope_pct / 100
    theta = math.atan(s)
    m = 0.5 if slope_pct >= 5 else 0.4 if slope_pct >= 3.5 else 0.3 if slope_pct >= 1 else 0.2
    ls = (cfg["slope_length_m"] / 22.13) ** m * (65.41 * math.sin(theta) ** 2
                                                 + 4.56 * math.sin(theta) + 0.065)
    taw = awc * cfg["profile_depth_m"] * 1000
    return dict(clay=clay, sand=sand, silt=silt, org_carbon_pct=oc, slope_pct=slope_pct,
                texture=tex, hsg=hsg, awc=awc, taw_mm=taw, rew=rew, tew=tew,
                k_si=k_si, ls=ls, p=cfg["support_practice_p"])


def erosivity_scale(w_obs: pd.DataFrame, cfg: dict = DEFAULTS) -> float:
    """Daily erosivity uses Richardson et al. (1983): EI = a * P^1.81 for rain
    >= 12.7 mm. The scale is calibrated once on observed weather so the mean
    annual R matches cfg['r_factor_us']; future scenarios reuse the same scale,
    so wetter or stormier seasons raise erosivity."""
    raw = _raw_ei(w_obs)
    yearly = pd.Series(raw, index=w_obs.index).resample("YS").sum()
    r_si = cfg["r_factor_us"] * 17.02
    return float(r_si / yearly.mean()) if yearly.mean() > 0 else 0.0


def _raw_ei(w: pd.DataFrame) -> np.ndarray:
    p = w.rain.values
    warm = np.isin(w.index.month.values, [4, 5, 6, 7, 8, 9])
    a = np.where(warm, 1.0, 0.7)        # warm-season storms are more intense
    return np.where(p >= 12.7, a * p ** 1.81, 0.0)


# ---------------------------------------------------------------------------
# 4. Rotation schedule
# ---------------------------------------------------------------------------

@dataclass
class Planting:
    crop: str
    start: date
    end: date
    tillage: str


def build_schedule(rotation: dict, first_year: int, last_year: int, phase: int = 0) -> list[Planting]:
    """Lays the rotation over the calendar. `phase` shifts which crop of a
    multi-year rotation lands in which year, so every year sees every phase."""
    cyc = rotation["cycle"]
    out = []
    for y0 in range(first_year - cyc - 1 + phase, last_year + 1, cyc):
        for crop, off in rotation["plantings"]:
            c = CROPS[crop]
            yr = y0 + off
            try:
                start = date(yr, *c["plant"])
            except ValueError:
                continue
            end = start + timedelta(days=sum(c["stages"]))
            if end.year >= first_year and start.year <= last_year:
                out.append(Planting(crop, start, end, rotation["tillage"]))
    out.sort(key=lambda p: p.start)
    for a, b in zip(out, out[1:]):
        if b.start < a.end:
            raise ValueError(f"{rotation['label']}: {CROPS[b.crop]['label']} planted "
                             f"{b.start} before {CROPS[a.crop]['label']} ends {a.end}")
    return out


def check_rotations(rotations: dict = ROTATIONS):
    for r in rotations.values():
        build_schedule(r, 2000, 2004, 0)
    return True


# ---------------------------------------------------------------------------
# 5. Daily simulation
# ---------------------------------------------------------------------------

def _kc_fc(c: dict, dap: int) -> tuple[float, float]:
    li, ld, lm, ll = c["stages"]
    k_ini, k_mid, k_end = c["kc"]
    fmax = c["fc_max"]
    if dap < li:
        return k_ini, fmax * 0.1 * dap / li
    if dap < li + ld:
        x = (dap - li) / ld
        return k_ini + x * (k_mid - k_ini), fmax * (0.1 + 0.9 * x)
    if dap < li + ld + lm:
        return k_mid, fmax
    x = min(1.0, (dap - li - ld - lm) / ll)
    return k_mid + x * (k_end - k_mid), fmax * (1 - x * (1 - c["fc_end"]))


def simulate(w: pd.DataFrame, schedule: list[Planting], soil: dict, ei_scale: float,
             spinup_until: date | None = None, cfg: dict = DEFAULTS):
    """Runs the daily water balance, cover and erosion for one rotation.

    Returns (daily DataFrame, plantings DataFrame)."""
    n = len(w)
    dates = w.index.date
    rain, et0 = w.rain.values, w.et0.values
    tmax, tmin = w.tmax.values, w.tmin.values
    tmean = (tmax + tmin) / 2
    ei = _raw_ei(w) * ei_scale
    day0 = dates[0]

    # which planting is active each day
    active = np.full(n, -1)
    for i, pl in enumerate(schedule):
        a = max(0, (pl.start - day0).days)
        b = min(n, (pl.end - day0).days)
        if b > a:
            active[a:b] = i

    taw, rew, tew = soil["taw_mm"], soil["rew"], soil["tew"]
    cn = {k: v[soil["hsg"]] for k, v in CURVE_NUMBERS.items()}
    k_ls_p = soil["k_si"] * soil["ls"] * soil["p"]

    # conventional tillage also disks the field ~30 days after each harvest
    till_days = set()
    for pl in schedule:
        if pl.tillage == "conventional":
            d = (pl.end - day0).days + cfg.get("till_after_harvest_days", 30)
            if 0 <= d < n and active[d] == -1:
                till_days.add(d)

    W = 0.6 * taw        # profile water (mm)
    De = 0.5 * tew       # evaporation-layer depletion (mm)
    residue = 0.3        # fraction of ground covered by residue
    recent_rain = 0.0

    out = {k: np.zeros(n) for k in ["et", "runoff", "drain", "soil_water", "fc", "residue",
                                    "c_factor", "soil_loss", "ks"]}
    state = np.empty(n, dtype=object)
    rec = [dict(cum_etc=0.0, cum_eta=0.0, established=None, dead=False, frost_hit=False,
                heat_days=0, rain_early=0.0, f_start=None) for _ in schedule]

    for t in range(n):
        p_i = active[t]
        recent_rain = recent_rain * 0.8 + rain[t]
        if t in till_days:
            residue *= 0.3
        fc = 0.0
        crop_on = False
        if p_i >= 0 and not rec[p_i]["dead"]:
            pl, r = schedule[p_i], rec[p_i]
            c = CROPS[pl.crop]
            dap = (dates[t] - pl.start).days
            if dap == 0:
                r["f_start"] = 1 - W / taw
                if pl.tillage == "conventional":
                    residue *= 0.4
            if c["establish"] and dap < c["establish"]["days"]:
                r["rain_early"] += rain[t]
            if c["establish"] and dap == c["establish"]["days"] and r["established"] is None:
                ok = r["rain_early"] >= c["establish"]["rain_mm"] or (r["f_start"] or 1) < 0.35
                r["established"] = bool(ok)
                if not ok and c["kind"] == "cover":
                    r["dead"] = True
            fr = c.get("frost")
            if fr and fr["window"][0] <= dap <= fr["window"][1] and tmin[t] < fr["tmin_c"]:
                if fr.get("kill"):
                    r["dead"] = True
                r["frost_hit"] = True
            ht = c.get("heat")
            if ht and ht["window"][0] <= dap <= ht["window"][1] and tmax[t] > ht["tmax_c"]:
                r["heat_days"] += 1
            if not r["dead"]:
                crop_on = True
                kc, fc = _kc_fc(c, dap)
                f_dep = 1 - W / taw
                ks = 1.0 if f_dep <= c["p"] else max(0.0, (1 - f_dep) / (1 - c["p"]))
                etc = kc * et0[t]
                eta = min(ks * etc, W)
                r["cum_etc"] += etc
                r["cum_eta"] += eta
                growth = r["cum_eta"] / r["cum_etc"] if r["cum_etc"] > 0 else 1.0
                fc *= max(0.3, growth)
                out["ks"][t] = ks
                et = eta
        if not crop_on:
            out["ks"][t] = np.nan
            kr = 1.0 if De <= rew else max(0.0, (tew - De) / (tew - rew))
            et = min(kr * 1.05 * et0[t] * (1 - 0.5 * residue), W)

        # cover state and runoff
        close = crop_on and CROPS[schedule[p_i].crop]["close_seeded"]
        ground = min(1.0, residue + (0.6 if close else 0.2) * fc)
        if fc >= 0.3:
            st, cn_t = "green", cn["close"] if close else cn["row"]
        elif ground >= 0.3:
            st, cn_t = "residue", cn["residue"]
        else:
            st, cn_t = "bare", cn["bare"]
        s = 25400 / cn_t - 254
        q = (rain[t] - 0.2 * s) ** 2 / (rain[t] + 0.8 * s) if rain[t] > 0.2 * s else 0.0

        W = W + rain[t] - q - et
        drain = max(0.0, W - taw)
        W = min(max(W, 0.0), taw)
        De = min(max(De - (rain[t] - q) + et, 0.0), tew)

        # RUSLE daily: canopy subfactor x surface-cover subfactor
        h = CROPS[schedule[p_i].crop]["height_m"] if crop_on else 0.0
        cc = 1 - fc * math.exp(-0.34 * h)
        sc = math.exp(-3.5 * ground)
        c_t = cc * sc
        out["et"][t], out["runoff"][t], out["drain"][t] = et, q, drain
        out["soil_water"][t], out["fc"][t], out["residue"][t] = W, fc, residue
        out["c_factor"][t], out["soil_loss"][t] = c_t, ei[t] * k_ls_p * c_t
        state[t] = st

        # end of a planting: harvest or termination leaves residue
        if p_i >= 0 and (t + 1 == n or active[t + 1] != p_i):
            pl, r = schedule[p_i], rec[p_i]
            if (dates[t] + timedelta(days=1)) >= pl.end and not r["dead"]:
                growth = r["cum_eta"] / r["cum_etc"] if r["cum_etc"] > 0 else 0
                residue = max(residue, CROPS[pl.crop]["residue"] * min(1.0, 0.4 + 0.6 * growth))

        # residue decay: faster when warm and wet
        k = 0.004 * 2 ** ((tmean[t] - 20) / 10) * (1.0 if recent_rain > 5 else 0.5)
        residue *= math.exp(-k)

    daily = pd.DataFrame(out, index=w.index)
    daily["state"] = state

    rows = []
    for pl, r in zip(schedule, rec):
        if spinup_until and pl.end <= spinup_until:
            continue
        if (pl.end - day0).days > n:
            continue  # season not finished in the record
        c = CROPS[pl.crop]
        ratio = r["cum_eta"] / r["cum_etc"] if r["cum_etc"] > 0 else 0.0
        rel = np.nan
        if c["kind"] == "cash":
            rel = max(0.0, 1 - c["ky"] * (1 - ratio))
            if r["frost_hit"]:
                rel *= 1 - c["frost"]["penalty"]
            rel *= max(0.7, 1 - 0.03 * r["heat_days"])
            if c["establish"] and r["established"] is False:
                rel *= c["establish"]["poor_stand_yield"]
        n_fix = c["n_fix_lb"] * min(1.0, ratio) if not r["dead"] else 0.0
        rows.append(dict(
            crop=pl.crop, crop_label=c["label"], kind=c["kind"], start=pl.start, end=pl.end,
            season_year=pl.end.year, water_need_mm=round(r["cum_etc"], 1),
            water_used_mm=round(r["cum_eta"], 1),
            water_short_mm=round(r["cum_etc"] - r["cum_eta"], 1),
            water_ratio=round(ratio, 3), rel_yield=rel,
            established=r["established"] if c["establish"] else True,
            killed=r["dead"], frost_hit=r["frost_hit"], heat_days=r["heat_days"],
            n_fixed_lb=round(n_fix, 1)))
    return daily, pd.DataFrame(rows)


def yearly_from_daily(daily: pd.DataFrame, plant_df: pd.DataFrame) -> pd.DataFrame:
    g = daily.groupby(daily.index.year)
    y = pd.DataFrame({
        "bare_days": g.state.apply(lambda s: int((s == "bare").sum())),
        "residue_days": g.state.apply(lambda s: int((s == "residue").sum())),
        "green_days": g.state.apply(lambda s: int((s == "green").sum())),
        "soil_loss_t_ha": g.soil_loss.sum(),
        "runoff_mm": g.runoff.sum(),
        "drainage_mm": g.drain.sum(),
        "et_mm": g.et.sum(),
    })
    if len(plant_df):
        cash = plant_df[plant_df.kind == "cash"].groupby("season_year")
        y["harvests"] = cash.size().reindex(y.index).fillna(0).astype(int)
        y["crop_output"] = cash.rel_yield.sum().reindex(y.index).fillna(0.0)
        y["mean_rel_yield"] = cash.rel_yield.mean().reindex(y.index)
        y["n_fixed_lb"] = plant_df.groupby("season_year").n_fixed_lb.sum().reindex(y.index).fillna(0)
        cov = plant_df[plant_df.kind == "cover"]
        if len(cov):
            fail = cov.assign(fail=(~cov.established.astype(bool)) | cov.killed).groupby("season_year")["fail"].any()
            y["cover_failed"] = fail.reindex(y.index)
        else:
            y["cover_failed"] = np.nan
    return y


# ---------------------------------------------------------------------------
# 6. Views: run every rotation through one weather series
# ---------------------------------------------------------------------------

def run_view(w: pd.DataFrame, view: str, soil: dict, ei_scale: float,
             rotations: dict = ROTATIONS, first_result_year: int | None = None,
             cfg: dict = DEFAULTS):
    """All rotations, all phases, one weather series. Returns year and
    planting tables with a `view` column."""
    y0, y1 = w.index.year.min(), w.index.year.max()
    first = first_result_year or y0 + 1          # first year = spin-up
    years, plants = [], []
    for key, rot in rotations.items():
        for phase in range(rot["cycle"]):
            sched = build_schedule(rot, y0, y1, phase)
            daily, pdf = simulate(w, sched, soil, ei_scale, spinup_until=date(first, 1, 1), cfg=cfg)
            yr = yearly_from_daily(daily, pdf).loc[first:]
            yr = yr.assign(rotation=key, phase=phase)
            years.append(yr.rename_axis("year").reset_index())
            if len(pdf):
                plants.append(pdf.assign(rotation=key, phase=phase))
    ydf = pd.concat(years, ignore_index=True).assign(view=view)
    pdf = pd.concat(plants, ignore_index=True).assign(view=view) if plants else pd.DataFrame()
    return ydf, pdf


# ---------------------------------------------------------------------------
# 7. Summaries, robustness check and rotation-card text
# ---------------------------------------------------------------------------

def summarize(ydf: pd.DataFrame, types: pd.DataFrame) -> pd.DataFrame:
    """One row per view x rotation: median, worst 10%, failure rates, and
    results by year type."""
    d = ydf.merge(types[["year_type"]], left_on="year", right_index=True, how="left")
    rows = []
    for (view, rot), g in d.groupby(["view", "rotation"]):
        row = dict(view=view, rotation=rot, years=g.year.nunique(),
                   bare_days_median=g.bare_days.median(),
                   bare_days_worst10=g.bare_days.quantile(0.9),
                   soil_loss_median=g.soil_loss_t_ha.median(),
                   soil_loss_worst10=g.soil_loss_t_ha.quantile(0.9),
                   crop_output_median=g.crop_output.median(),
                   crop_output_worst10=g.crop_output.quantile(0.1),
                   harvests_per_year=g.harvests.mean(),
                   crop_failure_rate=float((g.mean_rel_yield < 0.5).mean()),
                   cover_fail_rate=float(g.cover_failed.dropna().astype(bool).mean())
                   if g.cover_failed.notna().any() else np.nan,
                   n_fixed_median=g.n_fixed_lb.median(),
                   runoff_median=g.runoff_mm.median())
        for t, gt in g.groupby("year_type"):
            row[f"output_{t}"] = gt.crop_output.median()
            row[f"soil_loss_{t}"] = gt.soil_loss_t_ha.median()
        worst = g.groupby("year").crop_output.mean().nsmallest(3)
        row["worst_years"] = ", ".join(str(int(y)) for y in worst.index)
        rows.append(row)
    return pd.DataFrame(rows)


def score_views(summary: pd.DataFrame, weights: dict = PRIORITY_WEIGHTS) -> pd.DataFrame:
    """Scores rotations 0-100 within each view from the farmer's priorities
    (min-max per metric, higher is better), then ranks them."""
    metric = dict(soil_cover=("bare_days_median", -1), erosion=("soil_loss_median", -1),
                  crop_output=("crop_output_median", 1),
                  bad_year_output=("crop_output_worst10", 1),
                  nitrogen=("n_fixed_median", 1))
    out = []
    for view, g in summary.groupby("view"):
        g = g.copy()
        total = np.zeros(len(g))
        for k, wgt in weights.items():
            col, sign = metric[k]
            v = g[col].values * sign
            rng = v.max() - v.min()
            total += wgt * ((v - v.min()) / rng if rng > 0 else np.full(len(v), 0.5))
        g["score"] = (100 * total / sum(weights.values())).round(1)
        g["rank"] = g.score.rank(ascending=False, method="min").astype(int)
        out.append(g)
    return pd.concat(out, ignore_index=True)


def robustness(scored: pd.DataFrame, close_call_points: float = 5.0) -> dict:
    """Does the same rotation come out on top in every view?"""
    tops, gaps = {}, {}
    for view, g in scored.groupby("view"):
        g = g.sort_values("score", ascending=False)
        tops[view] = g.rotation.iloc[0]
        gaps[view] = float(g.score.iloc[0] - g.score.iloc[1]) if len(g) > 1 else 100.0
    winners = set(tops.values())
    close = [v for v, gap in gaps.items() if gap < close_call_points]
    if len(winners) == 1 and not close:
        verdict = "robust"
    elif len(winners) == 1:
        verdict = "same winner, but close in some views"
    else:
        verdict = "close call: the winner changes with the climate view"
    return dict(verdict=verdict, top_by_view=tops, lead_points_by_view=gaps, close_views=close)


def card_lines(summary: pd.DataFrame, rotations: dict = ROTATIONS, view: str = "today",
               future_view: str | None = None, baseline: str = "current") -> dict:
    """Plain-language lines for each rotation card, compared with the
    current rotation."""
    s = summary[summary.view == view].set_index("rotation")
    f = summary[summary.view == future_view].set_index("rotation") if future_view else None
    b = s.loc[baseline]
    cards = {}
    for rot, r in s.iterrows():
        lines = []
        if rot != baseline:
            dbare = b.bare_days_median - r.bare_days_median
            if abs(dbare) >= 5:
                lines.append(f"{abs(dbare):.0f} {'fewer' if dbare > 0 else 'more'} bare days a year than now")
            dloss = b.soil_loss_median - r.soil_loss_median
            if b.soil_loss_median > 0 and abs(dloss) / b.soil_loss_median >= 0.1:
                lines.append(f"about {abs(dloss):.1f} t/ha/yr {'less' if dloss > 0 else 'more'} soil loss "
                             f"({abs(dloss) / b.soil_loss_median:.0%})")
        else:
            lines.append(f"{r.bare_days_median:.0f} bare days and {r.soil_loss_median:.1f} t/ha soil loss in a typical year")
        lines.append(f"Harvests per year: {r.harvests_per_year:.1f}; crop output typical {r.crop_output_median:.2f}, "
                     f"worst 10% of years {r.crop_output_worst10:.2f}")
        if not np.isnan(r.get("cover_fail_rate", np.nan)) and r.cover_fail_rate > 0:
            lines.append(f"Cover crop failed to establish in {r.cover_fail_rate:.0%} of years")
        if r.n_fixed_median > 0:
            lines.append(f"Legume cover fixes about {r.n_fixed_median:.0f} lb N/acre in a typical year")
        if "output_drought" in r and not pd.isna(r.output_drought):
            lines.append(f"In drought-type years crop output {r.output_drought:.2f} (typical {r.crop_output_median:.2f})")
        lines.append(f"Hardest years: {r.worst_years}")
        if f is not None and rot in f.index:
            fr = f.loc[rot]
            lines.append(f"2040 projection: {fr.bare_days_median:.0f} bare days, crop output "
                         f"{fr.crop_output_median:.2f} (worst 10%: {fr.crop_output_worst10:.2f})")
        cards[rot] = dict(label=rotations[rot]["label"], lines=lines)
    return cards
