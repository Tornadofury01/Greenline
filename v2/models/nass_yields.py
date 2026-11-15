"""One clean NASS county yield series per crop (shared by Model B, Model C and Calibration E).

NASS reports several overlapping series; mixing them blurs year-to-year changes. Kept:
  unit per HARVESTED acre (BU / ACRE, LB / ACRE), not per net planted acre (1985-1990 only)
  ALL PRODUCTION PRACTICES (not the irrigated / non-irrigated split, which stops in 2007-2019)
  wheat: WINTER class only; corn / sorghum: GRAIN (not silage); cotton: UPLAND
"""
from pathlib import Path
import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "data"
UNITS = {"WHEAT": "BU / ACRE", "CORN": "BU / ACRE", "SORGHUM": "BU / ACRE", "COTTON": "LB / ACRE",
         "SOYBEANS": "BU / ACRE", "OATS": "BU / ACRE"}
CLASS = {"WHEAT": "WINTER", "COTTON": "UPLAND"}


def county_yields():
    n = pd.read_csv(DATA / "nass_county.csv", low_memory=False, dtype={"cfips": str})
    y = n[(n.statisticcat_desc == "YIELD") & (n.domain_desc == "TOTAL") & (n.prodn_practice_desc == "ALL PRODUCTION PRACTICES")]
    keep = []
    for crop, unit in UNITS.items():
        g = y[(y.commodity_desc == crop) & (y.unit_desc == unit) & (y.util_practice_desc != "SILAGE")]
        if crop in CLASS:
            g = g[g.class_desc == CLASS[crop]]
        keep.append(g)
    y = pd.concat(keep)
    y = y.groupby(["commodity_desc", "cfips", "year"]).agg(value_num=("value_num", "mean"), unit_desc=("unit_desc", "first")).reset_index()
    return y.dropna(subset=["value_num"])
