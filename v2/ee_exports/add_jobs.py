"""Append datasets added after submission to accounts that are already running, without reshuffling assignments.json.
(Rerunning plan.py would move already-submitted jobs to other accounts.)

  python add_jobs.py disalexi,openet,terraclimate --accounts 1,2,3
"""
import argparse, json
from pathlib import Path

from jobs import Job, all_jobs

HERE = Path(__file__).resolve().parent

ap = argparse.ArgumentParser()
ap.add_argument("datasets")
ap.add_argument("--accounts", default="1,2,3")
a = ap.parse_args()
p = HERE / "assignments.json"
plan = json.loads(p.read_text())
have = {d["name"] for v in plan["accounts"].values() for d in v}
new = sorted((j for j in all_jobs() if j.ds in a.datasets.split(",") and j.name not in have), key=lambda j: (-j.minutes, j.name))
load = {k: sum(d["minutes"] for d in plan["accounts"][k]) for k in a.accounts.split(",")}
for j in new:
    k = min(load, key=load.get)
    plan["accounts"][k].append(j.to_dict())
    load[k] += j.minutes
p.write_text(json.dumps(plan, indent=1))
print(f"added {len(new)} jobs:", {k: round(v / 60, 1) for k, v in load.items()}, "h per account")
