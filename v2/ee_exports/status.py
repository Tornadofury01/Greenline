"""Progress of one account's exports, real run time per dataset (to correct the guesses in jobs.py), and errors.

  python status.py --account 3
"""
import argparse, json, re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import ee

import auth
from jobs import DATASETS, Job

HERE = Path(__file__).resolve().parent


def ts(s):
    s = re.sub(r"(\.\d{6})\d*", r"\1", s.replace("Z", "+00:00"))
    return datetime.fromisoformat(s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", required=True)
    a = ap.parse_args()
    auth.init(a.account)
    mine = {Job.from_dict(d).name: Job.from_dict(d) for d in json.loads((HERE / "assignments.json").read_text())["accounts"][a.account]}

    latest = {}
    for op in ee.data.listOperations():
        md = op.get("metadata", {})
        d = md.get("description")
        if d in mine and (d not in latest or md.get("updateTime", "") > latest[d][0].get("updateTime", "")):
            latest[d] = (md, op.get("error", {}).get("message"))

    states = Counter(md.get("state") for md, _ in latest.values())
    print(f"account {a.account}: {len(mine)} assigned, {len(mine) - len(latest)} not submitted, " +
          ", ".join(f"{k.lower()} {v}" for k, v in sorted(states.items())))

    mins = defaultdict(list)
    for d, (md, _) in latest.items():
        if md.get("state") == "SUCCEEDED" and md.get("startTime") and md.get("endTime"):
            mins[mine[d].ds].append((ts(md["endTime"]) - ts(md["startTime"])).total_seconds() / 60)
    if mins:
        print("\nreal minutes per job (median) vs the guess in jobs.py:")
        for ds, v in sorted(mins.items()):
            v = sorted(v)
            print(f"  {ds:<10} {v[len(v) // 2]:6.1f}  (guess {DATASETS[ds]['minutes']}, n={len(v)})")

    failed = [(d, err) for d, (md, err) in latest.items() if md.get("state") == "FAILED"]
    if failed:
        print(f"\n{len(failed)} failed (rerun run_exports.py to resubmit; fix the cause first if it's the same error):")
        for d, err in sorted(failed)[:30]:
            print(f"  {d}: {err}")


if __name__ == "__main__":
    main()
