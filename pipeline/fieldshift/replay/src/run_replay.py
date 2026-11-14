import json, time, numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg"); import matplotlib.pyplot as plt
import fs_replay as fr
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
U = os.path.join(ROOT, "data", "raw") + os.sep
OUT = os.path.join(ROOT, "outputs")
os.makedirs(OUT, exist_ok=True)
os.chdir(ROOT)
LAT, LON, LAST_YEAR, SCENARIOS = 32.25, -96.75, 2025, ["ssp245", "ssp585"]
CFG = dict(fr.DEFAULTS, lat=LAT, elevation_m=147)
pd.set_option("display.width", 250, "display.max_columns", 30)

raw = pd.read_csv(U + "power_daily_replay.csv", index_col=0, parse_dates=True).replace(-999, np.nan)
soil_f = pd.read_csv(U + "fields_soil.csv")
terr = pd.read_csv(U + "fields_terrain.csv")
cmip = pd.read_csv(U + "cmip6_monthly.csv").dropna()

# soil: average the 0 and 30 cm layers; OpenLandMap organic carbon is stored as (g/kg)/5 -> x5 g/kg -> /10 %
f = pd.DataFrame({"field_id": soil_f.field_id,
                  "clay": (soil_f.clay_0cm + soil_f.clay_30cm) / 2,
                  "sand": (soil_f.sand_0cm + soil_f.sand_30cm) / 2,
                  "oc": soil_f.orgc_0cm * 5 / 10})
f = f.merge(terr[["field_id", "acres", "slope_deg_mean"]], on="field_id")
f["slope_pct"] = np.tan(np.radians(f.slope_deg_mean)) * 100
typ = dict(clay=f.clay.median(), sand=f.sand.median(), org_carbon_pct=f.oc.median(), slope_pct=f.slope_pct.median())
soil = fr.soil_params(**typ, cfg=CFG)
print("Typical field:", {k: (round(v, 3) if isinstance(v, float) else v) for k, v in soil.items()})

w = fr.prepare_weather(raw.loc["1984":"2025"], CFG)
# Year types from Model 3 (k-means on Mar-Oct NASA POWER seasons, ../models/year_types.csv). Its "hot" is the
# replay's "heat-wave". Years Model 3 doesn't cover fall back to the simple rules in fr.year_types.
M3 = os.path.join(ROOT, "..", "models", "year_types.csv")
m3 = pd.read_csv(M3, index_col=0).year_type.replace({"hot": "heat-wave"}) if os.path.exists(M3) else None
types = fr.year_types(w.loc["1985":], CFG, model3_labels=m3)
print("Year types from", "Model 3" if m3 is not None else "simple rules (Model 3 file not found)")
trend = fr.warming_trend(w)
ei_scale = fr.erosivity_scale(w.loc["1985":], CFG)
print(f"Rain {w.rain.resample('YS').sum().mean():.0f} mm/yr, ET0 {w.et0.resample('YS').sum().mean():.0f} mm/yr")
print(f"Warming: tmax {trend['tmax']*10:+.2f} C/decade, tmin {trend['tmin']*10:+.2f} C/decade")
print("Year types:", types.year_type.value_counts().to_dict())
for t in ["drought", "heat-wave", "wet"]:
    print(f"  {t}: {list(types.index[types.year_type == t])}")

t0 = time.time()
views = {"all_years": (w, 1985), "today": (fr.shift_to_year(w, trend, LAST_YEAR, CFG), 1985),
         "last_15": (w[w.index.year >= LAST_YEAR - 15], LAST_YEAR - 14)}
Y, P = [], []
for name, (wv, first) in views.items():
    y, p = fr.run_view(wv, name, soil, ei_scale, first_result_year=first, cfg=CFG); Y.append(y); P.append(p)

