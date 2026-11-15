"""Model B inputs: one row per field per month, 1985-2025.

Greenness: monthly median NDVI of the clear views (Landsat + HLS, same clear rule as Model 1) and the number of views.
Normal, leak-free: the same field's mean NDVI for that crop group and month in EARLIER years only (>= 3 of them), else
the county's earlier-years mean for that crop and month. Spread: the earlier-years SD of the anomaly, per crop and month.
  anomaly = ndvi - normal;  z = anomaly / spread;  stressed = z <= -1 in a growing month (normal >= 0.3).
Crop: Model 1's final crop per field-year (USDA where clean, model otherwise), grouped.
Weather and water per field-month: gridMET (rain, heat days >= 35 C, VPD, reference ET), gridMET drought indices
(SPI / SPEI / EDDI / PDSI, end of month), IMERG rain + peak 30-min rate (2001+), SMAP L4 root-zone and L3 surface
soil moisture (2015+), MODIS ET (2001+), OpenET DisALEXI ET / ETo (2001-2024), TerraClimate deficit / soil water.
Rain anomaly: vs the same field-month in earlier years only.

Writes v2/data/modelB/monthly.pkl
  python v2/models/modelB/data.py
"""
import glob, sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "v2" / "models" / "model1"))
from features import GROUP  # noqa: E402

EE = ROOT / "v2" / "data" / "ee"
OUT = ROOT / "v2" / "data" / "modelB"
OUT.mkdir(parents=True, exist_ok=True)


def greenness():
    cache = OUT / "ndvi_monthly.pkl"
    if cache.exists():
        return pd.read_pickle(cache)
    from features_v2 import scenes
    s = scenes()
    s = s.assign(year=s.date.dt.year, month=s.date.dt.month)
    g = s.groupby(["fid", "year", "month"])
    m = g.ndvi_p50.median().rename("ndvi").to_frame().join(g.size().rename("views")).reset_index()
    m.to_pickle(cache)
    return m


def crops():
    p = pd.read_csv(ROOT / "v2" / "models" / "model1" / "predictions_v2.csv.gz", usecols=["fid", "year", "final", "source", "confidence"])
    p["crop"] = p.final.map(GROUP).fillna("other")
    return p[["fid", "year", "crop", "source"]].rename(columns={"source": "crop_source"})


def normals(d):
    """Leak-free expanding normals: only years before the row's year."""
    d = d.sort_values(["fid", "crop", "month", "year"]).copy()
    g = d.groupby(["fid", "crop", "month"]).ndvi
    d["n_prior"] = g.cumcount()
    d["norm_field"] = g.transform(lambda v: v.shift().expanding().mean())
    # county fallback: per county-crop-month, the mean of all earlier years' field values
    cy = d.groupby(["cfips", "crop", "month", "year"]).ndvi.agg(["sum", "count"]).reset_index().sort_values("year")
    cy[["csum", "ccount"]] = cy.groupby(["cfips", "crop", "month"])[["sum", "count"]].transform(lambda v: v.shift().cumsum())
    cy["norm_county"] = cy.csum / cy.ccount
    d = d.merge(cy[["cfips", "crop", "month", "year", "norm_county"]], on=["cfips", "crop", "month", "year"], how="left")
    d["normal"] = np.where(d.n_prior >= 3, d.norm_field, d.norm_county)
    d["anom"] = d.ndvi - d.normal
    # spread: SD of anomalies in earlier years, pooled per crop-month (across the 6 counties)
    sp = d.groupby(["crop", "month", "year"]).anom.agg(["sum", "count", lambda v: (v ** 2).sum()]).reset_index()
    sp.columns = ["crop", "month", "year", "s", "n", "ss"]
    sp = sp.sort_values("year")
    sp[["cs", "cn", "css"]] = sp.groupby(["crop", "month"])[["s", "n", "ss"]].transform(lambda v: v.shift().cumsum())
    sp["spread"] = np.sqrt((sp.css / sp.cn - (sp.cs / sp.cn) ** 2).clip(lower=1e-4))
    d = d.merge(sp[["crop", "month", "year", "spread"]], on=["crop", "month", "year"], how="left")
    d["spread"] = d.spread.clip(lower=0.03)
    d["z"] = d.anom / d.spread
    d["growing"] = (d.normal >= 0.3).astype(int)
    d["stressed"] = np.where(d.growing == 1, (d.z <= -1).astype(float), np.nan)
    return d


