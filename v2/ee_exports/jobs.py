"""Every export job, with an estimated run time and a tier. Pure Python (no Earth Engine), so plan.py runs anywhere.

A job is one Earth Engine table export over ALL study fields (North Texas counties are adjacent, so one Landsat scene
covers most of them and per-county jobs would only repeat work):
  year    one calendar year, all fields
  once    all fields (static layers) or all county points, all years
  cmip6   one climate model x one run, county points

Tiers: 1 = core, submitted first on every account. 2 = submitted after tier 1, runs if time allows. 3 = optional
(INCLUDE_OPTIONAL). `minutes` = rough guess of EE run time per job at 1,800 fields. After the first jobs finish,
`python status.py` prints the real times.
"""
from dataclasses import dataclass, asdict
from typing import Optional

import config


def yrs(a, b, *more):
    out = list(range(a, b + 1))
    for lo, hi in zip(more[::2], more[1::2]):
        out += range(lo, hi + 1)
    return out


DATASETS = {
    # ---- tier 1: core ----
    # optical / thermal, one row per field per scene
    "ls5":       dict(unit="year", years=yrs(1985, 2011), minutes=8, tier=1),
    "ls7":       dict(unit="year", years=[2012], minutes=8, tier=1),          # the only Landsat in 2012
    "ls8":       dict(unit="year", years=yrs(2013, 2025), minutes=8, tier=1),
    "ls9":       dict(unit="year", years=yrs(2021, 2025), minutes=6, tier=1),
    "hlss30":    dict(unit="year", years=yrs(2016, 2025), minutes=20, tier=1),  # Sentinel-2 density + red-edge
    # daily grids, one row per field per month (columns dDD_<band>)
    "daymet":    dict(unit="year", years=yrs(1985, 2025), minutes=3, tier=1),
    "gridmet":   dict(unit="year", years=yrs(1985, 2025), minutes=3, tier=1),
    "gmdrought": dict(unit="year", years=yrs(1985, 2025), minutes=1, tier=1),
    "imerg":     dict(unit="year", years=yrs(2001, 2025), minutes=12, tier=1),
    "smapl3":    dict(unit="year", years=yrs(2015, 2025), minutes=1, tier=1),
    "smapl4":    dict(unit="year", years=yrs(2015, 2025), minutes=3, tier=1),
    "mod16":     dict(unit="year", years=yrs(2001, 2025), minutes=1, tier=1),
    # static / yearly layers, one job
    "terrain":   dict(unit="once", minutes=10, tier=1),
    "cdl":       dict(unit="once", minutes=12, tier=1),
    # very coarse, county points
    "grace":     dict(unit="once", minutes=2, tier=1, points=True),
    "gldas":     dict(unit="once", minutes=6, tier=1, points=True),
    "cmip6":     dict(unit="cmip6", minutes=8, tier=1, points=True),
    # ---- tier 2: if time allows ----
    "ls7more":   dict(unit="year", years=yrs(1999, 2011, 2013, 2023), minutes=8, tier=2),  # denser history
    "hlsl30":    dict(unit="year", years=yrs(2013, 2025), minutes=10, tier=2),  # same scenes as ls8/9, harmonized
    "s1":        dict(unit="year", years=yrs(2017, 2025), minutes=15, tier=2),
    "prism":     dict(unit="year", years=yrs(1985, 2025), minutes=2, tier=2),   # cross-check of Daymet
    "modlst":    dict(unit="year", years=yrs(2000, 2025), minutes=3, tier=2),   # Model B / D
    "mod13q1":   dict(unit="year", years=yrs(2000, 2025), minutes=1, tier=2),
    "irrmapper": dict(unit="once", minutes=4, tier=2),
    # ---- tier 3: optional ----
    "s2sr":      dict(unit="year", years=yrs(2017, 2025), minutes=20, tier=3),
    "openet":    dict(unit="once", minutes=8, tier=3),
}


@dataclass(frozen=True)
class Job:
    ds: str
    year: Optional[int] = None
    model: Optional[str] = None
    run: Optional[str] = None

    @property
    def name(self):  # EE task description and file name: letters, digits, - and _ only
        return "_".join(str(p) for p in (self.ds, self.year, self.model, self.run) if p is not None)

    @property
    def spec(self):
        return DATASETS[self.ds]

    @property
    def tier(self):
        return self.spec["tier"]

    @property
    def needs_fields(self):
        return not self.spec.get("points")

    @property
    def minutes(self):
        return self.spec["minutes"] * (config.N_FIELDS / 1800 if self.needs_fields else 1)

    def to_dict(self):
        return {k: v for k, v in asdict(self).items() if v is not None} | {
            "name": self.name, "tier": self.tier, "minutes": round(self.minutes, 2)}

    @staticmethod
    def from_dict(d):
        return Job(**{k: d[k] for k in ("ds", "year", "model", "run") if k in d})


def all_jobs(include_optional=None):
    opt = config.INCLUDE_OPTIONAL if include_optional is None else include_optional
    for ds, d in DATASETS.items():
        if d["tier"] == 3 and not opt:
            continue
        if d["unit"] == "year":
            for y in d["years"]:
                yield Job(ds, year=y)
        elif d["unit"] == "cmip6":
            for m in config.CMIP6_MODELS:
                for r in config.CMIP6_RUNS:
                    yield Job(ds, model=m, run=r)
        else:
            yield Job(ds)