deltas = fr.cmip6_deltas(cmip)
ann = deltas.groupby(["scenario", "model"]).agg(dtmax=("dtmax", "mean"), dtmin=("dtmin", "mean"), rain=("pr_ratio", "mean"))
print("\nCMIP6 change 1985-2014 -> 2030-2050:\n", ann.round(2))
print(ann.groupby("scenario").mean().round(2))
base = fr.shift_to_year(w, trend, CFG["detrend_base_year"], CFG)
model_years = []
for (scen, model), d in deltas.groupby(["scenario", "model"]):
    y, p = fr.run_view(fr.apply_delta(base, d, CFG), f"{scen}_2040", soil, ei_scale, first_result_year=1985, cfg=CFG)
    y["model"], p["model"] = model, model
    Y.append(y); P.append(p); model_years.append(y)
print(f"runs done in {time.time()-t0:.0f}s")
ydf, pdf = pd.concat(Y, ignore_index=True), pd.concat(P, ignore_index=True)

summary = fr.summarize(ydf, types); scored = fr.score_views(summary); robust = fr.robustness(scored)
view_order = ["all_years", "today", "last_15"] + [f"{s}_2040" for s in SCENARIOS]
show = ["bare_days_median", "soil_loss_median", "soil_loss_worst10", "crop_output_median", "crop_output_worst10",
        "harvests_per_year", "crop_failure_rate", "cover_fail_rate", "n_fixed_median", "score", "rank"]
for v in view_order:
    print(f"\n=== {v} ===")
    print(scored[scored.view == v].set_index("rotation")[show].round(2).sort_values("rank"))
print("\nScores:\n", scored.pivot(index="rotation", columns="view", values="score")[view_order])
print("\nRobustness:", robust)

sp = []
for y in model_years:
    for model, g in y.groupby("model"):
        sp.append(fr.score_views(fr.summarize(g.assign(view=f"{g.view.iloc[0]}|{model}"), types)))
spread = pd.concat(sp); spread[["scenario", "model"]] = spread.view.str.split("|", expand=True)
winners = spread[spread["rank"] == 1].groupby("scenario").rotation.value_counts().unstack(fill_value=0)
print("\nModel winners:\n", winners)
print(spread.groupby(["scenario", "rotation"]).crop_output_median.agg(["min", "max"]).round(2))

# drought-year detail
td = summary[summary.view == "today"].set_index("rotation")
print("\nBy year type (today):\n", td.filter(like="output_").round(2))
print(td.filter(like="soil_loss_").round(2))
cur = pdf[(pdf.view == "today") & (pdf.rotation == "current") & (pdf.crop == "winter_wheat")].set_index("season_year")
print("\nCurrent wheat relative yield by year (today):\n", cur.rel_yield.round(2).to_dict())

# outputs
import os; 
cards = fr.card_lines(summary, fr.ROTATIONS, view="today", future_view="ssp245_2040")
for k, c in cards.items():
    print("\n" + c["label"]); [print("  -", l) for l in c["lines"]]
base_kls = soil["k_si"] * soil["ls"]; tl = td.soil_loss_median
rows = []
for _, r in f.iterrows():
    s2 = fr.soil_params(r.clay, r.sand, r.oc, r.slope_pct, CFG); fac = s2["k_si"] * s2["ls"] / base_kls
    rows.append({"field_id": int(r.field_id), "acres": round(r.acres, 1), "slope_pct": round(r.slope_pct, 2),
                 "erosion_factor": round(fac, 3), **{f"soil_loss_{k}": round(v * fac, 2) for k, v in tl.items()}})
fsl = pd.DataFrame(rows); fsl.to_csv("outputs/field_soil_loss.csv", index=False)
print("\nField erosion factor range:", fsl.erosion_factor.describe().round(2).to_dict())
tot = (fsl.acres * (fsl.soil_loss_current - fsl.soil_loss_wheat_cowpea) * 0.4047 * 0.9072).sum()
print(f"County-sample soil saved current->wheat_cowpea: {tot:,.0f} short tons/yr over {fsl.acres.sum():,.0f} acres")

def clean(x):
    if isinstance(x, (np.floating, float)): return None if np.isnan(x) else round(float(x), 3)
    if isinstance(x, (np.integer,)): return int(x)
    return x
