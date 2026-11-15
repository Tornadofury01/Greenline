# Model C v2: season types per county and crop season, and 2040

486 county-seasons: 6 counties x 1985-2025 x 2 crop seasons (summer crops Apr-Sep, winter grain Oct-May). Types come from fixed cutoffs on each county's own 1985-2014 seasons, checked in order: **drought** (water deficit in the driest 15%), **wet** (rain in the wettest 15%), **hot** (heat days in the hottest 20%; winter = days >= 32 C in Mar-May), **normal**.

## How often each type happened (1985-2025)

| Season | drought | wet | hot | normal |
|---|---|---|---|---|
| summer | 14% | 26% | 8% | 51% |
| winter | 16% | 24% | 7% | 53% |

Area-wide summer type (most common across the 6 counties): **drought** 1998, 2006, 2011, 2012, 2013, 2022; **wet** 1986, 1989, 1995, 2004, 2007, 2009, 2015, 2016, 2019, 2021, 2024, 2025; **hot** 2005, 2018, 2023

## Checks against records the types never saw

Mean per type: US Drought Monitor D2+ area (%), RMA drought/heat loss ratio (indemnity per $100 liability), NASS yield deviation from trend (%), Model B greenness z.

**Summer**

| Type | Drought Monitor D2+ | RMA dry loss ratio | Yield vs trend | Greenness z |
|---|---|---|---|---|
| drought | 55.2 | 6.36 | -17.5% | -0.37 |
| wet | 2.2 | 0.29 | +3.6% | +0.35 |
| hot | 32.9 | 4.17 | -11.4% | +0.03 |
| normal | 6.8 | 2.01 | +5.1% | +0.09 |

**Winter**

| Type | Drought Monitor D2+ | RMA dry loss ratio | Yield vs trend | Greenness z |
|---|---|---|---|---|
| drought | 38.2 | 23.36 | -12.3% | -0.17 |
| wet | 17.1 | 0.34 | -6.7% | +0.21 |
| hot | 33.8 | 0.46 | +14.3% | +0.19 |
| normal | 8.9 | 4.87 | +3.3% | +0.14 |

Drought minus normal (bootstrap 90% range):

- summer:usdm_d2plus_pct: +48.36 (+37.82 to +58.87)
- summer:rma_dry_loss_ratio: +4.34 (+0.77 to +7.90)
- summer:yield_dev_pct: -22.59 (-30.64 to -13.89)
- summer:greenness_z: -0.45 (-0.56 to -0.34)
- winter:usdm_d2plus_pct: +29.31 (+20.81 to +37.99)
- winter:rma_dry_loss_ratio: +18.49 (+3.17 to +35.94)
- winter:yield_dev_pct: -15.63 (-22.50 to -8.11)
- winter:greenness_z: -0.31 (-0.41 to -0.21)

Does the deficit pick out the worst 15% of seasons in each record? (AUC; share of those seasons typed drought)

- summer:usdm_d2plus_pct: AUC 0.974, 83% typed drought (n 156)
- summer:rma_dry_loss_ratio: AUC 0.762, 34% typed drought (n 208)
- summer:yield_dev_pct: AUC 0.737, 47% typed drought (n 223)
- summer:greenness_z: AUC 0.857, 57% typed drought (n 234)
- winter:usdm_d2plus_pct: AUC 0.783, 54% typed drought (n 156)
- winter:rma_dry_loss_ratio: AUC 0.722, 39% typed drought (n 207)
- winter:yield_dev_pct: AUC 0.578, 38% typed drought (n 222)
- winter:greenness_z: AUC 0.608, 43% typed drought (n 234)

Cross-check: k-means on the same features agrees with the cutoff types at ARI 0.595 (summer) / 0.424 (winter). The cutoffs are the model; k-means is only a sanity check (the seasons don't form tight natural clusters, silhouette ~0.28 in v1).

Reading the winter types: a winter-grain **hot** season is a warm spring, and it came with *better* wheat (see the table), so for wheat it is not a stress type. Winter **wet** came with lower wheat yields (waterlogging, disease, late planting).

## 2040 (2030-2050), quantile delta mapping, 8 NEX-GDDP-CMIP6 models

Each quantile of daily max/min temperature, rain and Penman-Monteith reference ET shifts by its own model change (per county and calendar month), then the same cutoffs classify the shifted seasons.

| Scenario | Season | drought | wet | hot | normal | models with more drought / more hot than today |
|---|---|---|---|---|---|---|
| ssp245 | summer | 26% (16%-36%) | 28% (13%-37%) | 38% (29%-45%) | 9% (0%-20%) | 8/8 · 8/8 |
| ssp245 | winter | 24% (17%-34%) | 27% (13%-39%) | 28% (18%-44%) | 20% (9%-39%) | 8/8 · 8/8 |
| ssp585 | summer | 29% (22%-39%) | 25% (9%-35%) | 43% (37%-50%) | 3% (0%-7%) | 8/8 · 8/8 |
| ssp585 | winter | 28% (22%-33%) | 23% (14%-37%) | 35% (25%-45%) | 14% (6%-27%) | 8/8 · 8/8 |

Mean (min-max across models). Per-model climate change (rain %, mean max temp, reference ET %, 99th percentile max temp) is in `metrics.json` under `2040.<scenario>.climateChange`.

**Files:** `year_types.csv` (every county-season: features, percentile ranks, type, checks), `model3.joblib` (cutoffs per county and season), `metrics.json`.
