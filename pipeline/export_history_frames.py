"""Export fixed-view Landsat natural-color frames for the Field History replay."""

import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

import ee

# The original one-field exporter remains available below. Bulk mode uses shared
# scene rasters with separate, georeferenced per-field views and QA measurements.
from history_archive import export_archive


ROOT = Path(__file__).resolve().parents[1]
MONTHS = (2, 4, 6, 8, 10, 12)


def export_frames(field_id, start_year, end_year):
    outlines = json.loads((ROOT / "shared/field-outlines.json").read_text(encoding="utf-8"))
    field = next(item for item in outlines["fields"] if item["id"] == field_id)
    rings = [[[lon, lat] for lat, lon in ring] for ring in field["rings"]]
    geometry = ee.Geometry.Polygon(rings)
    projection = ee.Projection("EPSG:3857")
    view = geometry.centroid(1).buffer(720, 1).bounds(1, projection)
    outline = ee.Image().byte().paint(geometry, 1, 2).visualize(
        min=0, max=1, palette=["000000", "e1ff6a"]
    )

    # Bits 0–5 flag fill, dilated cloud, cirrus, cloud, cloud shadow or snow.
    def with_clear_fraction(image):
        clear = image.select("QA_PIXEL").bitwiseAnd(63).eq(0).unmask(0)
        fraction = clear.reduceRegion(ee.Reducer.mean(), geometry, 30).get("QA_PIXEL")
        return image.set("field_clear_fraction", fraction)

    scenes = (
        ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
        .merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
        .filterBounds(geometry)
        .filterDate(f"{start_year}-01-01", f"{end_year + 1}-01-01")
        .filter(ee.Filter.lt("CLOUD_COVER", 75))
    )

    def download(year_month):
        year, month = year_month
        start = ee.Date.fromYMD(year, month, 1)
        candidates = (
            scenes.filterDate(start, start.advance(1, "month"))
            .map(with_clear_fraction)
            .filter(ee.Filter.gte("field_clear_fraction", 0.98))
            .sort("CLOUD_COVER")
        )
        if not candidates.size().getInfo():
            return None
        image = ee.Image(candidates.first())
        date = image.date().format("YYYY-MM-dd").getInfo()
        natural_color = image.select(["SR_B4", "SR_B3", "SR_B2"]).multiply(0.0000275).add(-0.2)
        rendered = natural_color.visualize(min=0.02, max=0.28, gamma=1.15).blend(outline)
        url = rendered.getThumbURL({
            "region": view, "crs": "EPSG:3857", "dimensions": "480x480", "format": "jpg",
        })
        with urlopen(url, timeout=90) as response:
            return date, response.read()

    dates = [(year, month) for year in range(start_year, end_year + 1) for month in MONTHS]
    with ThreadPoolExecutor(max_workers=4) as executor:
        frames = [frame for frame in executor.map(download, dates) if frame is not None]
    if not frames:
        raise RuntimeError(f"No clear scenes for {field_id} in {start_year}–{end_year}")

    output = ROOT / "app/public/history" / field_id
    output.mkdir(parents=True, exist_ok=True)
    for date, image in frames:
        (output / f"{date}.jpg").write_bytes(image)
    manifest = {"fieldId": field_id, "dates": [date for date, _ in frames]}
    (ROOT / "app/src/data" / f"history-{field_id}.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Exported {len(frames)} Landsat frames for {field_id}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("field_id", help="Field id, or 'all' for the shared 300-field archive")
    parser.add_argument("start_year", type=int)
    parser.add_argument("end_year", type=int)
    parser.add_argument("--project", required=True, help="Authorized Earth Engine project")
    args = parser.parse_args()
    ee.Initialize(project=args.project)
    if args.field_id == 'all':
        export_archive(args.start_year, args.end_year)
    else:
        export_frames(args.field_id, args.start_year, args.end_year)
