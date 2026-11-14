"""Cropland mask for the map: "does the spot the farmer tapped look like cropland?"

Same cropland rule as the field sample (sample_fields.py): USDA CDL cropland in 2024 AND cropland in at least half
of the CDL years 2008-2025. The 30 m pixels are averaged onto a ~400 m grid (0.004 deg) over the North Texas box;
a cell is cropland when >= 25 % of its pixels are. Output: shared/cropland-mask.json (format in shared/data-format.md).

Usage (from the repo root):
    pipeline/.venv/Scripts/python pipeline/build_cropland_mask.py
"""
import base64
import io
import json
import sys
from pathlib import Path

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from greenline_pipeline import ee_init  # noqa: E402
from sample_fields import BBOX, Y0, Y1, is_cropland  # noqa: E402

CELL_DEG = 0.004   # ~400 m north-south, ~370 m east-west at 33 N
THRESHOLD = 0.25   # share of 30 m cropland pixels for a cell to count as cropland
TILES = 5          # download in 5 x 5 pieces (request size limit)
OUT = Path(__file__).resolve().parent.parent / "shared" / "cropland-mask.json"


def main():
    ee = ee_init()
    west, south, east, north = BBOX
    cols = round((east - west) / CELL_DEG)
    rows = round((north - south) / CELL_DEG)
    cdl = ee.ImageCollection("USDA/NASS/CDL")
    crop24 = is_cropland(ee.Image("USDA/NASS/CDL/2024"))
    often = cdl.filterDate(f"{Y0}-01-01", f"{Y1 + 1}-01-01").map(is_cropland).mean().gte(0.5)
    # Work at 30 m (CDL 2024 itself is finer), then average onto the grid.
    p30 = ee.Image("USDA/NASS/CDL/2023").projection().atScale(30)
    crop = crop24.And(often).unmask(0).rename("crop").reproject(p30)
    share = crop.reduceResolution(ee.Reducer.mean(), maxPixels=1024).toFloat()
    # Earth Engine limits how big one request can be, so download in TILES x TILES pieces.
    grid = np.zeros((rows, cols))
    tc, tr = -(-cols // TILES), -(-rows // TILES)
    for r0 in range(0, rows, tr):
        for c0 in range(0, cols, tc):
            h, w = min(tr, rows - r0), min(tc, cols - c0)
            print(f"  tile rows {r0}-{r0 + h}, cols {c0}-{c0 + w}")
            url = share.getDownloadURL({
                "format": "NPY",
                "crs": "EPSG:4326",
                "crs_transform": [CELL_DEG, 0, west + c0 * CELL_DEG, 0, -CELL_DEG, north - r0 * CELL_DEG],
                "dimensions": [w, h],
            })
            r = requests.get(url, timeout=600)
            if not r.ok:
                sys.exit(f"Earth Engine download failed: {r.status_code} {r.text[:500]}")
            arr = np.load(io.BytesIO(r.content))
            tile = np.asarray(arr["crop"] if arr.dtype.names else arr, dtype=float)
            assert tile.shape == (h, w), tile.shape
            grid[r0:r0 + h, c0:c0 + w] = tile
    bits = np.packbits((np.nan_to_num(grid) >= THRESHOLD).astype(np.uint8).ravel())  # row-major from the NW corner
    OUT.write_text(json.dumps({
        "schemaVersion": 1,
        "source": "USDA NASS Cropland Data Layer via Earth Engine (USDA/NASS/CDL). Cropland in 2024 and in at least "
                  f"half of {Y0}-{Y1} (same rule as the 200 sampled fields). Built by pipeline/build_cropland_mask.py.",
        "years": [Y0, Y1],
        "bbox": BBOX,
        "cellDeg": CELL_DEG,
        "threshold": THRESHOLD,
        "cols": cols,
        "rows": rows,
        "bits": base64.b64encode(bits.tobytes()).decode(),
    }, separators=(",", ":")) + "\n")
    print(f"wrote {OUT.name}: {int((grid >= THRESHOLD).sum())} of {grid.size} cells are cropland, "
          f"{OUT.stat().st_size / 1024:.0f} kB")


if __name__ == "__main__":
    main()
