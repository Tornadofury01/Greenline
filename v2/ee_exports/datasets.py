"""Earth Engine builders: one function per dataset, job -> (FeatureCollection, CSV columns).

Output shapes (the cube builder harmonizes them later, Earth Engine doesn't):
  per scene   optical / radar: one row per field per image. <band>_p10/_p50/_p90/_count over clear pixels inside the
              45 m-buffered field; tot_count = field pixels inside the image footprint, so clear share = ndvi_count / tot_count.
  per month   daily grids: one row per field per month, columns dDD_<band> (area-weighted mean). Missing days = empty.
  per field   static layers.
  per point   very coarse grids (GRACE, GLDAS, CMIP6): value at each county's centroid.

Columns are always passed explicitly (`selectors`): EE otherwise takes them from the first row, and a cloudy first
row would drop columns for the whole file.

Check each collection's catalog page before the first run: IDs and band names get version bumps.
"""
import calendar, math

import ee

import config

STATS = ("p10", "p50", "p90", "count")
SR6 = ["blue", "green", "red", "nir", "swir1", "swir2"]


# ---------- helpers ----------

def fields():
    """All study fields (every job covers the whole North Texas study area)."""
    return ee.FeatureCollection(config.FIELDS_ASSET).select(["fid", "cfips"])


def counties():
    return ee.FeatureCollection("TIGER/2018/Counties").filter(ee.Filter.inList("GEOID", list(config.COUNTIES)))


def region():
    return counties().geometry(100).bounds(100)


def county_points():
    return counties().map(lambda c: ee.Feature(c.geometry().centroid(100), {"cfips": c.get("GEOID")}))


def _set(fc, props):
    return fc.map(lambda f: f.set(props))


def _year_range(year):
    return f"{year}-01-01", f"{year + 1}-01-01"


def _indices(sr):
    """NDVI (green), NDTI (residue), BSI (bare soil). Same formulas for every sensor."""
    ndvi = sr.normalizedDifference(["nir", "red"]).rename("ndvi")
    ndti = sr.normalizedDifference(["swir1", "swir2"]).rename("ndti")
    bsi = sr.expression("((S + R) - (N + B)) / ((S + R) + (N + B))",
                        {"S": sr.select("swir1"), "R": sr.select("red"),
                         "N": sr.select("nir"), "B": sr.select("blue")}).rename("bsi")
    return ee.Image.cat([sr, ndvi, ndti, bsi])


# ---------- per scene: optical ----------

def _optical(job, col, prep, bands, scale, sensor, props):
    """prep(img) -> (data with `bands`, clear mask, footprint mask, snow mask)."""
    fc = fields()
    col = col.filterBounds(region()).filterDate(*_year_range(job.year))
    red = ee.Reducer.percentile([10, 50, 90]).combine(ee.Reducer.count(), sharedInputs=True)

    def per_image(img):
        data, clear, foot, snow = prep(img)
        stack = ee.Image.cat([data.updateMask(clear.And(foot)),
                              ee.Image.constant(1).rename("tot").updateMask(foot),
                              snow.And(foot).selfMask().rename("snow")])
        out = stack.reduceRegions(collection=fc.filterBounds(img.geometry()), reducer=red, scale=scale, tileScale=4)
        meta = {"date": img.date().format("YYYY-MM-dd"), "scene": img.get("system:index"), "sensor": sensor}
        meta.update({k: img.get(v) for k, v in props.items()})
        return _set(out, meta)

    out = col.map(per_image).flatten().filter(ee.Filter.gt("tot_count", 0))
    sel = ["fid", "cfips", "date", "scene", "sensor", *props, "tot_count", "snow_count"]
    return out, sel + [f"{b}_{s}" for b in bands for s in STATS]


LANDSAT = {
    "ls5": ("LANDSAT/LT05/C02/T1_L2", ["SR_B1", "SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B7"], "ST_B6"),
    "ls7": ("LANDSAT/LE07/C02/T1_L2", ["SR_B1", "SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B7"], "ST_B6"),
    "ls8": ("LANDSAT/LC08/C02/T1_L2", ["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7"], "ST_B10"),
    "ls9": ("LANDSAT/LC09/C02/T1_L2", ["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7"], "ST_B10"),
}


