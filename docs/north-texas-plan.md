# Greenline: North Texas + real models plan (Nov 15, 2026)

Goal for tonight's submission: Pranav's models replace the placeholders, the app covers 1,711 fields in six Blackland Prairie counties (Ellis, Hill, Johnson, Kaufman, McLennan, Navarro), and Plans and Compare become one page. Deadline 11:59 p.m. Central.

## Decisions (made; Claude should use them)
- **Field ids:** the USDA CSB `fid` as-is (e.g. `48139-0021`) everywhere: files, map outlines, demo setting. Old `ec-*` ids are retired.
- **Ellis:** rebuilt from `fields_v2.geojson` like the other counties (check whether the fields match the old ec-* ones, only to pick a demo field).
- **Weather:** gridMET for `climateMonthly`/`climateYearly` in all counties; PRISM and IMERG as cross-checks.
- **Regional context** (crop shares, neighbours): per county.
- **Hill County** stays the holdout: its slot files must come from models fitted without Hill, and the report card shows Hill separately.
- **Partial coverage is OK:** a field with no output file shows "No data here yet". If time runs short, ship the counties that finished (Ellis first).

## Two risks to manage
1. **Raw data location.** `v2/data` (Earth Engine exports, SSURGO, NASS…) may only be on Pranav's laptop. The input adapter must run where the data is. Step B0 checks this first.
2. **Deploy size.** ~130 KB × 1,711 ≈ 220 MB of field files. Vercel Hobby CLI deploys are capped at **100 MB** of source files and **5,000 file uploads a day**. The deployed field data must be trimmed and gzip-compressed (app decompresses it), and you should deploy at most twice today.

## Sessions
| Terminal | Folder | Branch | Job |
|---|---|---|---|
| A | `Greenline` | `nikkibranch` | Merge Plans + Compare, then app updates for six counties, final deploy |
| B | `Greenline-data` | `nt-data` (new, from `main`) | Models + input files + precompute + packaging |
| PowerShell window (no Claude) | `Greenline-data` | `nt-data` | Runs the long precompute per county, so it costs no tokens |

## Order and checkpoints (Central time)
| Time | Terminal B | Terminal A |
|---|---|---|
| now | B0 inventory (stop if raw data isn't here) | A1 merge Plans + Compare |
| ~12:30 | B1 input files (Ellis first, then all six) | A1 continues |
| ~2:00 | B2 plug in models, test 10 fields | A1 done, review locally |
| ~2:45 | B3 precompute script; you run counties in PowerShell (~3 h total) | (wait, or polish UI) |
| ~5:30 | **Gate:** whatever counties are done ship | |
| ~5:45 | B4 validation, size/gzip, map files, merge to main | |
| ~6:15 | | A2 app for six counties + deploy test |
| ~7:30 | | Wrap-up: merge, deploy, tag, phone test, submit |
