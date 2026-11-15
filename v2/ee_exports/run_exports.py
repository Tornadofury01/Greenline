"""Submit one account's share of the exports (from assignments.json) as Earth Engine batch tasks.

  python auth.py --account 3        # once per account: browser sign-in, saved in creds/
  python run_exports.py --account 3 --dry-run     # list what would be submitted
  python run_exports.py --account 3 --limit 1     # one small test task: check where the file lands
  python run_exports.py --account 3               # everything else

Safe to rerun: a job whose task is already queued, running or finished on this account is skipped, and failed
jobs are resubmitted. Order: tier 1 (core) first, tier 2 after it.

If the field asset isn't ready yet (prepare_fields_ee.py still running), only the point jobs (GRACE, GLDAS, CMIP6) are
submitted: start them right away, then rerun once account 1 says the fields are ready.
"""
import argparse, json, sys, time
from pathlib import Path

import ee

import auth
import config
from jobs import Job

HERE = Path(__file__).resolve().parent


def existing_tasks():
    """description -> state, for this account's tasks (EE keeps finished tasks listed for a while)."""
    out = {}
    for op in ee.data.listOperations():
        md = op.get("metadata", {})
        d, st = md.get("description"), md.get("state")
        if d and (d not in out or st in ("PENDING", "RUNNING", "SUCCEEDED")):
            out[d] = st
    return out


def export_task(name, fc, selectors):
    if config.DEST["type"] == "gcs":
        return ee.batch.Export.table.toCloudStorage(
            collection=fc, description=name, bucket=config.DEST["bucket"],
            fileNamePrefix=f"{config.DEST.get('prefix', 'fieldshift_v2')}/{name.split('_')[0]}/{name}",
            fileFormat="CSV", selectors=selectors)
    return ee.batch.Export.table.toDrive(collection=fc, description=name, folder=config.DEST["folder"],
                                         fileNamePrefix=name, fileFormat="CSV", selectors=selectors)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", required=True, help="1..N, as in assignments.json")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=None, help="submit at most this many new tasks")
    ap.add_argument("--only", default=None, help="comma-separated dataset keys, e.g. ls8,daymet")
    ap.add_argument("--redo", default="", help="comma-separated job names to resubmit even if they succeeded")
    a = ap.parse_args()

    if "CHANGE-ME" in config.FIELDS_ASSET:
        sys.exit("set config.FIELDS_ASSET to the uploaded field asset first")
    plan = json.loads((HERE / "assignments.json").read_text())
    jobs = [Job.from_dict(d) for d in plan["accounts"][a.account]]
    if a.only:
        keep = set(a.only.split(","))
        jobs = [j for j in jobs if j.ds in keep]
    # tier first; within a tier the longest jobs first, so slow ones aren't left for the end
    jobs.sort(key=lambda j: (j.tier, -j.minutes, j.name))

    acct = auth.init(a.account)
    from datasets import build  # after Initialize: ee.Reducer etc. exist only then

    try:
        ee.data.getAsset(config.FIELDS_ASSET)
    except ee.EEException:
        print(f"field asset {config.FIELDS_ASSET} not readable yet: submitting only the point jobs (GRACE, GLDAS, CMIP6)")
        jobs = [j for j in jobs if not j.needs_fields]

    have = existing_tasks()
    redo = set(filter(None, a.redo.split(",")))
    todo = [j for j in jobs if j.name in redo or have.get(j.name) not in ("PENDING", "RUNNING", "SUCCEEDED")]
    print(f"account {a.account} ({acct['project']}): {len(jobs)} jobs, {len(jobs) - len(todo)} already queued or done, "
          f"{len(todo)} to submit, ~{sum(j.minutes for j in todo) / 60:.1f} h estimated")
    if a.limit is not None:
        todo = todo[:a.limit]
    for i, j in enumerate(todo, 1):
        if a.dry_run:
            print(f"  [dry] {j.name}")
            continue
        try:
            fc, sel = build(j)
            export_task(j.name, fc, sel).start()
            print(f"  {i}/{len(todo)} started {j.name}")
        except ee.EEException as e:
            print(f"  {i}/{len(todo)} FAILED to start {j.name}: {e}")
            if "too many" in str(e).lower() or "quota" in str(e).lower():
                print("  queue limit reached: rerun later, finished and queued jobs are skipped")
                break
        time.sleep(0.3)


if __name__ == "__main__":
    main()
