"""Quick check before submitting: build each dataset's job for one year and fetch 2 rows interactively.
Catches wrong IDs / band names in seconds instead of in failed batch tasks.

  python smoke.py --account 1            # all datasets, in parallel subprocesses
  python smoke.py --account 1 --ds ls8   # one
"""
import argparse, json, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

from jobs import DATASETS, Job

TEST_YEAR = {"ls5": 2010, "ls7": 2012, "ls7more": 2005}


def job_for(ds):
    d = DATASETS[ds]
    if d["unit"] == "year":
        y = TEST_YEAR.get(ds, 2020 if 2020 in d["years"] else d["years"][-1])
        return Job(ds, year=y)
    if d["unit"] == "cmip6":
        return Job(ds, model="MIROC6", run="ssp245")
    return Job(ds)


def one(account, ds):
    import ee, auth
    from datasets import build
    auth.init(account)
    j = job_for(ds)
    fc, sel = build(j)
    if ds == "cmip6":
        fc = fc.filter(ee.Filter.eq("date", "2040-07-01"))
    rows = fc.limit(2).getInfo()["features"]
    if not rows:
        return f"{j.name}: NO ROWS"
    props = rows[0]["properties"]
    filled = [c for c in sel if props.get(c) is not None]
    empty = [c for c in sel if props.get(c) is None]
    return f"{j.name}: ok, {len(filled)}/{len(sel)} columns filled" + (f"; empty: {empty[:12]}" if empty else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", default="1")
    ap.add_argument("--ds", default=None)
    ap.add_argument("--timeout", type=int, default=240)
    a = ap.parse_args()
    if a.ds:
        print(one(a.account, a.ds))
        return

    def run(ds):
        try:
            p = subprocess.run([sys.executable, "-W", "ignore", __file__, "--account", a.account, "--ds", ds],
                               capture_output=True, text=True, timeout=a.timeout)
            out = (p.stdout.strip() or p.stderr.strip().splitlines()[-1]) if (p.stdout or p.stderr) else "no output"
            return f"{ds:<10} {out}"
        except subprocess.TimeoutExpired:
            return f"{ds:<10} TIMEOUT after {a.timeout}s (interactive limit; may still work as a batch task)"

    # the account's saved sign-in is copied into place once, before the parallel runs
    import auth
    auth.init(a.account)
    with ThreadPoolExecutor(8) as ex:
        for line in ex.map(run, list(DATASETS)):
            print(line, flush=True)


if __name__ == "__main__":
    main()
