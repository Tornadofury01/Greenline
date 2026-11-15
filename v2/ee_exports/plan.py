"""Split all export jobs across the accounts so each gets about the same estimated run time, tier by tier.

Tier 1 is balanced first (longest job first, to the least-loaded account), then tier 2 on top, so every account
finishes its core work at about the same time. Deterministic: every teammate gets the same assignments.json.

  python plan.py              -> assignments.json + a summary
  python plan.py --optional   -> include tier 3 (Sentinel-2 SR, OpenET)
  python plan.py --concurrency 3   -> wall-time estimate if EE runs 3 tasks at once per account
"""
import argparse, heapq, json
from collections import Counter, defaultdict
from pathlib import Path

import config
from jobs import all_jobs

OUT = Path(__file__).resolve().parent / "assignments.json"


def plan(n, include_optional):
    jobs = list(all_jobs(include_optional))
    heap = [(0.0, a) for a in range(1, n + 1)]
    out = defaultdict(list)
    for tier in sorted({j.tier for j in jobs}):
        for j in sorted((j for j in jobs if j.tier == tier), key=lambda j: (-j.minutes, j.name)):
            load, a = heapq.heappop(heap)
            out[a].append(j)
            heapq.heappush(heap, (load + j.minutes, a))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--accounts", type=int, default=config.N_ACCOUNTS)
    ap.add_argument("--optional", action="store_true")
    ap.add_argument("--concurrency", type=float, default=3, help="tasks EE runs at once per account (guess)")
    a = ap.parse_args()
    opt = a.optional or config.INCLUDE_OPTIONAL
    out = plan(a.accounts, opt)
    OUT.write_text(json.dumps({"nAccounts": a.accounts, "nFields": config.N_FIELDS, "includeOptional": opt,
                               "accounts": {str(k): [j.to_dict() for j in v] for k, v in sorted(out.items())}}, indent=1))
    alljobs = [j for v in out.values() for j in v]
    for t in sorted({j.tier for j in alljobs}):
        m = sum(j.minutes for j in alljobs if j.tier == t)
        print(f"tier {t}: {sum(j.tier == t for j in alljobs)} jobs, {m / 60:.1f} h of EE task time")
    print(f"\n{'acct':>4} {'jobs':>5} {'tier1 h':>8} {'all h':>6} {'wall h @' + str(a.concurrency):>11}  datasets")
    for k, v in sorted(out.items()):
        t1 = sum(j.minutes for j in v if j.tier == 1) / 60
        tot = sum(j.minutes for j in v) / 60
        mix = Counter(j.ds for j in v)
        print(f"{k:>4} {len(v):>5} {t1:>8.1f} {tot:>6.1f} {tot / a.concurrency:>11.1f}  " +
              ", ".join(f"{d} {c}" for d, c in sorted(mix.items())))
    print(f"\nwrote {OUT.name}. Minutes are guesses: check `status.py` after the first jobs finish.")


if __name__ == "__main__":
    main()
