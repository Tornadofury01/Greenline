"""USDA NASS Quick Stats: county yields for our crops in our counties, and Texas "price received".

These ground the dollar estimates on the rotation cards. Survey data only (not Census), 2008-2025.
- Yields: county, plus the agricultural statistics district and state as fallbacks (NASS hides many county
  values as "(D)" for confidentiality or simply doesn't publish them for minor crops).
- Prices: Texas, marketing-year average price received, nominal dollars.
The 3 Oklahoma sample fields get Oklahoma county/district/state yields but Texas prices.

Usage (repo root): pipeline/.venv/Scripts/python pipeline/nass_quickstats.py
Reads NASS_API_KEY from the repo-root .env. Never prints it.
Outputs: pipeline/data/nass_yields.csv, pipeline/data/nass_prices_tx.csv
"""
import os
import sys
import time
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "pipeline" / "data"
load_dotenv(ROOT / ".env")
API = "https://quickstats.nass.usda.gov/api/api_GET/"
Y0, Y1 = 2008, 2025

# crop id -> (NASS commodity, yield short_desc, price short_desc). Ids match /content/crops.json where the crop
# exists there; soybeans and oats are CDL crops in our fields that crops.json doesn't list (yet).
CROPS = {
    "corn": ("CORN", "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE", "CORN, GRAIN - PRICE RECEIVED, MEASURED IN $ / BU"),
    "cotton": ("COTTON", "COTTON, UPLAND - YIELD, MEASURED IN LB / ACRE", "COTTON, UPLAND - PRICE RECEIVED, MEASURED IN $ / LB"),
    "grain_sorghum": ("SORGHUM", "SORGHUM, GRAIN - YIELD, MEASURED IN BU / ACRE", "SORGHUM, GRAIN - PRICE RECEIVED, MEASURED IN $ / CWT"),
    "winter_wheat": ("WHEAT", "WHEAT, WINTER - YIELD, MEASURED IN BU / ACRE", "WHEAT, WINTER - PRICE RECEIVED, MEASURED IN $ / BU"),
    "soybeans": ("SOYBEANS", "SOYBEANS - YIELD, MEASURED IN BU / ACRE", "SOYBEANS - PRICE RECEIVED, MEASURED IN $ / BU"),
    "oats": ("OATS", "OATS - YIELD, MEASURED IN BU / ACRE", "OATS - PRICE RECEIVED, MEASURED IN $ / BU"),
    "sunflower": ("SUNFLOWER", "SUNFLOWER - YIELD, MEASURED IN LB / ACRE", "SUNFLOWER - PRICE RECEIVED, MEASURED IN $ / CWT"),
    "alfalfa": ("HAY", None, "HAY, ALFALFA - PRICE RECEIVED, MEASURED IN $ / TON"),
}
LEVELS = {"COUNTY": "county", "AGRICULTURAL DISTRICT": "district", "STATE": "state"}


def unit(short_desc):
    return short_desc.split("MEASURED IN ")[-1].lower().replace(" / ", "/") if short_desc else None


def get(key, **params):
    for attempt in range(3):
        r = requests.get(API, params={"key": key, "format": "JSON", "source_desc": "SURVEY",
                                      "year__GE": Y0, **params}, timeout=180)
        if r.status_code == 400:  # NASS answers 400 when the query matches nothing
            return []
        if r.ok:
            time.sleep(0.3)
            return [x for x in r.json().get("data", []) if int(x["year"]) <= Y1]
        # don't use raise_for_status: its message would include the key in the URL
        print(f"  NASS HTTP {r.status_code}, retry")
        time.sleep(5)
    sys.exit(f"NASS request failed: {params.get('commodity_desc')} {params.get('statisticcat_desc')}")


def value(v):
    """'1,234' -> 1234.0; '(D)', '(NA)', '(Z)' -> None."""
    try:
        return float(str(v).replace(",", "").strip())
    except ValueError:
        return None


def main():
    key = os.getenv("NASS_API_KEY")
    if not key:
        sys.exit("NASS_API_KEY missing. Add it to the repo-root .env (see .env.example).")
    fields = pd.read_csv(DATA / "fields" / "fields.csv")
    counties = {(s, c.upper()) for s, c in zip(fields.state, fields.county)}
    states = sorted({s for s, _ in counties})

    yields = []
    for crop, (com, ydesc, _) in CROPS.items():
        if not ydesc:
            continue
        for st in states:
            for lvl in LEVELS:
                rows = get(key, commodity_desc=com, statisticcat_desc="YIELD", agg_level_desc=lvl, state_alpha=st)
                for x in rows:
                    if x["short_desc"] != ydesc or x["reference_period_desc"] != "YEAR":
                        continue
                    yields.append({"crop": crop, "state": st, "level": LEVELS[lvl], "county": x["county_name"].title(),
                                   "district": x["asd_desc"].title(), "year": int(x["year"]),
                                   "value": value(x["Value"]), "unit": unit(ydesc), "raw": x["Value"].strip()})
        print(f"  yields {crop}")
    y = pd.DataFrame(yields)
    # Keep our counties, their districts and the state rows (the district map comes from the county rows).
    y["key"] = list(zip(y.state, y.county.str.upper()))
    our_districts = set(zip(y[y.key.isin(counties)].state, y[y.key.isin(counties)].district))
    keep = (y.level == "state") | ((y.level == "county") & y.key.isin(counties)) | \
           ((y.level == "district") & pd.Series(list(zip(y.state, y.district))).isin(our_districts).values)
    y = y[keep].drop(columns="key").sort_values(["crop", "state", "level", "district", "county", "year"])
    y.to_csv(DATA / "nass_yields.csv", index=False)
    print(f"  wrote pipeline/data/nass_yields.csv ({len(y)} rows)")

    prices = []
    for crop, (com, _, pdesc) in CROPS.items():
        for x in get(key, commodity_desc=com, statisticcat_desc="PRICE RECEIVED", agg_level_desc="STATE", state_alpha="TX"):
            if x["short_desc"] == pdesc and x["reference_period_desc"] == "MARKETING YEAR":
                prices.append({"crop": crop, "year": int(x["year"]), "value": value(x["Value"]), "unit": unit(pdesc)})
    p = pd.DataFrame(prices).sort_values(["crop", "year"])
    p.to_csv(DATA / "nass_prices_tx.csv", index=False)
    print(f"  wrote pipeline/data/nass_prices_tx.csv ({len(p)} rows)")


if __name__ == "__main__":
    main()
