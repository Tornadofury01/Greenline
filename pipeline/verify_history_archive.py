"""Audit every mapped field, scene asset, date, fixed view and projected outline.

Run with the pipeline virtualenv (Pillow needed to decode and check images).
"""
import hashlib
import json
from collections import Counter
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageStat
from history_archive import mercator

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'app/public'
OUT = PUBLIC / 'history'


def verify():
    fields = json.loads((ROOT / 'shared/field-outlines.json').read_text())['fields']
    report = json.loads((OUT / 'coverage.json').read_text())
    expected = {f['id'] for f in fields}
    assert len(expected) == 300
    assert {p.stem for p in (OUT / 'fields').glob('*.json')} == expected
    scenes = {s['src']: s for s in report['scenes']}
    images = {}
    for src, scene in scenes.items():
        path = PUBLIC / src
        assert path.resolve().is_relative_to(OUT.resolve())
        assert hashlib.sha256(path.read_bytes()).hexdigest() == scene['sha256'], src
        with Image.open(path) as image:
            image.load()
            assert image.size == (1200, 1200) and image.format == 'JPEG'
            images[src] = image.convert('RGB')
        assert date.fromisoformat(scene['date']).strftime('%Y%m%d') in scene['sceneId']
    counts, gaps, missing_labels, dark = [], [], [], []
    for field in fields:
        fid = field['id']
        manifest = json.loads((OUT / 'fields' / f'{fid}.json').read_text())
        data = json.loads((ROOT / 'shared/fields' / f'{fid}.json').read_text())
        assert manifest['fieldId'] == fid
        assert len(manifest['frames']) >= 2, fid
        assert manifest['projection'] == 'EPSG:3857'
        bounds, size = manifest['bounds'], manifest['imageSize']
        span = bounds[2] - bounds[0]
        x, y, w, h = manifest['viewBox']
        assert w == h and x >= 0 and y >= 0 and x + w <= size and y + h <= size, fid
        assert len(field['rings']) == len(manifest['rings'])
        for source_ring, ring in zip(field['rings'], manifest['rings']):
            assert len(source_ring) == len(ring)
            for coord, point in zip(source_ring, ring):
                mx, my = mercator(*coord)
                px, py = (mx - bounds[0]) / span * size, (bounds[3] - my) / span * size
                assert abs(px - point[0]) < .0001 and abs(py - point[1]) < .0001, fid
                assert x <= px <= x + w and y <= py <= y + h, fid
        dates = [f['date'] for f in manifest['frames']]
        assert dates == sorted(set(dates)), fid
        periods = {f'{yr}-{m:02}' for yr in range(2022, 2025) for m in manifest['samplingMonths']}
        assert {d[:7] for d in dates} | set(manifest['missingPeriods']) == periods
        assert not ({d[:7] for d in dates} & set(manifest['missingPeriods']))
        mask = Image.new('L', (size, size), 0)
        draw = ImageDraw.Draw(mask)
        for ring in manifest['rings']:
            draw.polygon([tuple(p) for p in ring], fill=255)
        for frame in manifest['frames']:
            assert frame['src'] in scenes
            assert frame['date'] == scenes[frame['src']]['date']
            assert frame['clearFraction'] >= .98
            assert frame['sceneId'] == scenes[frame['src']]['sceneId']
            # Decode real asset and reject black/empty views over the selected outline.
            mean = sum(ImageStat.Stat(images[frame['src']], mask).mean) / 3
            if mean < 5:
                dark.append([fid, frame['date'], mean])
            year, month = int(frame['date'][:4]), int(frame['date'][5:7])
            crop = next((r for r in data['cropHistory'] if r['year'] == year), None)
            cover = next((r for r in data['coverYearlyL89'] if r['year'] == year), None)
            if not crop or not cover or not cover['months'][month - 1]:
                missing_labels.append([fid, frame['date'], bool(crop), bool(cover and cover['months'][month - 1])])
        counts.append(len(dates))
        if manifest['missingPeriods']:
            gaps.append({'fieldId': fid, 'missingPeriods': manifest['missingPeriods']})
    assert not dark, dark
    result = {'verifiedFields': len(expected), 'playable': sum(n >= 2 for n in counts),
              'frameCountRange': [min(counts), max(counts)], 'frameCounts': dict(Counter(counts)),
              'sharedScenes': len(scenes), 'referencedImageBytes': sum((PUBLIC / s).stat().st_size for s in scenes),
              'fieldsWithGaps': gaps, 'missingMonthlyOrAnnualLabels': missing_labels,
              'outlineChecks': 'All vertices match the mapped outlines in EPSG:3857',
              'darkOrEmptyFieldViews': dark}
    target = ROOT / 'docs/history-archive-audit.json'
    target.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    return result


if __name__ == '__main__':
    verify()
