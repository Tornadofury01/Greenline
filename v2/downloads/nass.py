"""USDA NASS Quick Stats for the 6 North Texas study counties (free API key, read from NASS_API_KEY in the
repo-root .env; never printed).

Writes (v2/data/):
  nass_county.csv     county yields, planted / harvested acres, production, 1985-2025 (SURVEY), study counties
  nass_district.csv   the same at agricultural-district level (county estimates have gaps; districts fill them)
  nass_state.csv      the same for Texas
  nass_progress.csv   Texas weekly crop progress (planted, emerged, headed, harvested ...), 1985-2025
  nass_prices.csv     Texas prices received, monthly and marketing year
  nass_rent.csv       county cash rent, cropland non-irrigated / pasture (SURVEY)
  nass_census.csv     Census of Agriculture practices (cover crops, no-till, ...) for the study counties

  python v2/downloads/nass.py
"""
import os, sys, time

import pandas as pd
import requests

from common import COUNTY3, DATA, ROOT, YEAR0, YEAR1

API = "https://quickstats.nass.usda.gov/api/api_GET/"
CROPS = ["WHEAT", "CORN", "SORGHUM", "COTTON", "SOYBEANS", "OATS", "HAY", "SUNFLOWER", "SESAME", "PEANUTS"]
STATS = ["YIELD", "AREA PLANTED", "AREA HARVESTED", "PRODUCTION"]
KEEP = ["source_desc", "agg_level_desc", "state_alpha", "asd_code", "asd_desc", "county_ansi", "county_name",
        "commodity_desc", "class_desc", "prodn_practice_desc", "util_practice_desc", "statisticcat_desc", "unit_desc",
        "short_desc", "domain_desc", "domaincat_desc", "year", "freq_desc", "reference_period_desc",
        "week_ending", "begin_code", "end_code", "Value", "CV (%)"]


def key():
    k = os.getenv("NASS_API_KEY")
    env = ROOT / ".env"
    if not k and env.exists():
        for line in env.read_text().splitlines():
            if line.strip().startswith("NASS_API_KEY="):
                k = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not k:
        sys.exit("NASS_API_KEY missing: add a line NASS_API_KEY=... to the repo-root .env "
                 "(free key: https://quickstats.nass.usda.gov/api).")
    return k


KEY = None


def get(**params):
    """One Quick Stats query -> DataFrame (empty if NASS has no data). Errors never show the key."""
    params = {"key": KEY, "format": "JSON", **params}
    for t in range(4):
        try:
            r = requests.get(API, params=params, timeout=180)
        except requests.RequestException:
            time.sleep(5 * (t + 1))
            continue
        if r.status_code == 400:          # "no data" for this combination
            return pd.DataFrame()
        if r.status_code == 413:
            raise RuntimeError(f"too many rows (>50,000) for {({k: v for k, v in params.items() if k != 'key'})}")
        if r.ok:
            d = pd.DataFrame(r.json().get("data", []))
            return d[[c for c in KEEP if c in d.columns]]
        time.sleep(5 * (t + 1))
    raise RuntimeError(f"NASS request failed: HTTP {r.status_code} for "
                       f"{({k: v for k, v in params.items() if k != 'key'})}")


def save(parts, name):
    d = pd.concat([p for p in parts if len(p)], ignore_index=True) if any(len(p) for p in parts) else pd.DataFrame()
    if len(d):
        d["value_num"] = pd.to_numeric(d.Value.astype(str).str.replace(",", ""), errors="coerce")
        if "county_ansi" in d:
            d["cfips"] = "48" + d.county_ansi.astype(str).str.zfill(3)
    d.to_csv(DATA / name, index=False)
    print(f"  {name}: {len(d)} rows", flush=True)
    return d


def main():
    global KEY
    KEY = key()
    yr = {"year__GE": YEAR0, "year__LE": YEAR1}

    print("county yields and acres ...", flush=True)
    parts = []
    for crop in CROPS:
        for c3 in COUNTY3:
            for st in STATS:
                parts.append(get(source_desc="SURVEY", agg_level_desc="COUNTY", state_alpha="TX", county_ansi=c3,
                                 commodity_desc=crop, statisticcat_desc=st, **yr))
    save(parts, "nass_county.csv")

    print("district and state ...", flush=True)
    for level, name in (("AGRICULTURAL DISTRICT", "nass_district.csv"), ("STATE", "nass_state.csv")):
        parts = [get(source_desc="SURVEY", agg_level_desc=level, state_alpha="TX", commodity_desc=crop,
                     statisticcat_desc=st, **yr) for crop in CROPS for st in STATS]
        save(parts, name)

    print("crop progress (Texas, weekly) ...", flush=True)
    save([get(source_desc="SURVEY", agg_level_desc="STATE", state_alpha="TX", statisticcat_desc="PROGRESS",
              freq_desc="WEEKLY", year=y) for y in range(YEAR0, YEAR1 + 1)], "nass_progress.csv")

    print("prices received (Texas) ...", flush=True)
    save([get(source_desc="SURVEY", agg_level_desc="STATE", state_alpha="TX", commodity_desc=crop,
              statisticcat_desc="PRICE RECEIVED", **yr) for crop in CROPS], "nass_prices.csv")

    print("cash rent (county) ...", flush=True)
    save([get(source_desc="SURVEY", agg_level_desc="COUNTY", state_alpha="TX", county_ansi=c3, commodity_desc="RENT",
              year__GE=2008) for c3 in COUNTY3], "nass_rent.csv")

    print("census practices (county) ...", flush=True)
    save([get(source_desc="CENSUS", agg_level_desc="COUNTY", state_alpha="TX", county_ansi=c3, commodity_desc=c)
          for c3 in COUNTY3 for c in ("PRACTICES", "AG LAND")], "nass_census.csv")
    print("done")


if __name__ == "__main__":
    main()
