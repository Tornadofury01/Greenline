# Field Shift v2: Earth Engine exports (North Texas, 6 accounts, 3–4 h)

**Scope:** North Texas only, 6 Blackland Prairie counties: Ellis, Hill (held out), Navarro, Kaufman, Johnson, McLennan. 300 USDA CSB fields per county, 1,800 in total.

Every job covers all fields for one year, since the counties are adjacent and one Landsat scene covers most of them.

| | Jobs | Estimated EE task time | Per account | Wall time per account at 3 tasks at once |
|---|---|---|---|---|
| Tier 1 (core) | 279 | 23.9 h | 4.0 h | ~1.3 h |
| Tier 2 (if time) | 140 | 10.8 h | 1.8 h | ~0.6 h |

The minutes are guesses, so check real times with `status.py` after about 20 minutes. Whatever tier 2 hasn't finished by the deadline is cut. Tier 1 is submitted first on every account and balanced across accounts first.

- **Tier 1:**
  - Optical: Landsat 5 (1985–2011), Landsat 7 (2012 only), Landsat 8/9, HLS Sentinel-2 with red-edge (2016+)
  - Daily weather and water: Daymet, gridMET, gridMET drought, IMERG, SMAP L3 and L4, MODIS ET
  - Static layers: terrain, CDL
  - Coarse grids at county points: GRACE, GLDAS, CMIP6 (8 models × 3 runs)
- **Tier 2:** Landsat 7 for the other years, HLS Landsat, Sentinel-1, PRISM, MODIS land surface temperature, MODIS NDVI, IrrMapper.
- **Tier 3 (off):** Sentinel-2 SR, OpenET.

## Steps (about 15 minutes before the exports run)

1. **Everyone:** `pip install earthengine-api`. Each Google account needs a Cloud project registered for Earth Engine (noncommercial).
2. **Account 1:**
   - Copy `accounts.example.json` to `accounts.json` and fill in all 6 project ids.
   - Set `config.FIELDS_ASSET` to `projects/<account 1 project>/assets/fieldshift_v2_fields`.
   - Run `python plan.py` and send the team `config.py`, `accounts.json` and `assignments.json`.
3. **Account 1:** run `python prepare_fields_ee.py --account 1`. It samples the fields inside Earth Engine from the CSB asset the v1 notebooks used, so there's no download. It then waits for the asset (about 10 min) and makes it readable by all accounts.
4. **All 6 accounts, right away (don't wait for step 3):**
   ```bash
   earthengine authenticate --force
   python run_exports.py --account N
   ```
   Until the field asset exists, this submits only the point jobs (CMIP6, GRACE, GLDAS). **Run the same command again once account 1 says the fields are ready.** Rerunning skips anything queued or done and resubmits failures.
5. **After about 20 min:** run `python status.py --account N` to see real minutes and errors. If one dataset fails on every account, fix it in `datasets.py`, send the file round, and rerun.

## One shared place for the files

`toDrive` writes to the **running account's own My Drive** (folder `fieldshift_v2`), so you get six folders. Either each account shares its folder with the lead, or set `DEST` to one Cloud Storage bucket that all 6 accounts can write to (*Storage Object Creator*).

## Output shapes

The cube builder harmonizes everything later; Earth Engine doesn't.
- **Per scene** (Landsat, HLS, S1): one row per field per image.
  - `<band>_p10/_p50/_p90/_count` over clear pixels inside the field, buffered 45 m inward.
  - `tot_count` = field pixels in the footprint, so clear share = `ndvi_count / tot_count`.
  - S1 is in **linear** power: convert to dB after averaging.
- **Per month** (daily grids): one row per field-month.
  - Columns are `dDD_<band>`; an empty cell means a missing day, never 0.
  - gridMET temperatures are in kelvin. IMERG days are UTC; `i30` is the peak 30-min rate, which drives erosion.
- **Per field:** `terrain` (one row per layer: 3dep / srtm / merit), `cdl` (histogram per year → majority and purity).
- **Per county centroid:** GRACE, GLDAS, CMIP6.
- **`fields_v2.geojson`:** the outlines + `fid`, `cfips`, `holdout`, and the CSB `CDL2016`…`CDL2023` crops.

## Not tested against Earth Engine yet

The scripts compile and the split is computed, but nothing has run in Earth Engine, because this machine has no EE login.
- **IDs and band names:** collection IDs and band names come from memory, so test the first jobs before trusting them. The uncertain ones are Daymet's last year, the `GRIDMET/DROUGHT` bands, the SMAP flag names, the GLDAS bands, the 3DEP image id, and the CSB asset's property names (`CDL.*`).
- **HLS reflectance scale:** indices don't depend on it; raw bands might need ÷10000.
- **IMERG memory:** if a month of half-hour images is too heavy, raise `tileScale` in `_monthly`.
- **Field sample:** it's random within each county, not stratified by crop.
