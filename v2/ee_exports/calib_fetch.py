"""Fetch the Calibration E county tables straight from Earth Engine (same builders as calib_counties.py) into
v2/data/ee_calib/<job>.csv. The tables are small (25 counties per job), so no Drive round trip is needed; the
batch exports in the Drive folder fieldshift_v2_calib are the same numbers.

  python calib_fetch.py            # skips files already fetched
"""
import sys, time
from concurrent.futures import ThreadPoolExecutor

import ee
import pandas as pd

import auth
import calib_counties as cc

OUT = cc.DATA / "ee_calib"


def fetch(name, build):
    path = OUT / f"{name}.csv"
    if path.exists():
        return name, "have"
    for t in range(3):
        try:
            fc, sel = build()
            d = ee.data.computeFeatures({"expression": fc, "fileFormat": "PANDAS_DATAFRAME"})
            d = d.reindex(columns=sel)
            d.to_csv(path, index=False)
            return name, f"{len(d)} rows"
        except Exception as e:                       # noqa: BLE001 - retry transient EE errors
            err = str(e)[:160]
            time.sleep(10 * (t + 1))
    return name, f"FAILED: {err}"


def main():
    OUT.mkdir(exist_ok=True)
    auth.init(cc.ACCOUNT)
    with ThreadPoolExecutor(4) as ex:
        for name, msg in ex.map(lambda j: fetch(*j), cc.jobs()):
            print(f"  {name}: {msg}", flush=True)


if __name__ == "__main__":
    main()