app = dict(location=dict(name="ellis_county_tx", lat=LAT, lon=LON), generated=pd.Timestamp.now().isoformat(timespec="minutes"),
    weather=dict(source="NASA POWER daily", years=[1985, LAST_YEAR], warming_c_per_decade={k: round(v*10, 2) for k, v in trend.items()}),
    projections=dict(source="NASA NEX-GDDP-CMIP6", scenarios=SCENARIOS, period="2030-2050", models=sorted(deltas.model.unique()), method="monthly delta change"),
    soil={k: clean(v) for k, v in soil.items()}, priority_weights=fr.PRIORITY_WEIGHTS, robustness=robust,
    model_winners={s: {k: int(v) for k, v in winners.loc[s].items()} for s in winners.index},
    year_types={int(y): t for y, t in types.year_type.items()}, cards=cards,
    views={v: {r: {k: clean(x) for k, x in row.items() if k != "view"} for r, row in scored[scored.view == v].set_index("rotation").iterrows()} for v in view_order},
    notes=["Crop values are FAO-56/FAO-33 starting points; review with Texas A&M AgriLife or NRCS.",
           "Crop output is harvests x relative yield, not profit.", "Projections shift real past seasons; they do not add new kinds of extremes.",
           "Year types are built-in rules until Model 3 labels are supplied.", "Rain erosivity R=300 (US units) is an assumption."])
json.dump(app, open("outputs/replay_cards.json", "w"), indent=1, default=str)
ydf.to_csv("outputs/replay_years.csv", index=False); pdf.to_csv("outputs/replay_plantings.csv", index=False)
scored.to_csv("outputs/replay_summary.csv", index=False); types.to_csv("outputs/year_types.csv")

ROT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"]; VC = dict(zip(view_order, ROT))
rk = list(fr.ROTATIONS); rl = {k: fr.ROTATIONS[k]["label"] for k in rk}
plt.rcParams.update({"axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.color": "#e6e5e0",
    "axes.axisbelow": True, "axes.edgecolor": "#b9b8b0", "xtick.color": "#5f5e5a", "ytick.color": "#5f5e5a"})
panels = [("bare_days_median", "Bare days a year (typical)"), ("soil_loss_median", "Soil loss, t/ha/yr (typical)"),
          ("crop_output_median", "Crop output, typical year"), ("crop_output_worst10", "Crop output, worst 10% of years")]
fig, axes = plt.subplots(1, 4, figsize=(17, 4.6), sharey=True); yp = np.arange(len(rk))
for ax, (col, title) in zip(axes, panels):
    for i, v in enumerate(view_order):
        s = summary[summary.view == v].set_index("rotation").reindex(rk)[col]
        ax.scatter(s.values, yp + (i - 2) * 0.13, s=40, color=VC[v], label=v, edgecolor="white", linewidth=1.5, zorder=3)
    ax.set_title(title, fontsize=11, loc="left"); ax.grid(axis="y", visible=False)
axes[0].set_yticks(yp, [rl[k] for k in rk]); axes[0].invert_yaxis()
axes[-1].legend(title="Climate view", frameon=False, bbox_to_anchor=(1.02, 1), loc="upper left")
plt.suptitle("Ellis County: each rotation under five climate views", x=0.01, ha="left", fontsize=13)
plt.tight_layout(); plt.savefig("outputs/replay_views.png", dpi=150, bbox_inches="tight")
today = ydf[ydf.view == "today"].groupby(["rotation", "year"]).crop_output.mean().unstack(0)
fig, ax = plt.subplots(figsize=(14, 4.6))
for yr in types.index[types.year_type == "drought"]: ax.axvspan(yr - .5, yr + .5, color="#ecebe6", zorder=0)
for k, c in zip(rk, ROT): ax.plot(today.index, today[k], color=c, lw=2, label=rl[k])
ax.set_ylabel("Crop output (harvests x relative yield)")
ax.set_title("Every season since 1985 replayed in today's climate (shaded: drought-type years)", loc="left", fontsize=12)
ax.legend(frameon=False, ncol=3, loc="upper center", bbox_to_anchor=(0.5, -0.1)); ax.grid(axis="x", visible=False)
plt.tight_layout(); plt.savefig("outputs/replay_timeline.png", dpi=150, bbox_inches="tight")
