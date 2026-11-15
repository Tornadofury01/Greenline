"""Step 0 (account 1, once, ~10 min): USDA Crop Sequence Boundaries in Earth Engine -> the field sample every export reads.

Runs entirely in Earth Engine (no CSB download). For each North Texas county in config.COUNTIES:
  CSB fields whose centroid is in the county, >= 10 ha -> random sample (seeded) -> buffer 45 m inward (roads and
  grass borders out) -> keep fields with >= 50 Landsat pixels left -> first FIELDS_PER_COUNTY of them.

Writes:
  config.FIELDS_ASSET            EE table: fid ("48139-0007"), cfips, area_ha, buf_ha, holdout, CDL2016..CDL2023 + geometry
  Drive or GCS fields_v2.geojson the same table for the cube builder

  python prepare_fields_ee.py --account 1          # start both exports
  python prepare_fields_ee.py --account 1 --share  # after the asset task finishes: make it readable by everyone
                                                   # (public USDA data), so accounts 2-6 can read it

The sample is random within each county, not stratified by crop, so rare rotations are rare in it too.
"""
import argparse, json, sys, time
from pathlib import Path

import ee

import auth
import config

HERE = Path(__file__).resolve().parent
MIN_HA = 10
INNER_BUFFER_M = 45
MIN_PIXELS = 50
SEED = 42


def counties():
    return ee.FeatureCollection("TIGER/2018/Counties").filter(ee.Filter.inList("GEOID", list(config.COUNTIES)))


def county_sample(cfips):
    geom = ee.Feature(counties().filter(ee.Filter.eq("GEOID", cfips)).first()).geometry()
    csb = ee.FeatureCollection(config.CSB_ASSET).filterBounds(geom)

    def prep(f):
        g = f.geometry()
        return f.set({"inside": geom.contains(g.centroid(1), 1), "area_ha": g.area(1).divide(1e4)})

    def shrink(f):
        b = f.geometry().buffer(-INNER_BUFFER_M, 1)
        return f.setGeometry(b).set("buf_ha", b.area(1).divide(1e4))

    pool = (csb.map(prep).filter(ee.Filter.eq("inside", True)).filter(ee.Filter.gte("area_ha", MIN_HA))
            .randomColumn("rnd", SEED).sort("rnd").limit(config.FIELDS_PER_COUNTY * 2)
            .map(shrink).filter(ee.Filter.gte("buf_ha", MIN_PIXELS * 900 / 1e4))
            .limit(config.FIELDS_PER_COUNTY))
    lst = pool.toList(config.FIELDS_PER_COUNTY)
    hold = cfips in config.HOLDOUT_COUNTIES

    def label(i):
        i = ee.Number(i)
        f = ee.Feature(lst.get(i))
        fid = ee.String(cfips + "-").cat(i.format("%04d"))
        return f.set({"fid": fid, "cfips": cfips, "holdout": 1 if hold else 0,
                      "area_ha": ee.Number(f.get("area_ha")).multiply(100).round().divide(100),
                      "buf_ha": ee.Number(f.get("buf_ha")).multiply(100).round().divide(100)})

    return ee.FeatureCollection(ee.List.sequence(0, lst.size().subtract(1)).map(label))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", default="1")
    ap.add_argument("--share", action="store_true", help="make FIELDS_ASSET world-readable (after it exists)")
    a = ap.parse_args()
    if "CHANGE-ME" in config.FIELDS_ASSET:
        sys.exit("set config.FIELDS_ASSET to projects/<account 1's Cloud project>/assets/fieldshift_v2_fields first")
    auth.init(a.account)

    if a.share:
        ee.data.setAssetAcl(config.FIELDS_ASSET, json.dumps({"all_users_can_read": True}))
        print(f"{config.FIELDS_ASSET} is now readable by all accounts")
        return

    fc = ee.FeatureCollection([county_sample(c) for c in config.COUNTIES]).flatten()
    fc = fc.select(["fid", "cfips", "holdout", "area_ha", "buf_ha", "CDL.*"])
    t1 = ee.batch.Export.table.toAsset(collection=fc, description="fields_v2_asset", assetId=config.FIELDS_ASSET)
    if config.DEST["type"] == "gcs":
        t2 = ee.batch.Export.table.toCloudStorage(collection=fc, description="fields_v2_geojson", bucket=config.DEST["bucket"],
                                                  fileNamePrefix=f"{config.DEST.get('prefix', 'fieldshift_v2')}/fields_v2",
                                                  fileFormat="GeoJSON")
    else:
        t2 = ee.batch.Export.table.toDrive(collection=fc, description="fields_v2_geojson", folder=config.DEST["folder"],
                                           fileNamePrefix="fields_v2", fileFormat="GeoJSON")
    t1.start()
    t2.start()
    print("started fields_v2_asset and fields_v2_geojson; waiting for the asset (Ctrl+C is safe, it keeps running)")
    while t1.status()["state"] in ("READY", "RUNNING"):
        time.sleep(20)
    st = t1.status()
    if st["state"] != "COMPLETED":
        sys.exit(f"asset export {st['state']}: {st.get('error_message')}")
    ee.data.setAssetAcl(config.FIELDS_ASSET, json.dumps({"all_users_can_read": True}))
    n = ee.FeatureCollection(config.FIELDS_ASSET).size().getInfo()
    print(f"done: {n} fields in {config.FIELDS_ASSET}, readable by all accounts. Tell accounts 2-6 to start.")


if __name__ == "__main__":
    main()
