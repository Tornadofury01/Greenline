"""Settings for the Field Shift v2 Earth Engine exports. Edit here, then run plan.py.

Scope (decided 2026-11-14): NORTH TEXAS ONLY, and every export must finish within ~3-4 hours of starting.
So: 6 neighbouring Blackland Prairie counties, 300 fields each, region-wide jobs (one job = all fields, one year),
and two tiers: tier 1 is submitted first on every account; tier 2 runs after it if time allows.

Every account must use the same config.py and the same assignments.json, so each job runs exactly once.
"""

# North Texas study counties (5-digit FIPS), all Blackland Prairie, all adjacent or one county apart.
COUNTIES = {
    "48139": "Ellis (home, v1 study area)",
    "48217": "Hill (held-out county for the transfer test)",
    "48349": "Navarro",
    "48257": "Kaufman",
    "48251": "Johnson",
    "48309": "McLennan (southern edge; kept for the USDA-ARS Riesel erosion watersheds)",
}
HOLDOUT_COUNTIES = ["48217"]      # models never train on these (held-out region test)

FIELDS_PER_COUNTY = 300
N_FIELDS = FIELDS_PER_COUNTY * len(COUNTIES)

# USDA Crop Sequence Boundaries 2016-2023 in the awesome-gee community catalog (same asset the v1 notebooks used)
CSB_ASSET = "projects/sat-io/open-datasets/USDA/CSB_1623"
# prepare_fields_ee.py writes the buffered sample here (in account 1's Cloud project) and makes it world-readable
FIELDS_ASSET = "projects/CHANGE-ME/assets/fieldshift_v2_fields"

N_ACCOUNTS = 6

# Where results go. Drive: each account writes to a folder with this name in ITS OWN My Drive.
# GCS: one bucket that all 6 accounts can write to (Storage Object Creator) = one shared place.
DEST = {"type": "drive", "folder": "fieldshift_v2"}
# DEST = {"type": "gcs", "bucket": "CHANGE-ME", "prefix": "fieldshift_v2"}

INCLUDE_OPTIONAL = False          # tier 3: Sentinel-2 SR and OpenET (not submitted by default)

# NEX-GDDP-CMIP6: 8 models x (historical baseline + 2 scenarios around 2040)
CMIP6_MODELS = ["ACCESS-CM2", "CanESM5", "EC-Earth3", "GFDL-ESM4",
                "INM-CM5-0", "MIROC6", "MPI-ESM1-2-HR", "MRI-ESM2-0"]
CMIP6_RUNS = {"historical": (1985, 2014), "ssp245": (2030, 2050), "ssp585": (2030, 2050)}