def landsat(job):
    sensor = "ls7" if job.ds == "ls7more" else job.ds
    cid, srb, stb = LANDSAT[sensor]

    def prep(img):
        qa = img.select("QA_PIXEL")
        sr = img.select(srb, SR6).multiply(2.75e-05).add(-0.2)          # Collection 2 L2 scale + offset
        st = img.select(stb).multiply(0.00341802).add(149.0 - 273.15).rename("st_c")
        clear = qa.bitwiseAnd(0b111110).eq(0).And(img.select("QA_RADSAT").eq(0))  # dilated cloud, cirrus, cloud, shadow, snow
        foot = qa.bitwiseAnd(1).eq(0)                                    # not fill (L7 SLC-off stripes are fill)
        snow = qa.bitwiseAnd(1 << 5).neq(0).And(qa.bitwiseAnd(0b11010).eq(0))
        return ee.Image.cat([_indices(sr), st]), clear, foot, snow

    bands = SR6 + ["ndvi", "ndti", "bsi", "st_c"]
    return _optical(job, ee.ImageCollection(cid), prep, bands, 30, sensor,
                    {"cloud_cover": "CLOUD_COVER", "sun_elev": "SUN_ELEVATION"})


def hls(job):
    """HLS v002. Indices don't depend on the reflectance scale; if raw bands come out as 0-10000, divide later."""
    s30 = job.ds == "hlss30"
    cid = "NASA/HLS/HLSS30/v002" if s30 else "NASA/HLS/HLSL30/v002"
    b6 = ["B2", "B3", "B4", "B8A", "B11", "B12"] if s30 else ["B2", "B3", "B4", "B5", "B6", "B7"]

    def prep(img):
        f = img.select("Fmask")
        data = _indices(img.select(b6, SR6))
        if s30:
            re = img.select(["B5", "B6", "B7"], ["re1", "re2", "re3"])
            allb = data.addBands(re)
            data = ee.Image.cat([allb, allb.normalizedDifference(["nir", "re1"]).rename("ndre"),
                                 allb.select("re3").divide(allb.select("re1")).subtract(1).rename("cire")])
        clear = f.bitwiseAnd(0b11110).eq(0)                              # cloud, adjacent, shadow, snow
        foot = img.select(b6[0]).mask().gt(0)
        snow = f.bitwiseAnd(1 << 4).neq(0).And(f.bitwiseAnd(0b1110).eq(0))
        return data, clear, foot, snow

    bands = SR6 + ["ndvi", "ndti", "bsi"] + (["re1", "re2", "re3", "ndre", "cire"] if s30 else [])
    return _optical(job, ee.ImageCollection(cid), prep, bands, 30, job.ds, {"cloud_cover": "CLOUD_COVERAGE"})


def s2sr(job):
    """Optional: Sentinel-2 L2A for red-edge at native 20 m."""
    def prep(img):
        scl = img.select("SCL")
        sr = img.select(["B2", "B3", "B4", "B8A", "B11", "B12"], SR6).multiply(1e-4)
        re = img.select(["B5", "B6", "B7"], ["re1", "re2", "re3"]).multiply(1e-4)
        allb = _indices(sr).addBands(re)
        data = ee.Image.cat([allb, allb.normalizedDifference(["nir", "re1"]).rename("ndre"),
                             allb.select("re3").divide(allb.select("re1")).subtract(1).rename("cire")])
        clear = scl.eq(4).Or(scl.eq(5)).Or(scl.eq(6))                    # vegetation, bare, water
        return data, clear, img.select("B2").mask().gt(0), scl.eq(11)

    col = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 90))
    bands = SR6 + ["ndvi", "ndti", "bsi", "re1", "re2", "re3", "ndre", "cire"]
    return _optical(job, col, prep, bands, 20, "s2", {"cloud_cover": "CLOUDY_PIXEL_PERCENTAGE"})


# ---------- per scene: radar ----------

