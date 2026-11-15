"""Shared Landsat scenes; independent field QA, fixed views, and provenance.

No model output is read. QA follows USGS Collection 2 QA_PIXEL bits 0–5
and QA_RADSAT. A frame must have >=98% clear, unsaturated field pixels.
"""
import hashlib
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

import ee

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'app/public/history'
MONTHS = (2, 4, 6, 8, 10, 12)
SIZE = 1200


def mercator(lat, lon):
    return (6378137 * math.radians(lon),
            6378137 * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(',', ':')) + '\n', encoding='utf-8')


def retry(fn):
    for attempt in range(4):
        try:
            return fn()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def export_archive(start_year, end_year):
    fields = json.loads((ROOT / 'shared/field-outlines.json').read_text())['fields']
    points = [mercator(*p) for f in fields for ring in f['rings'] for p in ring]
    xmin, ymin = [min(p[i] for p in points) - 1000 for i in (0, 1)]
    xmax, ymax = [max(p[i] for p in points) + 1000 for i in (0, 1)]
    # Square, north-up EPSG:3857 image. These exact bounds also drive the SVG.
    side = max(xmax - xmin, ymax - ymin)
    cx, cy = (xmin + xmax) / 2, (ymin + ymax) / 2
    bounds = [cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2]
    region = ee.Geometry.Rectangle(bounds, 'EPSG:3857', False)
    features = ee.FeatureCollection([
        ee.Feature(ee.Geometry.Polygon([[[lon, lat] for lat, lon in ring]
                                       for ring in f['rings']]), {'id': f['id']})
        for f in fields])
    collection = (ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
                  .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
                  .filterBounds(region).filter(ee.Filter.lt('CLOUD_COVER', 75)))
    periods = [(y, m) for y in range(start_year, end_year + 1) for m in MONTHS]
    cache = ROOT / 'pipeline/data/history-scene-metadata'
    cache.mkdir(parents=True, exist_ok=True)

    def period_frames(ym):
        year, month = ym
        key = f'{year}-{month:02}'
        record = cache / f'{key}-v3.json'
        if record.exists():
            return json.loads(record.read_text())
        start = ee.Date.fromYMD(year, month, 1)
        candidates = collection.filterDate(start, start.advance(1, 'month')).sort('CLOUD_COVER').limit(12)

        def quality(image):
            image = ee.Image(image)
            clear = (image.select('QA_PIXEL').bitwiseAnd(63).eq(0)
                     .And(image.select('QA_RADSAT').eq(0)))
            # QA can call severely overcorrected/negative-reflectance pixels clear.
            # Reject unusably dark/bright optical data rather than exporting black frames.
            brightness = image.select(['SR_B4', 'SR_B3', 'SR_B2']).reduce(ee.Reducer.mean()).multiply(.0000275).add(-.2)
            clear = clear.And(brightness.gte(.025)).And(brightness.lte(.65)).unmask(0, sameFootprint=False).rename('clear')
            measured = clear.reduceRegions(features, ee.Reducer.mean(), scale=30, tileScale=2)
            return ee.Dictionary({'sceneId': image.get('system:id'),
                                  'date': image.date().format('YYYY-MM-dd'),
                                  'ids': measured.aggregate_array('id'),
                                  'clear': measured.aggregate_array('mean')})

        rows = retry(lambda: candidates.toList(12).map(quality).getInfo())
        # Add a shared scene only when it supplies previously missing fields.
        chosen, covered = [], set()
        while rows:
            def usable(row):
                return {i for i, q in zip(row['ids'], row['clear']) if q is not None and q >= .98}
            best = max(rows, key=lambda r: len(usable(r) - covered))
            if not (usable(best) - covered):
                break
            rows.remove(best)
            chosen.append(best)
            covered |= usable(best)
        write_json(record, chosen)
        print(f'{key}: {len(chosen)} shared scenes, {len(covered)}/300 clear fields', flush=True)
        return chosen

    with ThreadPoolExecutor(max_workers=3) as pool:
        selected = list(pool.map(period_frames, periods))
    scenes = {r['sceneId']: r for rows in selected for r in rows}
    (OUT / 'scenes').mkdir(exist_ok=True)

    def download(row):
        name = row['sceneId'].split('/')[-1] + '.jpg'
        path = OUT / 'scenes' / name
        if not path.exists():
            image = ee.Image(row['sceneId']).select(['SR_B4', 'SR_B3', 'SR_B2']).multiply(.0000275).add(-.2)
            def fetch():
                url = image.visualize(min=.02, max=.28, gamma=1.15).getThumbURL({
                    'region': region, 'crs': 'EPSG:3857', 'dimensions': f'{SIZE}x{SIZE}', 'format': 'jpg'})
                with urlopen(url, timeout=120) as response:
                    return response.read()
            path.write_bytes(retry(fetch))
        row['src'] = 'history/scenes/' + name
        row['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        print('Downloaded', name, path.stat().st_size, flush=True)

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(download, scenes.values()))

    reports = []
    for field in fields:
        rings = [[[round((x - bounds[0]) / side * SIZE, 4),
                   round((bounds[3] - y) / side * SIZE, 4)]
                  for x, y in [mercator(*p) for p in ring]] for ring in field['rings']]
        pts = [p for ring in rings for p in ring]
        lo = [min(p[i] for p in pts) for i in (0, 1)]
        hi = [max(p[i] for p in pts) for i in (0, 1)]
        width = max(hi[0] - lo[0], hi[1] - lo[1], 55) * 1.35
        view = [(lo[0] + hi[0] - width) / 2, (lo[1] + hi[1] - width) / 2, width, width]
        frames, missing = [], []
        for ym, rows in zip(periods, selected):
            available = []
            for row in rows:
                q = dict(zip(row['ids'], row['clear'])).get(field['id'])
                if q is not None and q >= .98:
                    scene = scenes[row['sceneId']]
                    available.append({'date': row['date'], 'src': scene['src'],
                                      'sceneId': row['sceneId'], 'clearFraction': round(q, 5)})
            if not available:
                missing.append(f'{ym[0]}-{ym[1]:02}')
            else:
                # One date per sampling month; favor field-specific quality.
                frames.append(max(available, key=lambda f: f['clearFraction']))
        frames.sort(key=lambda f: f['date'])
        manifest = {'version': 1, 'fieldId': field['id'], 'period': [start_year, end_year],
                    'projection': 'EPSG:3857', 'bounds': bounds, 'imageSize': SIZE,
                    'viewBox': view, 'rings': rings, 'frames': frames, 'missingPeriods': missing,
                    'clearThreshold': .98, 'samplingMonths': list(MONTHS)}
        write_json(OUT / 'fields' / (field['id'] + '.json'), manifest)
        reports.append({'fieldId': field['id'], 'frames': len(frames), 'missingPeriods': missing})
    report = {'period': [start_year, end_year], 'fields': len(fields),
              'playable': sum(r['frames'] >= 2 for r in reports),
              'frameCountRange': [min(r['frames'] for r in reports), max(r['frames'] for r in reports)],
              'sharedScenes': len(scenes), 'sceneBytes': sum((ROOT / 'app/public' / r['src']).stat().st_size for r in scenes.values()),
              'fieldsWithGaps': [r for r in reports if r['missingPeriods']],
              'results': reports,
              'scenes': [{k: r[k] for k in ('date', 'sceneId', 'src', 'sha256')} for r in scenes.values()]}
    write_json(OUT / 'coverage.json', report)
    print(json.dumps({k: v for k, v in report.items() if k not in ('results', 'scenes', 'fieldsWithGaps')}), flush=True)
