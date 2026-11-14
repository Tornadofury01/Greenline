import json, pickle, numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg"); import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
import os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import fs_replay as fr, fs_planning as fp
d = pickle.load(open("outputs/planning.pkl", "rb")); sc, recs = d["sc"], d["recs"]

def clean(o):
    if isinstance(o, dict): return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)): return [clean(v) for v in o]
    if isinstance(o, (np.floating,)): return None if np.isnan(o) else round(float(o), 3)
    if isinstance(o, (np.integer,)): return int(o)
    if isinstance(o, (np.bool_,)): return bool(o)
    return o

app = dict(
    location="ellis_county_tx",
    how_scored=dict(
        dimensions=fp.DIMENSION_LABELS, anchors=fp.ANCHORS, grades="A>=80, B>=65, C>=50, D>=35, F<35",
        pick_rule="Best average score across 5 climate views x 2 price scenarios under the farmer's priorities",
        profit_basis="Return above variable costs (land and machinery cost the same whichever rotation is planted); "
                     "cost-share shown separately, not scored"),
    priority_presets=fp.PRIORITY_PRESETS,
    recommendations=recs,
    cost_share=fp.costshare_table().to_dict(orient="records"),
    sources=dict(economics={k: v["src"] for k, v in fp.ECON.items()}, prices=fp.PRICE_SRC, eqip=fp.EQIP_SRC,
                 nitrogen="Texas A&M AgriLife N rates (1.5 lb/bu wheat, ~1 lb/bu corn under 100 bu, 2 lb/100 lb sorghum); "
                          "urea $0.72/lb N (DTN, Nov 2026)",
                 pests=fp.PEST_NOTES),
    assumptions=["Double-crop soybean yield 25 bu and $15 fixed cost", "Half of legume cover N available to next crop",
                 "20 lb N credit after soybean", "EQIP paid 3 years; not guaranteed", "Cover seed prices 2014-16 (ARS)",
                 "Rain erosivity R=300", "Year types from Model 3 (k-means on 1985-2025 NASA POWER seasons; soft groups, 41 years)"],
)
json.dump(clean(app), open("outputs/recommendation.json", "w"), indent=1)
keep = ["view", "price", "rotation", "bare_days", "soil_loss", "net_median", "net_worst10", "drought_return",
        "net_after_fixed", "loss_years_pct", "n_bought", "n_credit", "n_savings", "eqip_per_year", "pest_index"] + \
       [f"score_{k}" for k in fp.ANCHORS]
sc[keep].rename(columns={"net_median": "return_above_var_typical", "net_worst10": "return_above_var_worst10",
                         "drought_return": "return_above_var_drought"}).round(2).to_csv("outputs/scorecard.csv", index=False)

# Chart: scorecard grid, balanced priorities, today's climate, 2026/27 prices
r = recs["balanced"]
order = [c["key"] for c in r["ranking"]]
dims = list(fp.ANCHORS)
M = np.array([[c["dimensions"][k]["score"] for k in dims] + [c["score_across_scenarios"]] for c in r["ranking"]])
G = [[c["dimensions"][k]["grade"] for k in dims] + [fp.grade(c["score_across_scenarios"])] for c in r["ranking"]]
cmap = LinearSegmentedColormap.from_list("blue", ["#eef4fd", "#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"])
fig, ax = plt.subplots(figsize=(12, 4.2))
ax.imshow(M, cmap=cmap, vmin=0, vmax=100, aspect="auto")
for i in range(M.shape[0]):
    for j in range(M.shape[1]):
        v = M[i, j]
        ax.text(j, i, f"{G[i][j]}\n{v:.0f}", ha="center", va="center", fontsize=10,
                color="white" if v >= 55 else "#1f1f1d", fontweight="bold" if j == M.shape[1] - 1 else "normal")
ax.set_xticks(range(M.shape[1]), [fp.DIMENSION_LABELS[k] for k in dims] + ["Overall\n(all scenarios)"])
labels = []
for c in r["ranking"]:
    tag = "  (recommended)" if c["key"] == r["recommended"]["key"] else "  (current)" if c["key"] == "current" else ""
    labels.append(f"{c['rank']}. {c['label']}{tag}")
ax.set_yticks(range(M.shape[0]), labels)
ax.tick_params(length=0); [s.set_visible(False) for s in ax.spines.values()]
ax.set_xticks(np.arange(-.5, M.shape[1]), minor=True); ax.set_yticks(np.arange(-.5, M.shape[0]), minor=True)
ax.grid(which="minor", color="white", linewidth=3); ax.tick_params(which="minor", length=0)
ax.set_title("Ellis County rotation scorecard: balanced priorities, today's climate, 2026/27 prices",
             loc="left", fontsize=12, pad=12)
plt.tight_layout(); plt.savefig("outputs/scorecard.png", dpi=160, bbox_inches="tight")
print(json.dumps(clean({k: r[k] for k in ["current_verdict", "current_weaknesses", "reasons", "tradeoffs",
      "recommended_watch_outs", "cost_share_note", "confidence", "close_call", "robustness"]}), indent=1))
