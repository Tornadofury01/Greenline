"""
Field Shift: planning models and the rotation recommender
=========================================================

Four models built on top of the season replay (fs_replay.py), then one
recommender that combines everything into a scorecard per rotation.

  1. Profit and risk      net return per acre for every replayed season, two price scenarios
  2. Cost-share           NRCS EQIP practices each rotation qualifies for, and the payment
  3. Nitrogen budget      N the crops need, N credits from legumes, fertilizer bought and its cost
  4. Pest and disease     rotation structure (same host every year?) + weather-driven risk per season

  Recommender             scores each rotation 0-100 on six dimensions, weights them by the
                          farmer's priorities, grades the current rotation, recommends the best
                          alternative and checks that the pick holds across climate views, price
                          scenarios and priority presets.

Every number below has a source note. Values marked ASSUMPTION are placeholders
to confirm with Texas A&M AgriLife, NRCS or the farmer.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import fs_replay as fr

# ---------------------------------------------------------------------------
# 1. Economics (per acre)
# ---------------------------------------------------------------------------
# typical_yield: what a normal year produces here, used to calibrate the replay's
#   relative yield (1.0 = no water stress) into bushels.
# variable_cost: Texas A&M AgriLife budget variable costs (includes fertilizer at budget prices).
# fixed_machinery: budget fixed costs without land rent.
ECON = {
    "winter_wheat": dict(unit="bu", typical_yield=48, variable_cost=279.38, fixed_machinery=20.65,
                         src="Texas A&M AgriLife 2024 District 8 HRW wheat budget (48 bu); Ellis Co. NASS 2021-23 avg 48 bu"),
    "corn": dict(unit="bu", typical_yield=74, variable_cost=475.61, fixed_machinery=45.70,
                 src="AgriLife 2024 District 8 reduced-till corn budget; yield = Ellis Co. NASS 2021-23 avg (71, 60, 92)"),
    "sorghum": dict(unit="bu", typical_yield=80, variable_cost=247.82, fixed_machinery=22.36,
                    src="AgriLife 2024 District 8 grain sorghum budget (45 cwt = 80 bu). Ellis Co. NASS shows one "
                        "undated year at 48 bu, likely a dry year"),
    "soybean_dc": dict(unit="bu", typical_yield=25, variable_cost=206.70, fixed_machinery=15.00,
                       src="AgriLife 2025 District 11 dryland soybean budget (30 bu, $6.89/bu variable); "
                           "ASSUMPTION: 25 bu double-crop yield, $15 fixed"),
}

# $/unit. 'low' = 2025/26 marketing-year prices, 'high' = 2026/27 WASDE forecasts.
PRICES = {
    "low":  dict(winter_wheat=5.06, corn=4.15, sorghum=3.55, soybean_dc=10.20),
    "high": dict(winter_wheat=6.20, corn=4.60, sorghum=4.30, soybean_dc=11.40),
}
PRICE_SRC = ("USDA WASDE / ERS: 2025/26 final or latest (wheat $5.06, corn $4.15, sorghum $3.55, soybean $10.20); "
             "2026/27 forecasts (wheat $6.20, corn $4.60, sorghum $4.30, soybean $11.40)")

LAND_RENT = 26.0      # Ellis Co. non-irrigated cropland cash rent, NASS 2023

# Cover crop cost: seed + no-till drill + termination. Seed prices from USDA-ARS (2014-16);
# ASSUMPTION: update with a local seed quote.
COVER_COST = {
    "cowpea_cover": 42.0 + 10 + 10,           # 50 lb Iron Clay cowpea
    "cereal_rye_cover": 31.5 + 10 + 10,       # 90 lb cereal rye
    "crimson_clover_cover": 24.2 + 10 + 10,   # 16 lb crimson clover
}

# ---------------------------------------------------------------------------
# 2. Cost-share (NRCS EQIP, Texas)
# ---------------------------------------------------------------------------
EQIP = {
    "340 Cover Crop": dict(rate=72.19, needs="cover"),
    "329 No-Till": dict(rate=18.12, needs="no-till"),
    "328 Conservation Crop Rotation": dict(rate=12.86, needs="rotation"),
}
EQIP_SRC = "EQIP rates listed by the Texas Climate Smart Initiative (tcsi.tamu.edu); confirm with the Ellis County NRCS office"
EQIP_YEARS = 3        # ASSUMPTION: payments for a 3-year contract, then the rotation stands on its own
# Applications are competitive and not guaranteed; the recommender scores rotations WITHOUT
# cost-share and shows it as a bonus, so a rotation never wins only because of a payment.

# ---------------------------------------------------------------------------
# 3. Nitrogen
# ---------------------------------------------------------------------------
N_PRICE = 0.72        # $/lb N, urea, DTN retail, first week of November 2026
N_NEED = {            # lb N per acre for the typical yield
    "winter_wheat": 1.5 * 48,      # 1.5 lb N/bu (Texas A&M AgriLife)
    "corn": 1.0 * 74,              # 1.0 lb N/bu below 100 bu (Texas A&M AgriLife)
    "sorghum": 2.0 * 80 * 56 / 100,  # 2 lb N per 100 lb grain (Texas A&M AgriLife)
    "soybean_dc": 0.0,             # legume, fixes its own
}
LEGUME_CREDIT_SHARE = 0.5   # ASSUMPTION: half of a legume cover's fixed N is available to the next crop
SOY_RESIDUE_CREDIT = 20.0   # ASSUMPTION: lb N credit to the crop after soybeans

# ---------------------------------------------------------------------------
# 4. Pest and disease
# ---------------------------------------------------------------------------
PEST_NOTES = {
    "wheat_leaf_rust": "Leaf rust: infection best at 59-77 F with rain or heavy dew (Texas A&M AgriLife). "
                       "Index = spring days in that range with moisture.",
    "wheat_continuity": "Wheat every year keeps residue-borne diseases and pests (Hessian fly, tan spot) and the "
                        "summer 'green bridge' for wheat curl mite and wheat streak mosaic going. A non-host summer "
                        "crop or prompt volunteer control breaks it.",
    "sugarcane_aphid": "Sugarcane aphid: thrives in warm, dry weather; mild winters let it overwinter as far north "
                       "as Central Texas; very high summer heat suppresses it.",
    "aflatoxin": "Aflatoxin in corn: drought and heat (especially hot nights) around silking and grain fill.",
    "charcoal_rot": "Charcoal rot in soybean: hot, dry weather during flowering and pod fill.",
    "cotton_root_rot": "Not in these rotations. If cotton is added: Blackland soils favor cotton root rot; "
                       "rotating with grass crops (wheat, corn, sorghum) reduces it.",
}

# ---------------------------------------------------------------------------
# Recommender settings
# ---------------------------------------------------------------------------
# Six dimensions, each scored 0-100 against fixed anchors (not against the other
# rotations), so a grade means the same thing on every field.
ANCHORS = {
    # metric: (value scoring 0, value scoring 100)
    "soil_cover": (180, 0),          # bare days a year
    "erosion": (12.0, 1.0),          # t/ha/yr soil loss
    "profit": (-100, 150),           # $/acre median return above variable costs (no cost-share)
    "resilience": (-250, 0),         # $/acre return above variable costs, worst 10% of seasons
    "nitrogen": (120, 0),            # lb fertilizer N bought per acre per year
    "pest": (80, 10),                # pest and disease risk index
}
DIMENSION_LABELS = {
    "soil_cover": "Soil cover", "erosion": "Erosion", "profit": "Profit",
    "resilience": "Bad-year resilience", "nitrogen": "Nitrogen", "pest": "Pest & disease",
}
PRIORITY_PRESETS = {
    "balanced":     dict(soil_cover=1, erosion=1, profit=1, resilience=1, nitrogen=0.5, pest=0.5),
    "income_first": dict(soil_cover=0.5, erosion=0.5, profit=2, resilience=1, nitrogen=0.5, pest=0.5),
    "soil_first":   dict(soil_cover=2, erosion=2, profit=0.5, resilience=0.5, nitrogen=1, pest=0.5),
    "low_risk":     dict(soil_cover=0.5, erosion=1, profit=0.5, resilience=2, nitrogen=0.5, pest=1),
}


def grade(score: float) -> str:
    return "A" if score >= 80 else "B" if score >= 65 else "C" if score >= 50 else "D" if score >= 35 else "F"


def _anchor_score(value, worst, best):
    return float(np.clip((value - worst) / (best - worst) * 100, 0, 100))


# ---------------------------------------------------------------------------
# Model 1-3: profit, cost-share and nitrogen, one row per rotation-season
# ---------------------------------------------------------------------------

def calibrate_yields(plantings: pd.DataFrame, base_view: str = "all_years") -> dict:
    """Yield at relative yield 1.0, so the median replayed season matches the
    typical local yield."""
    out = {}
    for crop, e in ECON.items():
        r = plantings[(plantings.view == base_view) & (plantings.crop == crop)].rel_yield
        med = r.median() if len(r) else 1.0
        out[crop] = e["typical_yield"] / med if med > 0 else e["typical_yield"]
    return out


def rotation_practices(rot: dict) -> list[str]:
    crops = [c for c, _ in rot["plantings"]]
    cash = {c for c in crops if fr.CROPS[c]["kind"] == "cash"}
    out = []
    if any(fr.CROPS[c]["kind"] == "cover" for c in crops):
        out.append("340 Cover Crop")
    if rot["tillage"] == "no-till":
        out.append("329 No-Till")
    if len(cash) >= 2 or (len(cash) == 1 and any(fr.CROPS[c]["kind"] == "cover" for c in crops)):
        out.append("328 Conservation Crop Rotation")
    return out


def economics(plantings: pd.DataFrame, years: pd.DataFrame, rotations: dict = fr.ROTATIONS) -> pd.DataFrame:
    """Net return, nitrogen and cost-share for every rotation-season, both price scenarios."""
    ypot = calibrate_yields(plantings)
    keys = ["view", "rotation", "phase", "year"] + (["model"] if "model" in years else [])
    p = plantings.copy()
    if "model" not in p:
        p["model"] = np.nan
    y = years.copy()
    if "model" not in y:
        y["model"] = np.nan
    p["model"] = p.model.fillna("obs")
    y["model"] = y.model.fillna("obs")
    keys = ["view", "model", "rotation", "phase", "year"]

    # previous crop of each planting (for N credits)
    p = p.sort_values(keys[:4] + ["start"])
    p["prev_crop"] = p.groupby(keys[:4]).crop.shift(1)
    p["prev_n_fixed"] = p.groupby(keys[:4]).n_fixed_lb.shift(1).fillna(0)
    p["prev_killed"] = p.groupby(keys[:4]).killed.shift(1).fillna(False)

    rows = []
    for _, r in p.iterrows():
        c = r.crop
        rec = {k: r[k] if k != "year" else r.season_year for k in keys}
        if c in ECON:
            e = ECON[c]
            yld = r.rel_yield * ypot[c]
            credit = 0.0
            if r.prev_crop in fr.CROPS and fr.CROPS[r.prev_crop]["kind"] == "cover" and not r.prev_killed:
                credit += LEGUME_CREDIT_SHARE * r.prev_n_fixed
            if r.prev_crop == "soybean_dc":
                credit += SOY_RESIDUE_CREDIT
            need = N_NEED[c]
            credit = min(credit, need)
            rec.update(cash=1, yield_units=yld,
                       rev_low=yld * PRICES["low"][c], rev_high=yld * PRICES["high"][c],
                       var_cost=e["variable_cost"], fixed=e["fixed_machinery"],
                       n_need=need, n_credit=credit, n_bought=need - credit,
                       n_savings=credit * N_PRICE, cover_cost=0.0)
        else:
            rec.update(cash=0, yield_units=0.0, rev_low=0.0, rev_high=0.0, var_cost=0.0, fixed=0.0,
                       n_need=0.0, n_credit=0.0, n_bought=0.0, n_savings=0.0,
                       cover_cost=COVER_COST.get(c, 0.0))
        rows.append(rec)
    e = pd.DataFrame(rows).groupby(keys, dropna=False).sum(numeric_only=True).reset_index()
    e = y[keys].merge(e, on=keys, how="left").fillna(0.0)
    for s in ["low", "high"]:
        # return above variable costs: what changes when the farmer changes rotation
        e[f"ravc_{s}"] = e[f"rev_{s}"] - e.var_cost - e.cover_cost + e.n_savings
        # after machinery fixed costs and land rent
        e[f"net_{s}"] = e[f"ravc_{s}"] - e.fixed - LAND_RENT
    # cost-share: per year during the contract, by practice
    pay = {k: sum(EQIP[pr]["rate"] for pr in rotation_practices(rot)) for k, rot in rotations.items()}
    e["eqip_per_year"] = e.rotation.map(pay)
    return e


def costshare_table(rotations: dict = fr.ROTATIONS) -> pd.DataFrame:
    rows = []
    for k, rot in rotations.items():
        pr = rotation_practices(rot)
        annual = sum(EQIP[x]["rate"] for x in pr)
        rows.append(dict(rotation=k, practices=", ".join(pr) or "none", eqip_per_year=round(annual, 2),
                         eqip_contract_total=round(annual * EQIP_YEARS, 2)))
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Model 4: pest and disease
# ---------------------------------------------------------------------------

def pest_weather_indices(w: pd.DataFrame) -> pd.DataFrame:
    """Year-level weather indices (calendar year of the crop's growing season)."""
    d = w.copy()
    d["tmean"] = (d.tmax + d.tmin) / 2
    m, doy = d.index.month, d.index.dayofyear
    out = {}
    # wheat leaf rust: Mar 1 - May 15, 15-25 C with rain or high humidity
    spring = (doy >= 60) & (doy <= 135)
    out["leaf_rust_days"] = ((d.tmean.between(15, 25)) & ((d.rain >= 1) | (d.rh >= 80)) & spring) \
        .groupby(d.index.year).sum()
    # cold days in the preceding winter (Dec of previous year - Feb)
    winter_year = np.where(m == 12, d.index.year + 1, d.index.year)
    cold = ((d.tmin < -2) & np.isin(m, [12, 1, 2])).groupby(winter_year).sum()
    out["winter_cold_days"] = cold
    # sugarcane aphid: warm dry days mid-May to mid-July; very hot days suppress
    sca_win = (doy >= 135) & (doy <= 196)
    warm_dry = ((d.tmax.between(29, 37)) & (d.rain < 1) & sca_win).groupby(d.index.year).sum()
    out["sca_warm_dry_days"] = warm_dry
    df = pd.DataFrame(out).fillna(0)
    df["sca_index"] = df.sca_warm_dry_days * (1 + 1.0 / (1 + df.winter_cold_days))
    return df


def planting_pest_index(pl: pd.Series, w: pd.DataFrame) -> dict:
    """Crop-specific weather risk for one planting."""
    c = pl.crop
    start = pd.Timestamp(pl.start)
    if c == "corn":
        win = w.loc[start + pd.Timedelta(days=60): start + pd.Timedelta(days=110)]
        heat = int((win.tmax > 35).sum()) + int((win.tmin > 24).sum())
        return {"aflatoxin": heat + 40 * (1 - pl.water_ratio)}
    if c == "soybean_dc":
        win = w.loc[start + pd.Timedelta(days=45): start + pd.Timedelta(days=95)]
        hot_dry = int(((win.tmax > 35) & (win.rain < 1)).sum())
        return {"charcoal_rot": hot_dry + 40 * (1 - pl.water_ratio)}
    return {}


def pest_table(plantings: pd.DataFrame, weather_by_key: dict, rotations: dict = fr.ROTATIONS,
               baseline_key=("all_years", "obs")) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Returns (per rotation-season pest index, per-pest detail).

    Weather indices are turned into 0-100 by their percentile in the observed
    1985-2025 record, so 2040 seasons can score above anything seen so far."""
    base_w = weather_by_key[baseline_key]
    base_year = pest_weather_indices(base_w)
    base_pl = plantings[(plantings.view == baseline_key[0])]
    base_crop = {}
    for _, pl in base_pl.iterrows():
        for k, v in planting_pest_index(pl, base_w).items():
            base_crop.setdefault(k, []).append(v)
    ref = {"leaf_rust": base_year.leaf_rust_days.values, "sugarcane_aphid": base_year.sca_index.values,
           **{k: np.array(v) for k, v in base_crop.items()}}

    def pct(name, v):
        r = ref.get(name)
        if r is None or len(r) == 0:
            return 50.0
        return float((r <= v).mean() * 100)

    struct = {}
    for k, rot in rotations.items():
        crops = [c for c, _ in rot["plantings"]]
        cash = [c for c in crops if fr.CROPS[c]["kind"] == "cash"]
        per_year = {c: cash.count(c) / rot["cycle"] for c in set(cash)}
        repeat = max(per_year.values()) if per_year else 0      # 1.0 = same crop every year
        families = {fr.CROPS[c]["family"] for c in crops}
        broadleaf_break = bool(families - {"grass"})
        s = 45 * min(repeat, 1.0) + (0 if broadleaf_break else 20)
        if rot["tillage"] == "no-till" and repeat >= 1:
            s += 5        # residue-borne disease stays on the surface
        if rot["tillage"] == "conventional":
            s -= 5        # tillage after harvest buries residue and kills volunteer wheat
        struct[k] = s

    rows, detail = [], []
    p = plantings.copy()
    p["model"] = p["model"].fillna("obs") if "model" in p else "obs"
    for (view, model, rot, phase), g in p.groupby(["view", "model", "rotation", "phase"]):
        w = weather_by_key.get((view, model))
        if w is None:
            continue
        yi = pest_weather_indices(w)
        for year, gy in g.groupby("season_year"):
            risks = {}
            for _, pl in gy.iterrows():
                if pl.crop == "winter_wheat" and year in yi.index:
                    risks["leaf_rust"] = pct("leaf_rust", yi.loc[year, "leaf_rust_days"])
                if pl.crop == "sorghum" and year in yi.index:
                    risks["sugarcane_aphid"] = pct("sugarcane_aphid", yi.loc[year, "sca_index"])
                for k, v in planting_pest_index(pl, w).items():
                    risks[k] = pct(k, v)
            weather_part = np.mean(list(risks.values())) if risks else 0.0
            idx = struct[rot] + 0.35 * weather_part
            rows.append(dict(view=view, model=model, rotation=rot, phase=phase, year=year,
                             pest_index=idx, pest_structure=struct[rot], pest_weather=weather_part))
            for k, v in risks.items():
                detail.append(dict(view=view, model=model, rotation=rot, year=year, pest=k, risk_pct=v))
    return pd.DataFrame(rows), pd.DataFrame(detail)


# ---------------------------------------------------------------------------
# Recommender
# ---------------------------------------------------------------------------

def scorecard(years: pd.DataFrame, econ: pd.DataFrame, pests: pd.DataFrame, price: str = "high",
              types: pd.DataFrame | None = None) -> pd.DataFrame:
    """Metrics and 0-100 dimension scores per view x rotation."""
    y = years.copy()
    if types is not None:
        y = y.merge(types[["year_type"]], left_on="year", right_index=True, how="left")
    y["model"] = y["model"].fillna("obs") if "model" in y else "obs"
    keys = ["view", "model", "rotation", "phase", "year"]
    d = y.merge(econ, on=keys, how="left").merge(pests, on=keys, how="left")
    rows = []
    for (view, rot), g in d.groupby(["view", "rotation"]):
        net = g[f"ravc_{price}"]
        m = dict(view=view, rotation=rot, price=price,
                 bare_days=g.bare_days.median(),
                 soil_loss=g.soil_loss_t_ha.median(),
                 net_median=net.median(), net_worst10=net.quantile(0.1),
                 loss_years_pct=float((net < 0).mean() * 100),
                 net_after_fixed=g[f"net_{price}"].median(),
                 drought_return=g.loc[g.year_type == "drought", f"ravc_{price}"].median()
                 if "year_type" in g else np.nan,
                 n_bought=g.n_bought.mean(), n_credit=g.n_credit.mean(), n_savings=g.n_savings.mean(),
                 eqip_per_year=g.eqip_per_year.mean(),
                 pest_index=g.pest_index.mean())
        m["score_soil_cover"] = _anchor_score(m["bare_days"], *ANCHORS["soil_cover"])
        m["score_erosion"] = _anchor_score(m["soil_loss"], *ANCHORS["erosion"])
        m["score_profit"] = _anchor_score(m["net_median"], *ANCHORS["profit"])
        m["score_resilience"] = _anchor_score(m["net_worst10"], *ANCHORS["resilience"])
        m["score_nitrogen"] = _anchor_score(m["n_bought"], *ANCHORS["nitrogen"])
        m["score_pest"] = _anchor_score(m["pest_index"], *ANCHORS["pest"])
        rows.append(m)
    return pd.DataFrame(rows)


def overall(sc: pd.DataFrame, weights: dict) -> pd.Series:
    tot = sum(weights.values())
    return sum(sc[f"score_{k}"] * v for k, v in weights.items()) / tot


def recommend(sc_all: pd.DataFrame, current: str = "current", priority: str = "balanced",
              view: str = "today", price: str = "high", rotations: dict = fr.ROTATIONS,
              custom_weights: dict | None = None) -> dict:
    """The recommendation for the farmer.

    The pick is the rotation with the best AVERAGE score across every climate
    view (all years, today, last 15 years, two 2040 scenarios) and both price
    scenarios, under the farmer's priorities. A rotation that wins only one
    scenario by a hair is not recommended over one that wins most of them.
    The card numbers shown to the farmer come from `view` and `price`."""
    weights = custom_weights or PRIORITY_PRESETS[priority]
    combos = []
    for (v, pz), s in sc_all.groupby(["view", "price"]):
        s = s.set_index("rotation")
        o = overall(s, weights)
        combos.append(pd.DataFrame({"overall": o, "view": v, "price": pz}))
    combos = pd.concat(combos).rename_axis("rotation").reset_index()
    combos["rank"] = combos.groupby(["view", "price"]).overall.rank(ascending=False, method="min")
    expected = combos.groupby("rotation").overall.mean().sort_values(ascending=False)
    win_share = combos[combos["rank"] == 1].rotation.value_counts(normalize=True).reindex(expected.index).fillna(0)
    worst_rank = combos.groupby("rotation")["rank"].max()

    sc = sc_all[(sc_all.view == view) & (sc_all.price == price)].set_index("rotation").copy()
    sc["overall"] = overall(sc, weights)
    sc["expected"] = expected
    sc = sc.loc[expected.index]
    top = expected.index[0]
    best = top if top != current else (expected.index[1] if len(expected) > 1 else current)

    def card(rot):
        r = sc.loc[rot]
        dims = {k: dict(label=DIMENSION_LABELS[k], score=round(r[f"score_{k}"]), grade=grade(r[f"score_{k}"]))
                for k in ANCHORS}
        return dict(label=rotations[rot]["label"], key=rot,
                    overall=round(r.overall), grade=grade(r.overall),
                    score_across_scenarios=round(r.expected), rank=int(list(expected.index).index(rot) + 1),
                    wins_share=round(float(win_share.get(rot, 0)), 2), worst_rank=int(worst_rank[rot]),
                    dimensions=dims,
                    metrics=dict(bare_days=round(r.bare_days), soil_loss_t_ha=round(r.soil_loss, 1),
                                 return_above_var_typical=round(r.net_median),
                                 return_above_var_worst10=round(r.net_worst10),
                                 return_above_var_drought=None if pd.isna(r.drought_return) else round(r.drought_return),
                                 net_after_fixed_and_rent=round(r.net_after_fixed),
                                 loss_years_pct=round(r.loss_years_pct), fertilizer_n_lb=round(r.n_bought),
                                 n_credit_lb=round(r.n_credit), eqip_per_year=round(r.eqip_per_year, 2),
                                 pest_index=round(r.pest_index)))

    cur, alt = sc.loc[current], sc.loc[best]
    strengths = [DIMENSION_LABELS[k] for k in ANCHORS if cur[f"score_{k}"] >= 65]
    weaknesses = sorted([k for k in ANCHORS if cur[f"score_{k}"] < 50], key=lambda k: cur[f"score_{k}"])
    reasons, tradeoffs = [], []
    for k in ANCHORS:
        diff = alt[f"score_{k}"] - cur[f"score_{k}"]
        if diff >= 10:
            reasons.append(_reason(k, cur, alt))
        elif diff <= -10:
            tradeoffs.append(_reason(k, cur, alt))

    share = float(win_share.get(top, 0))
    gap = float(expected.iloc[0] - expected.iloc[1]) if len(expected) > 1 else 100.0
    if share >= 0.8 and gap >= 5:
        confidence = "high"
    elif share >= 0.6 or gap >= 5:
        confidence = "medium"
    else:
        confidence = "low"
    runner = expected.index[1] if top == best else top
    close_call = gap < 5

    # does the pick change if the farmer's priorities change?
    by_priority = {}
    for pr, wts in PRIORITY_PRESETS.items():
        e = []
        for (v, pz), s in sc_all.groupby(["view", "price"]):
            e.append(overall(s.set_index("rotation"), wts))
        by_priority[pr] = pd.concat(e, axis=1).mean(axis=1).idxmax()

    return dict(
        priority=priority, weights=weights, view=view, price=price,
        current=card(current),
        current_verdict=_verdict(cur, sc, current, expected),
        current_strengths=strengths,
        current_weaknesses=[_weakness(k, cur, current, rotations) for k in weaknesses],
        recommended_watch_outs=[_weakness(k, alt, best, rotations) for k in
                                sorted([k for k in ANCHORS if alt[f"score_{k}"] < 50], key=lambda k: alt[f"score_{k}"])],
        recommended=card(best), runner_up=card(runner),
        keep_current=bool(top == current),
        reasons=reasons, tradeoffs=tradeoffs,
        close_call=close_call,
        cost_share_note=(f"May qualify for about ${alt.eqip_per_year:.0f}/acre/yr from NRCS EQIP for {EQIP_YEARS} years "
                         f"(not counted in the score; applications are competitive)") if alt.eqip_per_year > 0 else None,
        ranking=[card(r) for r in expected.index],
        confidence=confidence,
        robustness=dict(scenarios_checked=int(combos.groupby(["view", "price"]).ngroups),
                        top_wins_share=round(share, 2), gap_points=round(gap, 1),
                        pick_by_priority=by_priority),
    )


def _verdict(cur, sc, current, expected):
    rank = list(expected.index).index(current) + 1
    n = len(expected)
    if rank == 1:
        return "Your current rotation scores best of the options we tested."
    if rank == n:
        return "Your current rotation scores lowest of the options we tested."
    return f"Your current rotation ranks {rank} of {n} options we tested."


def _reason(k, cur, alt):
    if k == "soil_cover":
        return f"{cur.bare_days - alt.bare_days:+.0f} bare days a year ({cur.bare_days:.0f} -> {alt.bare_days:.0f})".replace("+", "")
    if k == "erosion":
        return f"soil loss {cur.soil_loss:.1f} -> {alt.soil_loss:.1f} t/ha/yr"
    if k == "profit":
        return f"typical return above variable costs ${cur.net_median:.0f} -> ${alt.net_median:.0f}/acre"
    if k == "resilience":
        return f"worst-10% season ${cur.net_worst10:.0f} -> ${alt.net_worst10:.0f}/acre"
    if k == "nitrogen":
        return f"fertilizer N {cur.n_bought:.0f} -> {alt.n_bought:.0f} lb/acre/yr"
    if k == "pest":
        return f"pest & disease index {cur.pest_index:.0f} -> {alt.pest_index:.0f}"
    return k


def _weakness(k, r, rot_key, rotations):
    rot = rotations[rot_key]
    crops = [c for c, _ in rot["plantings"]]
    cash = [c for c in crops if fr.CROPS[c]["kind"] == "cash"]
    every_year = [fr.CROPS[c]["label"].lower() for c in set(cash) if cash.count(c) / rot["cycle"] >= 1]
    grass_only = not ({fr.CROPS[c]["family"] for c in crops} - {"grass"})
    if k == "pest":
        parts = []
        if every_year:
            parts.append(f"{', '.join(every_year).capitalize()} every year keeps its pests and diseases cycling")
        if grass_only:
            parts.append("every crop is a grass, so there is no broadleaf break")
        if "sorghum" in cash:
            parts.append("watch sugarcane aphid after mild winters")
        if "corn" in cash:
            parts.append("aflatoxin risk in hot, dry summers")
        return "; ".join(parts) or "Pest and disease pressure is above average"
    if k == "soil_cover":
        return f"Soil sits bare about {r.bare_days:.0f} days a year"
    if k == "erosion":
        return f"Soil loss of about {r.soil_loss:.1f} t/ha/yr"
    if k == "profit":
        return f"Typical return above variable costs of ${r.net_median:.0f}/acre"
    if k == "resilience":
        return (f"In the worst 10% of seasons it loses about ${-r.net_worst10:.0f}/acre above variable costs"
                if r.net_worst10 < 0 else f"Worst-10% return ${r.net_worst10:.0f}/acre")
    if k == "nitrogen":
        extra = "" if r.n_credit > 0 else " with no legume credit"
        return f"Buys about {r.n_bought:.0f} lb fertilizer N per acre a year{extra}"
    return k
