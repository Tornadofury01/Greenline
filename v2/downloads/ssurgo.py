"""USDA SSURGO soil for every study field, area-weighted over the field (Soil Data Access, public, no key).

1. Map unit areas inside each 45 m-buffered field (SDA spatial macros) -> ssurgo_field_mukeys.csv
2. Components (+ muaggatt) and horizons for those map units                -> ssurgo_components.csv, ssurgo_horizons.csv
3. Per field: numeric properties area- and component-weighted, horizons depth-weighted over 0-30 cm (and 0-100 cm
   for water); categories from the largest map unit's dominant component     -> ssurgo_fields.csv

Needs v2/data/fields_v2.geojson (outlines from the EE field asset).
  python v2/downloads/ssurgo.py
"""
import json, time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
import requests

from common import DATA

SDA = "https://sdmdataaccess.sc.egov.usda.gov/tabular/post.rest"
HZ_NUM = ["om_r", "claytotal_r", "sandtotal_r", "silttotal_r", "dbthirdbar_r", "awc_r", "ksat_r", "ph1to1h2o_r", "cec7_r"]
CO_NUM = ["tfact", "wei", "slope_r"]


def sda(q, tries=4):
    for t in range(tries):
        try:
            r = requests.post(SDA, json={"query": q, "format": "JSON+COLUMNNAME"}, timeout=180)
            if r.ok:
                tab = r.json().get("Table", [])
                return pd.DataFrame(tab[1:], columns=tab[0]) if tab else pd.DataFrame()
            err = r.text[:200]
        except Exception as e:  # network hiccup
            err = str(e)[:200]
        time.sleep(3 * (t + 1))
    raise RuntimeError(err)


def polygons(g):
    if g["type"] == "Polygon":
        return [g["coordinates"]]
    if g["type"] == "MultiPolygon":
        return g["coordinates"]
    if g["type"] == "GeometryCollection":
        return [p for sub in g["geometries"] for p in polygons(sub)]
    return []


def wkt(g):
    ring = lambda r: "(" + ", ".join(f"{x} {y}" for x, y in r) + ")"
    ps = polygons(g)
    return "MULTIPOLYGON (" + ", ".join("(" + ", ".join(ring(r) for r in p) + ")" for p in ps) + ")"


def field_mukeys(f):
    q = f"""~DeclareGeometry(@aoi)~
select @aoi = geometry::STGeomFromText('{wkt(f['geometry'])}', 4326).MakeValid()
~DeclareIdGeomTable(@g)~
~GetClippedMapunits(@aoi,polygon,geo,@g)~
~DeclareIdGeogTable(@gg)~
~GetGeogFromGeomWgs84(@g,@gg)~
select id as mukey, sum(geog.STArea()) as area_m2 from @gg group by id"""
    d = sda(q)
    d["fid"] = f["properties"]["fid"]
    return d


def depth_weighted(h, top, bot):
    h = h.copy()
    h["w"] = (np.minimum(h.hzdepb_r, bot) - np.maximum(h.hzdept_r, top)).clip(lower=0)
    h = h[h.w > 0]
    out = {}
    for c in HZ_NUM:
        g = h.dropna(subset=[c])
        out[c] = (g[c] * g.w).groupby(g.cokey).sum() / g.w.groupby(g.cokey).sum()
    return pd.DataFrame(out)


