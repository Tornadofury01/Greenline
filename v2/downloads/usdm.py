"""US Drought Monitor, weekly county statistics (% of county area in D0-D4), 2000-2025, the 6 study counties.
Public API, no key. Output: v2/data/usdm_county_weekly.csv
  python v2/downloads/usdm.py
"""
import io, time
import pandas as pd
import requests
from common import COUNTIES, DATA

URL = "https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent"
parts = []
for f in COUNTIES:
    for y0 in (2000, 2013):
        y1 = y0 + 12
        for t in range(3):
            r = requests.get(URL, params={"aoi": f, "startdate": f"1/1/{y0}", "enddate": f"12/31/{min(y1, 2025)}",
                                          "statisticsType": 1}, headers={"Accept": "text/csv"}, timeout=120)
            if r.ok:
                break
            time.sleep(3)
        r.raise_for_status()
        d = pd.read_csv(io.StringIO(r.text)) if r.text.lstrip().startswith(("MapDate", "\"MapDate", "FIPS")) or "," in r.text[:200] else pd.DataFrame(r.json())
        d["cfips"] = f
        parts.append(d)
        print(f, y0, len(d), flush=True)
out = pd.concat(parts, ignore_index=True)
out.to_csv(DATA / "usdm_county_weekly.csv", index=False)
print("wrote usdm_county_weekly.csv", out.shape, list(out.columns)[:12])
