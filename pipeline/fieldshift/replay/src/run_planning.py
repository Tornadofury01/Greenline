import json, time, numpy as np, pandas as pd
import fs_replay as fr, fs_planning as fp
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
U = os.path.join(ROOT, "data", "raw") + os.sep
OUT = os.path.join(ROOT, "outputs")
os.makedirs(OUT, exist_ok=True)
os.chdir(ROOT)
CFG = dict(fr.DEFAULTS, lat=32.25, elevation_m=147); LAST = 2025
pd.set_option("display.width", 250, "display.max_columns", 40)
t0 = time.time()
raw = pd.read_csv(U + "power_daily_replay.csv", index_col=0, parse_dates=True).replace(-999, np.nan)
w = fr.prepare_weather(raw.loc["1984":"2025"], CFG)
trend = fr.warming_trend(w)
cmip = pd.read_csv(U + "cmip6_monthly.csv").dropna()
deltas = fr.cmip6_deltas(cmip)
W = {("all_years", "obs"): w, ("today", "obs"): fr.shift_to_year(w, trend, LAST, CFG),
     ("last_15", "obs"): w[w.index.year >= LAST - 15]}
base = fr.shift_to_year(w, trend, 2000, CFG)
for (scen, model), d in deltas.groupby(["scenario", "model"]):
    W[(f"{scen}_2040", model)] = fr.apply_delta(base, d, CFG)

years = pd.read_csv("outputs/replay_years.csv"); plant = pd.read_csv("outputs/replay_plantings.csv")
for df in (years, plant):
    if "model" not in df: df["model"] = np.nan
    df["model"] = df.model.fillna("obs")
types = pd.read_csv("outputs/year_types.csv", index_col=0)

econ = fp.economics(plant, years)
pests, pest_detail = fp.pest_table(plant, W)
print(f"models built in {time.time()-t0:.0f}s")
print("Yield calibration (bu at relative yield 1.0):", {k: round(v, 1) for k, v in fp.calibrate_yields(plant).items()})
print("\nCost-share:\n", fp.costshare_table())

sc = pd.concat([fp.scorecard(years, econ, pests, price=p, types=types) for p in ["low", "high"]], ignore_index=True)
cols = ["bare_days", "soil_loss", "net_median", "net_worst10", "drought_return", "net_after_fixed", "loss_years_pct", "n_bought", "n_credit", "pest_index"] + [f"score_{k}" for k in fp.ANCHORS]
for v in ["today", "ssp245_2040"]:
    for p in ["high", "low"]:
        print(f"\n=== {v} | {p} prices ===")
        print(sc[(sc.view == v) & (sc.price == p)].set_index("rotation")[cols].round(1))

# by year type, today, high price
k = ["view", "model", "rotation", "phase", "year"]
d = years.merge(econ, on=k).merge(types[["year_type"]], left_on="year", right_index=True)
print("\nNet return by year type (today, 2026/27 prices):\n",
      d[d.view == "today"].groupby(["rotation", "year_type"]).ravc_high.median().unstack().round(0))
print("\nPest detail (today, mean risk percentile):\n",
      pest_detail[pest_detail.view == "today"].groupby(["rotation", "pest"]).risk_pct.mean().unstack().round(0))
print("\nPest weather change 2040 vs today:\n",
      pest_detail[pest_detail.view.isin(["today", "ssp245_2040"])].groupby(["pest", "view"]).risk_pct.mean().unstack().round(0))

recs = {}
for pri in fp.PRIORITY_PRESETS:
    r = fp.recommend(sc, priority=pri); recs[pri] = r
    print(f"\n##### {pri}: recommend {r['recommended']['label']} | confidence {r['confidence']} | close call {r['close_call']}")
    for c in r["ranking"]:
        print(f"   {c['rank']}. {c['label'][:42]:42s} across={c['score_across_scenarios']:3d} today={c['overall']:3d} {c['grade']} wins={c['wins_share']} worst_rank={c['worst_rank']}")
    print("  verdict:", r["current_verdict"]); print("  current grades:", {d['label']: d['grade'] for d in r['current']['dimensions'].values()})
    print("  weaknesses:", r["current_weaknesses"])
    print("  reasons:", r["reasons"]); print("  tradeoffs:", r["tradeoffs"]); print("  ", r["cost_share_note"])
    print("  robustness:", r["robustness"])
import pickle; pickle.dump(dict(econ=econ, pests=pests, pest_detail=pest_detail, sc=sc, recs=recs), open("outputs/planning.pkl", "wb"))