def main():
    feats = json.load(open(DATA / "fields_v2.geojson"))["features"]
    path = DATA / "ssurgo_field_mukeys.csv"
    done = pd.read_csv(path, dtype={"mukey": str}) if path.exists() else pd.DataFrame(columns=["fid", "mukey", "area_m2"])
    todo = [f for f in feats if f["properties"]["fid"] not in set(done.fid)]
    print(f"{len(feats)} fields, {len(todo)} to query", flush=True)
    parts, fails = [done], []
    with ThreadPoolExecutor(6) as ex:
        for i, (f, res) in enumerate(zip(todo, ex.map(lambda f: _safe(field_mukeys, f), todo)), 1):
            (fails.append(f["properties"]["fid"]) if isinstance(res, str) else parts.append(res))
            if i % 200 == 0:
                print(f"  {i}/{len(todo)}", flush=True)
                pd.concat(parts)[["fid", "mukey", "area_m2"]].to_csv(path, index=False)
    mk = pd.concat(parts)[["fid", "mukey", "area_m2"]]
    mk["area_m2"] = mk.area_m2.astype(float)
    mk.to_csv(path, index=False)
    print(f"map units: {mk.fid.nunique()} fields, {mk.mukey.nunique()} map units, failed {len(fails)}: {fails[:10]}")

    keys = sorted(mk.mukey.astype(str).unique())
    comps, hors = [], []
    for k in range(0, len(keys), 150):
        ks = ",".join(f"'{x}'" for x in keys[k:k + 150])
        comps.append(sda(f"""SELECT c.mukey, c.cokey, c.compname, c.comppct_r, c.majcompflag, c.hydgrp, c.drainagecl,
            c.tfact, c.wei, c.slope_r, c.nirrcapcl, c.taxorder, ma.aws0100wta, ma.aws0150wta, ma.wtdepannmin,
            ma.flodfreqdcd, ma.hydgrpdcd, ma.drclassdcd, ma.niccdcd, mu.muname
            FROM mapunit mu JOIN component c ON c.mukey = mu.mukey LEFT JOIN muaggatt ma ON ma.mukey = mu.mukey
            WHERE mu.mukey IN ({ks})"""))
        hors.append(sda(f"""SELECT c.cokey, h.hzdept_r, h.hzdepb_r, h.om_r, h.claytotal_r, h.sandtotal_r, h.silttotal_r,
            h.dbthirdbar_r, h.awc_r, h.ksat_r, h.ph1to1h2o_r, h.cec7_r, h.kwfact, h.kffact
            FROM component c JOIN chorizon h ON h.cokey = c.cokey WHERE c.mukey IN ({ks})"""))
    co, hz = pd.concat(comps), pd.concat(hors)
    co.to_csv(DATA / "ssurgo_components.csv", index=False)
    hz.to_csv(DATA / "ssurgo_horizons.csv", index=False)
    for c in ["comppct_r", "tfact", "wei", "slope_r", "aws0100wta", "aws0150wta", "wtdepannmin"]:
        co[c] = pd.to_numeric(co[c], errors="coerce")
    for c in HZ_NUM + ["hzdept_r", "hzdepb_r", "kwfact", "kffact"]:
        hz[c] = pd.to_numeric(hz[c], errors="coerce")

    # per component: 0-30 cm depth-weighted properties, surface K factor
    top = depth_weighted(hz, 0, 30).add_suffix("_0_30")
    awc100 = depth_weighted(hz, 0, 100)[["awc_r"]].rename(columns={"awc_r": "awc_r_0_100"})
    surf = hz.sort_values("hzdept_r").groupby("cokey").first()[["kwfact", "kffact"]]
    co = co.set_index("cokey").join(top).join(awc100).join(surf).reset_index()
    co = co[co.comppct_r > 0]

    # per map unit: component-percent weighted numbers; dominant component for categories
    num = [c for c in co.columns if c.endswith(("_0_30", "_0_100"))] + CO_NUM + ["kwfact", "kffact"]
    wmean = lambda g, c: np.average(g[c].dropna(), weights=g.loc[g[c].notna(), "comppct_r"]) if g[c].notna().any() else np.nan
    mu = co.groupby("mukey").apply(lambda g: pd.Series({c: wmean(g, c) for c in num}))
    dom = co.sort_values("comppct_r", ascending=False).groupby("mukey").first()
    mu = mu.join(dom[["compname", "muname", "hydgrp", "drainagecl", "nirrcapcl", "taxorder", "aws0100wta", "aws0150wta",
                      "wtdepannmin", "flodfreqdcd"]])

    # per field: area-weighted numbers; categories from the largest map unit
    mk["mukey"] = mk.mukey.astype(str)
    mu.index = mu.index.astype(str)
    m = mk.join(mu, on="mukey")
    nums = num + ["aws0100wta", "aws0150wta", "wtdepannmin"]
    rows = []
    for fid, g in m.groupby("fid"):
        r = {"fid": fid, "soil_area_ha": round(g.area_m2.sum() / 1e4, 2), "n_mapunits": len(g)}
        for c in nums:
            v = g.dropna(subset=[c])
            r[c] = round(float(np.average(v[c], weights=v.area_m2)), 4) if len(v) else None
        big = g.sort_values("area_m2", ascending=False).iloc[0]
        r.update({"main_mukey": big.mukey, "main_share": round(big.area_m2 / g.area_m2.sum(), 3),
                  **{c: big[c] for c in ["compname", "muname", "hydgrp", "drainagecl", "nirrcapcl", "taxorder", "flodfreqdcd"]}})
        rows.append(r)
    out = pd.DataFrame(rows)
    out.to_csv(DATA / "ssurgo_fields.csv", index=False)
    print(f"wrote ssurgo_fields.csv: {len(out)} fields; main soils: {out.compname.value_counts().head(5).to_dict()}")


def _safe(fn, f):
    try:
        return fn(f)
    except Exception as e:
        return str(e)


if __name__ == "__main__":
    main()
