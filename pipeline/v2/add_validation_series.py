"""Adds the two report-card measurement series to EXISTING input files, without rebuilding them (build_inputs.py now
writes them too):  ndviScenesL89 (clear Landsat 8/9 scenes, 2014+) and smapRootzoneMonthly (SMAP L4, 2015-2025).
    python pipeline/v2/add_validation_series.py [--inputs shared/v2/inputs] [--data v2/data]
"""
import argparse, json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline" / "v2"))
from build_inputs import landsat89_scenes, smap_rootzone_monthly, log  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--inputs", default=str(ROOT / "shared" / "v2" / "inputs"))
ap.add_argument("--data", default=str(ROOT / "v2" / "data"))
a = ap.parse_args()
inp, ee = Path(a.inputs), Path(a.data) / "ee"
files = sorted(inp.glob("*.json"))
fids = {f.stem for f in files}
log(f"{len(fids)} input files"); scenes = landsat89_scenes(ee, fids); log("scenes done"); smap = smap_rootzone_monthly(ee, fids); log("SMAP done")
for f in files:
    d = json.loads(f.read_text(encoding="utf-8"))
    d["ndviScenesL89"] = scenes.get(f.stem, [])
    d["smapRootzoneMonthly"] = smap.get(f.stem, [])
    f.write_text(json.dumps(d, separators=(",", ":"), ensure_ascii=False, allow_nan=False), encoding="utf-8")
log(f"updated {len(files)} input files")
