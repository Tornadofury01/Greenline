"""USDA-ARS Riesel Watersheds (McLennan County, TX): field-level harvest yields from the land management records.
Public files on ars.usda.gov (Grassland, Soil and Water Research Laboratory, Temple TX). Legend: activity 2 =
harvest, crop 101 corn, 102 sorghum, 103 wheat, 104 cotton, 100 oats. Yield is the rate on the harvest row.

Used as an independent field-level check for Calibration E (it never trains on these).

  python v2/downloads/riesel.py
Writes v2/data/riesel/<field>mgt.txt (raw) and v2/data/riesel_yields.csv (field, date, crop, yield, unit)
"""
import io, re, zipfile

import pandas as pd
import requests

from common import DATA

BASE = "https://www.ars.usda.gov/ARSUserFiles/30980500/riesel/"
ACTIVE = ["sw12", "sw17", "w10", "w12", "w13", "y6", "y8", "y10", "y13", "y14"]
CROP = {100: "OATS", 101: "CORN", 102: "SORGHUM", 103: "WHEAT", 104: "COTTON"}
ROW = re.compile(r"^(\S+)\s+(\d{1,2})\s+(\d{1,2})\s+(\d{4})\s+2\s+(\d{3})\s+([\d.]+)\s*([a-zA-Z/]+)")
OUT = DATA / "riesel"


def fetch():
    OUT.mkdir(exist_ok=True)
    texts = {}
    s = requests.Session()
    s.headers["User-Agent"] = "Mozilla/5.0 (research data download)"
    for f in ACTIVE:
        r = s.get(BASE + f"{f}mgt.txt", timeout=60)
        if r.ok:
            texts[f] = r.text
    r = s.get(BASE + "MANAGE.ZIP", timeout=120)
    if r.ok:
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            for n in z.namelist():
                if n.lower().endswith(".txt"):
                    texts.setdefault(n.lower().rsplit("/", 1)[-1].replace("mgt.txt", ""), z.read(n).decode("latin-1"))
    for k, t in texts.items():
        (OUT / f"{k}mgt.txt").write_text(t, encoding="utf-8")
    return texts


def parse(texts):
    rows = []
    for t in texts.values():
        for line in t.splitlines():
            m = ROW.match(line)
            if m and int(m.group(5)) in CROP:
                fld, mo, dy, yr, crop, val, unit = m.groups()
                rows.append({"field": fld.upper(), "date": f"{yr}-{int(mo):02d}-{int(dy):02d}", "year": int(yr),
                             "crop": CROP[int(crop)], "yield": float(val), "unit": unit.lower()})
    d = pd.DataFrame(rows).drop_duplicates()
    return d


def main():
    d = parse(fetch())
    d.to_csv(DATA / "riesel_yields.csv", index=False)
    print(f"riesel_yields.csv: {len(d)} harvests, {d.field.nunique()} fields, {d.year.min()}-{d.year.max()}")
    print(d.groupby(["crop", "unit"]).agg(n=("yield", "size"), first=("year", "min"), last=("year", "max"),
                                           median=("yield", "median")).to_string())


if __name__ == "__main__":
    main()