def s1(job):
    """Sentinel-1 IW VV+VH. Exported in LINEAR power (averaging dB is wrong); convert to dB in the cube builder.
    Keep pass + relative orbit: backscatter differs by look angle, so compare like with like."""
    fc = fields()
    col = (ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(region()).filterDate(*_year_range(job.year))
           .filter(ee.Filter.eq("instrumentMode", "IW"))
           .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
           .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH")))
    red = (ee.Reducer.mean().combine(ee.Reducer.percentile([10, 50, 90]), sharedInputs=True)
           .combine(ee.Reducer.count(), sharedInputs=True))

    def per_image(img):
        db = img.select(["VV", "VH"])
        ok = db.gt(-30).reduce(ee.Reducer.min())                        # drop border noise / no-data
        lin = ee.Image(10).pow(db.divide(10)).rename(["vv", "vh"])
        data = ee.Image.cat([lin, lin.select("vh").divide(lin.select("vv")).rename("vh_vv"),
                             img.select("angle")]).updateMask(ok)
        out = data.reduceRegions(collection=fc.filterBounds(img.geometry()), reducer=red, scale=20, tileScale=4)
        return _set(out, {"date": img.date().format("YYYY-MM-dd"), "scene": img.get("system:index"),
                          "platform": img.get("platform_number"), "pass": img.get("orbitProperties_pass"),
                          "rel_orbit": img.get("relativeOrbitNumber_start")})

    out = col.map(per_image).flatten().filter(ee.Filter.gt("vv_count", 0))
    sel = ["fid", "cfips", "date", "scene", "platform", "pass", "rel_orbit"]
    return out, sel + [f"{b}_{s}" for b in ("vv", "vh", "vh_vv", "angle") for s in ("mean", "p10", "p50", "p90", "count")]


# ---------- per month: daily grids ----------

def _tag(img):
    dd = ee.Date(img.get("system:time_start")).format("dd")
    return img.rename(img.bandNames().map(lambda b: ee.String("d").cat(dd).cat("_").cat(b)))


def _stack(col):
    """Daily images -> one image with bands dDD_<band>, so a month is ONE reduction instead of ~30."""
    return ee.Image(col.map(_tag).iterate(lambda img, acc: ee.Image(acc).addBands(img), ee.Image().select([])))


def _daily(col, start, ndays, agg):
    """Sub-daily collection -> daily images via agg(ImageCollection of one UTC day) -> Image."""
    def one(d):
        s = start.advance(d, "day")
        return ee.Image(agg(col.filterDate(s, s.advance(1, "day")))).set("system:time_start", s.millis())
    return ee.ImageCollection(ee.List.sequence(0, ndays - 1).map(one))


def _keep_time(img, out):
    return ee.Image(out).copyProperties(img, ["system:time_start"])


def _monthly(job, month_col, bands, scale):
    """month_col(start, end, ndays) -> daily ImageCollection with `bands`."""
    fc = fields()
    parts = []
    for m in range(1, 13):
        nd = calendar.monthrange(job.year, m)[1]
        s = ee.Date.fromYMD(job.year, m, 1)
        img = _stack(month_col(s, s.advance(1, "month"), nd))
        out = img.reduceRegions(collection=fc, reducer=ee.Reducer.mean(), scale=scale, tileScale=2)
        parts.append(_set(out, {"year": job.year, "month": m}))
    sel = ["fid", "cfips", "year", "month"] + [f"d{d:02d}_{b}" for d in range(1, 32) for b in bands]
    return ee.FeatureCollection(parts).flatten(), sel


def _simple(cid, bands, names=None, fn=None):
    def month_col(s, e, nd):
        col = ee.ImageCollection(cid).filterDate(s, e)
        col = col.map(lambda i: _keep_time(i, fn(i))) if fn else col.select(bands, names or bands)
        return col
    return month_col


DAILY = {
    # key: (month_col builder, output bands, scale m)
    "daymet": (_simple("NASA/ORNL/DAYMET_V4", ["prcp", "tmax", "tmin", "srad", "vp", "dayl", "swe"]),
               ["prcp", "tmax", "tmin", "srad", "vp", "dayl", "swe"], 1000),
    # gridMET temperatures are in kelvin; eto = grass reference ET (mm)
    "gridmet": (_simple("IDAHO_EPSCOR/GRIDMET", ["pr", "tmmx", "tmmn", "rmax", "rmin", "vs", "srad", "eto", "vpd"]),
                ["pr", "tmmx", "tmmn", "rmax", "rmin", "vs", "srad", "eto", "vpd"], 4638.3),
    "prism": (_simple("OREGONSTATE/PRISM/AN81d", ["ppt", "tmean", "tmax", "tmin", "vpdmax", "vpdmin"]),
              ["ppt", "tmean", "tmax", "tmin", "vpdmax", "vpdmin"], 4638.3),
    # one image every 5 days
    "gmdrought": (_simple("GRIDMET/DROUGHT", ["pdsi", "z", "spi30d", "spi90d", "spi180d", "spi1y",
                                               "spei30d", "spei90d", "spei180d", "spei1y", "eddi30d", "eddi90d"]),
                  ["pdsi", "z", "spi30d", "spi90d", "spi180d", "spi1y",
                   "spei30d", "spei90d", "spei180d", "spei1y", "eddi30d", "eddi90d"], 4638.3),
    # bit 0 of the retrieval flag = not recommended quality
    "smapl3": (_simple("NASA/SMAP/SPL3SMP_E/006", None, fn=lambda i: ee.Image.cat([
        i.select("soil_moisture_am").updateMask(i.select("retrieval_qual_flag_am").bitwiseAnd(1).eq(0)).rename("sm_am"),
        i.select("soil_moisture_pm").updateMask(i.select("retrieval_qual_flag_pm").bitwiseAnd(1).eq(0)).rename("sm_pm")])),
        ["sm_am", "sm_pm"], 9000),
    "mod13q1": (_simple("MODIS/061/MOD13Q1", None, fn=lambda i: i.select(["NDVI", "EVI"], ["ndvi", "evi"])
                        .multiply(1e-4).updateMask(i.select("SummaryQA").lte(1))),
                ["ndvi", "evi"], 250),
    "mod16": (_simple("MODIS/061/MOD16A2GF", None, fn=lambda i: i.select(["ET", "PET"], ["et", "pet"])
                      .updateMask(i.select("ET").lt(32700)).multiply(0.1)),  # kg/m2 (= mm) per 8 days
              ["et", "pet"], 500),
}


def smapl4_month(s, e, nd):
    col = ee.ImageCollection("NASA/SMAP/SPL4SMGP/007").filterDate(s, e).select(["sm_surface", "sm_rootzone", "sm_profile"])
    return _daily(col, s, nd, lambda c: c.mean())


def imerg_month(s, e, nd):
    """Daily rain (mm), peak 30-min rate (mm/h, the I30 that drives RUSLE erosion), wet half-hours. UTC days."""
    col = ee.ImageCollection("NASA/GPM_L3/IMERG_V07").filterDate(s, e).select("precipitation")
    return _daily(col, s, nd, lambda c: ee.Image.cat([c.sum().multiply(0.5).rename("rain"),
                                                       c.max().rename("i30"),
                                                       c.map(lambda i: i.gt(0.1)).sum().rename("wethh")]))


def lst_month(s, e, nd):
    """MODIS land surface temperature, Terra (~10:30 / 22:30) and Aqua (~13:30 / 01:30), deg C, good-quality only."""
    def prep(prefix):
        def f(i):
            good_d = i.select("QC_Day").bitwiseAnd(3).eq(0)
            good_n = i.select("QC_Night").bitwiseAnd(3).eq(0)
            return _keep_time(i, ee.Image.cat([
                i.select("LST_Day_1km").multiply(0.02).subtract(273.15).updateMask(good_d).rename(f"{prefix}_day"),
                i.select("LST_Night_1km").multiply(0.02).subtract(273.15).updateMask(good_n).rename(f"{prefix}_night")]))
        return f
    terra = ee.ImageCollection("MODIS/061/MOD11A1").filterDate(s, e).map(prep("t"))
    aqua = ee.ImageCollection("MODIS/061/MYD11A1").filterDate(s, e).map(prep("a"))
    return terra.merge(aqua)


DAILY["smapl4"] = (smapl4_month, ["sm_surface", "sm_rootzone", "sm_profile"], 9000)
DAILY["imerg"] = (imerg_month, ["rain", "i30", "wethh"], 11132)
DAILY["modlst"] = (lst_month, ["t_day", "t_night", "a_day", "a_night"], 1000)


def daily(job):
    month_col, bands, scale = DAILY[job.ds]
    return _monthly(job, month_col, bands, scale)


# ---------- per field: static and yearly layers ----------

def terrain(job):
    """3DEP 10 m and SRTM 30 m elevation and slope; MERIT Hydro terrain wetness index and height above drainage."""
    fc = fields()
    red = ee.Reducer.mean().combine(ee.Reducer.percentile([10, 90]), sharedInputs=True)

    def layer(img, scale, name):
        return _set(img.reduceRegions(collection=fc, reducer=red, scale=scale, tileScale=4), {"layer": name})

    dem = ee.Image("USGS/3DEP/10m").select("elevation")
    srtm = ee.Image("USGS/SRTMGL1_003").select("elevation")
    merit = ee.Image("MERIT/Hydro/v1_0_1")
    slope_rad = ee.Terrain.slope(merit.select("elv")).multiply(math.pi / 180).max(0.001)
    twi = merit.select("upa").multiply(1e6).divide(90).divide(slope_rad.tan()).log().rename("twi")
    parts = [layer(ee.Image.cat([dem.rename("elev"), ee.Terrain.slope(dem).rename("slope_deg")]), 10, "3dep"),
             layer(ee.Image.cat([srtm.rename("elev"), ee.Terrain.slope(srtm).rename("slope_deg")]), 30, "srtm"),
             layer(ee.Image.cat([twi, merit.select("hnd")]), 90, "merit")]
    sel = ["fid", "cfips", "layer"] + [f"{b}_{s}" for b in ("elev", "slope_deg", "twi", "hnd") for s in ("mean", "p10", "p90")]
    return ee.FeatureCollection(parts).flatten(), sel


def cdl(job):
    """USDA CDL 2008+ per field-year: pixel histogram (-> majority crop and purity), mode, mean CDL confidence."""
    fc = fields()
    red = (ee.Reducer.frequencyHistogram().combine(ee.Reducer.mode(), sharedInputs=True)
           .combine(ee.Reducer.mean(), sharedInputs=True).unweighted())
    col = ee.ImageCollection("USDA/NASS/CDL").filterDate("2008-01-01", "2026-01-01").select(["cropland", "confidence"])

    def per(img):
        out = img.reduceRegions(collection=fc, reducer=red, scale=30, tileScale=4)
        return _set(out, {"year": img.date().get("year")})

    return col.map(per).flatten(), ["fid", "cfips", "year", "cropland_histogram", "cropland_mode", "confidence_mean"]


def irrmapper(job):
    """IrrMapper (western states): irrigated share of each field per year. Empty outside its coverage."""
    fc = fields()
    red = ee.Reducer.mean().combine(ee.Reducer.count(), sharedInputs=True).setOutputs(["irr_frac", "irr_px"])
    col = ee.ImageCollection("UMT/Climate/IrrMapper_RF/v1_2").filterBounds(region())

    def per(img):
        out = img.select("classification").eq(0).reduceRegions(collection=fc, reducer=red, scale=30, tileScale=4)
        return _set(out, {"year": img.date().get("year")})

    return col.map(per).flatten(), ["fid", "cfips", "year", "irr_frac", "irr_px"]


def openet(job):
    """Optional: OpenET ensemble monthly ET (mm), 30 m."""
    fc = fields()
    col = ee.ImageCollection("OpenET/ENSEMBLE/CONUS/GRIDMET/MONTHLY/v2_0").filterBounds(region()).select("et_ensemble_mad")

    def per(img):
        out = img.reduceRegions(collection=fc, reducer=ee.Reducer.mean().setOutputs(["et_mm"]), scale=30, tileScale=4)
        return _set(out, {"date": img.date().format("YYYY-MM")})

    return col.map(per).flatten(), ["fid", "cfips", "date", "et_mm"]


# ---------- per point: very coarse grids ----------

def _points(col, scale, cols, extra=None):
    pts = county_points()

    def per(img):
        meta = {"date": img.date().format("YYYY-MM-dd")}
        meta.update({k: img.get(k) for k in (extra or [])})
        return _set(img.reduceRegions(collection=pts, reducer=ee.Reducer.first(), scale=scale), meta)

    return col.map(per).flatten(), ["cfips", "date", *(extra or []), *cols]


def grace(job):
    """JPL mascons, monthly equivalent water thickness anomaly (cm)."""
    return _points(ee.ImageCollection("NASA/GRACE/MASS_GRIDS_V04/MASCON_CRI"), 55660, ["lwe_thickness", "uncertainty"])


def gldas(job):
    """GLDAS 2.2 Catchment daily: groundwater (GWS), total (TWS) and root-zone soil water, mm. GRACE - soil = groundwater."""
    b = ["GWS_tavg", "TWS_tavg", "SoilMoist_RZ_tavg"]
    col = ee.ImageCollection("NASA/GLDAS/V022/CLSM/G025/DA1D").filterDate("2003-01-01", "2026-01-01").select(b)
    return _points(col, 27830, b)


def cmip6(job):
    """NEX-GDDP-CMIP6 daily, one model x one run. All bands kept (some models lack hurs/huss: empty column)."""
    y0, y1 = config.CMIP6_RUNS[job.run]
    col = (ee.ImageCollection("NASA/GDDP-CMIP6").filter(ee.Filter.eq("model", job.model))
           .filter(ee.Filter.eq("scenario", job.run)).filterDate(f"{y0}-01-01", f"{y1 + 1}-01-01"))
    return _points(col, 27830, ["pr", "tas", "tasmax", "tasmin", "hurs", "huss", "rsds", "rlds", "sfcWind"],
                   extra=["model", "scenario"])


BUILDERS = {**{k: landsat for k in LANDSAT}, "ls7more": landsat, "hlsl30": hls, "hlss30": hls, "s2sr": s2sr, "s1": s1,
            **{k: daily for k in DAILY}, "terrain": terrain, "cdl": cdl, "irrmapper": irrmapper, "openet": openet,
            "grace": grace, "gldas": gldas, "cmip6": cmip6}


def build(job):
    return BUILDERS[job.ds](job)
