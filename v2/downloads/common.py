"""Shared settings for the non-Earth-Engine downloads: the same 6 North Texas counties as v2/ee_exports/config.py."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DATA = HERE.parent / "data"
DATA.mkdir(exist_ok=True)
sys.path.insert(0, str(HERE.parent / "ee_exports"))
import config  # noqa: E402

COUNTIES = config.COUNTIES                  # "48139" -> label
COUNTY3 = {f[2:]: f for f in COUNTIES}      # "139" -> "48139"
YEAR0, YEAR1 = 1985, 2025
