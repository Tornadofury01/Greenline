"""NASS county yields for every county in the Texas Blacklands agricultural district (NASS district 40), used only
to calibrate Calibration E (more county-years). The app's fields stay in the 6 study counties.

Same format as nass_county.csv (yield, harvested acres, SURVEY, 1985-2025, wheat / corn / sorghum / cotton).
Key from NASS_API_KEY in the repo-root .env (never printed).

  python v2/downloads/nass_blacklands.py
Writes v2/data/nass_blacklands_county.csv
"""
import nass
from common import YEAR0, YEAR1

CROPS = ["WHEAT", "CORN", "SORGHUM", "COTTON"]


def main():
    nass.KEY = nass.key()
    parts = [nass.get(source_desc="SURVEY", agg_level_desc="COUNTY", state_alpha="TX", asd_code="40",
                      commodity_desc=crop, statisticcat_desc=st, year__GE=YEAR0, year__LE=YEAR1)
             for crop in CROPS for st in ("YIELD", "AREA HARVESTED")]
    d = nass.save(parts, "nass_blacklands_county.csv")
    d = d[d.county_ansi.astype(str).str.strip() != ""]
    print(d.groupby("county_name").year.nunique().sort_values(ascending=False).to_string())


if __name__ == "__main__":
    main()
