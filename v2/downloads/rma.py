"""USDA RMA Cause of Loss (Summary of Business with month of loss), 1989-2025, filtered to the 6 study counties.

Each national yearly file is downloaded, filtered to Texas + our counties, then thrown away.
Output: v2/data/rma_cause_of_loss.csv (one row per county x crop x plan x cause x month of loss), and
        v2/data/rma_county_year_cause.csv (indemnity and acres by county x crop x year x cause, all plans summed).
Column layout from COL_Summary_of_Business_with_Month_All_Years.pdf (30 pipe-separated fields).

  python v2/downloads/rma.py
"""
import io, time, zipfile

import pandas as pd
import requests

from common import COUNTY3, DATA

URL = "https://pubfs-rma.fpac.usda.gov/pub/Web_Data_Files/Summary_of_Business/cause_of_loss/colsom_{y}.zip"
COLS = ["commodity_year", "state_code", "state_abbr", "county_code", "county_name", "commodity_code", "commodity_name",
        "plan_code", "plan_abbr", "coverage_category", "stage_code", "cause_code", "cause_desc", "month_of_loss",
        "month_of_loss_name", "year_of_loss", "policies_earning_premium", "policies_indemnified", "net_planted_qty",
        "net_endorsed_acres", "liability", "total_premium", "producer_paid_premium", "subsidy", "state_private_subsidy",
        "additional_subsidy", "efa_premium_discount", "net_determined_qty", "indemnity", "loss_ratio"]


def year(y):
    for attempt in range(3):
        r = requests.get(URL.format(y=y), timeout=300)
        if r.status_code == 404:
            return None
        if r.ok:
            break
        time.sleep(5)
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    rows = []
    for line in z.read(z.namelist()[0]).decode("latin-1").splitlines():
        p = [x.strip() for x in line.split("|")]
        if len(p) >= 2 and p[1] == "48" and p[3] in COUNTY3:
            rows.append(p[:30] + [""] * (30 - len(p)))
    return pd.DataFrame(rows, columns=COLS)


def main():
    parts = []
    for y in range(1989, 2026):
        d = year(y)
        n = 0 if d is None else len(d)
        print(f"  {y}: {n} rows" + (" (no file)" if d is None else ""), flush=True)
        if d is not None:
            parts.append(d)
    df = pd.concat(parts, ignore_index=True)
    num = COLS[16:]
    df[num] = df[num].apply(pd.to_numeric, errors="coerce")
    df["cfips"] = "48" + df.county_code
    for c in ("commodity_name", "cause_desc", "county_name"):
        df[c] = df[c].str.strip().str.upper()      # older years are upper case, newer title case
    df.to_csv(DATA / "rma_cause_of_loss.csv", index=False)
    agg = (df.groupby(["cfips", "county_name", "commodity_name", "commodity_year", "cause_desc"], as_index=False)
           [["indemnity", "net_determined_qty", "net_planted_qty", "liability", "policies_indemnified"]].sum())
    agg.to_csv(DATA / "rma_county_year_cause.csv", index=False)
    print(f"wrote rma_cause_of_loss.csv ({len(df)} rows) and rma_county_year_cause.csv ({len(agg)} rows); "
          f"top causes: {df.groupby('cause_desc').indemnity.sum().nlargest(5).round(-3).to_dict()}")


if __name__ == "__main__":
    main()