def monthly_wide(pattern, bands, how):
    """Per field-month aggregates from dDD_<band> columns without melting."""
    out = []
    for f in sorted(glob.glob(str(EE / pattern))):
        d = pd.read_csv(f)
        r = d[["fid", "year", "month"]].copy()
        for b, fn in bands.items():
            cols = [c for c in d.columns if c.endswith(f"_{b}") and c[0] == "d"]
            v = d[cols]
            r[f"{how}_{b}" if fn != "last" else f"{b}"] = (
                v.sum(axis=1, min_count=1) if fn == "sum" else v.mean(axis=1) if fn == "mean" else v.max(axis=1) if fn == "max"
                else v.ffill(axis=1).iloc[:, -1])
        out.append(r)
    return pd.concat(out, ignore_index=True)


def gridmet():
    out = []
    for f in sorted(glob.glob(str(EE / "gridmet_*.csv"))):
        d = pd.read_csv(f)
        c = lambda b: [x for x in d.columns if x.endswith(f"_{b}")]
        r = d[["fid", "year", "month"]].copy()
        r["rain"] = d[c("pr")].sum(axis=1, min_count=1)
        r["tmax_mean"] = d[c("tmmx")].mean(axis=1) - 273.15
        r["hot_days"] = (d[c("tmmx")] >= 308.15).sum(axis=1)
        r["vpd"] = d[c("vpd")].mean(axis=1)
        r["eto"] = d[c("eto")].sum(axis=1, min_count=1)
        r["rain_days"] = (d[c("pr")] >= 1).sum(axis=1)
        out.append(r)
    return pd.concat(out, ignore_index=True)


def monthly_mm(ds, bands, rename):
    out = []
    for f in sorted(glob.glob(str(EE / f"{ds}_*.csv"))):
        d = pd.read_csv(f)
        for m in range(1, 13):
            r = d[["fid", "year"]].copy()
            r["month"] = m
            for b in bands:
                col = f"m{m:02d}_{b}"
                r[rename.get(b, b)] = d[col] if col in d else np.nan
            out.append(r)
    return pd.concat(out, ignore_index=True)


def main():
    g = greenness()
    g["cfips"] = g.fid.str[:5]
    d = g.merge(crops(), on=["fid", "year"], how="left")
    d["crop"] = d.crop.fillna("other")
    d = normals(d)
    print(f"field-months with a clear view: {len(d):,}; growing months with a normal: "
          f"{int(((d.growing == 1) & d.z.notna()).sum()):,}; stressed share {d.stressed.mean():.1%}", flush=True)

    w = gridmet()
    w = w.sort_values(["fid", "month", "year"])
    gm = w.groupby(["fid", "month"]).rain
    w["rain_anom"] = w.rain - gm.transform(lambda v: v.shift().expanding().mean())       # earlier years only
    dr = monthly_wide("gmdrought_*.csv", {b: "last" for b in ("spi30d", "spi90d", "spei30d", "spei90d", "eddi30d", "eddi90d", "pdsi")}, "x")
    im = monthly_wide("imerg_*.csv", {"rain": "sum", "i30": "max"}, "imerg")
    s4 = monthly_wide("smapl4_*.csv", {"sm_rootzone": "mean", "sm_surface": "mean"}, "smap")
    m16 = monthly_wide("mod16_*.csv", {"et": "sum", "pet": "sum"}, "mod16")
    da = monthly_mm("disalexi", ["et"], {"et": "alexi_et"})
    tc = monthly_mm("terraclimate", ["def", "soil", "aet", "pet"], {"def": "tc_def", "soil": "tc_soil", "aet": "tc_aet", "pet": "tc_pet"})
    x = w
    for t in (dr, im, s4, m16, da, tc):
        x = x.merge(t, on=["fid", "year", "month"], how="left")
    x["alexi_ratio"] = x.alexi_et / x.eto.replace(0, np.nan)
    x["et_ratio"] = x.mod16_et / x.mod16_pet.replace(0, np.nan)
    d = d.merge(x, on=["fid", "year", "month"], how="outer")
    d["cfips"] = d.fid.str[:5]
    soil = pd.read_csv(ROOT / "v2" / "data" / "ssurgo_fields.csv")[["fid", "awc_r_0_100", "claytotal_r_0_30", "om_r_0_30", "aws0100wta", "slope_r"]]
    d = d.merge(soil, on="fid", how="left")
    d = d[(d.year >= 1985) & (d.year <= 2025)].sort_values(["fid", "year", "month"]).reset_index(drop=True)
    d.to_pickle(OUT / "monthly.pkl")
    print(f"wrote monthly.pkl: {len(d):,} field-months x {d.shape[1]} columns")


if __name__ == "__main__":
    main()
