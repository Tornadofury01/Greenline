# How Greenline lines up its data: one field, one calendar

Greenline combines 10 datasets (NASA, USDA and PRISM) that were never designed to work together. They differ in pixel size (30 m to
50 km), in timing (every 30 minutes to once a year), and in record length (2015 to 1984). We don't stretch them
all onto one big map. We **ask every dataset the same question: "what happened at this field, in this month?"**

## Step 1. Same place: the field

Each field is one point we chose from the Cropland Data Layer: a 30 m cropland pixel, never a farmer's GPS.
How a dataset answers depends on how big its pixels are:

| Level | Datasets | Pixel size | How we read it |
|---|---|---|---|
| **Patch: measured on the field** | Landsat (greenness, bare soil), Cropland Data Layer (crop), SRTM (slope) | 30 m | Average over a 45 m circle (about 3 × 3 pixels) on the field |
| | SSURGO soils | Soil map unit (1:24,000) | The soil mapped under the field |
| **Area: the field's neighborhood** | PRISM rain and temperature | 4 km | The grid cell the field sits in. One value for the whole field |
| | GPM IMERG rain, SMAP soil moisture | ~9–11 km | Same |
| | NASA POWER weather | ~50 km | Same. Many fields share one cell |
| **County / state** | NASS yields, prices, crop progress | County, Texas | The field's county (or Texas when the county isn't published) |

Rule: **patch data tells us about this field. Area data tells us about the weather this field got.** We never
pretend a 50 km weather value is field-specific. Every value in the app carries its scale (`sources[].scale`).

## Step 2. Same time: the month

Everything is summarized to **calendar months**, then to years:
- Landsat images (every 8–16 days, often cloudy): median of the clear images in the month. Gaps of up to 2 months are filled in between.
- Daily weather (POWER, PRISM, half-hourly IMERG): monthly totals and averages, plus counts like heat days ≥ 35 °C and storm days ≥ 25 mm.
- SMAP (3-hourly): monthly average.
- Yearly data (CDL crop, NASS yields and prices) attach to every month of that year.

In effect, the result is one table per field: **year × month × every variable**. The models and the app's scores read from it.

## Step 3. Same years, honestly labeled

Records start at different times. Landsat, POWER and PRISM start in 1984, CDL and IMERG in 2008, SMAP in 2015.
We don't invent data to fill the early years. A value is `null` before its record starts, and each source lists its
own `startYear` and `endYear`. The crop model uses 2008–2025, when crop labels exist. The weather-stress model uses
2015–2025, when soil moisture exists.

## Step 4. Check the datasets against each other

Where datasets measure the same thing, we compare them. Rain from NASA POWER and IMERG vs gauge-based PRISM:
annual correlation 0.92–0.93, within −9% / +4% (see `data-validation.md`). Each field's file stores its own
agreement score, which feeds the app's confidence rating.

## Known limits
- Area data can't see differences between neighboring fields: one thunderstorm, one 50 km POWER cell.
- Landsat 5/7 and Landsat 8/9 NDVI aren't cross-calibrated yet (on the roadmap).
- Monthly steps mean dates are good to about ±15 days.

---

**Slide version (3 bullets)**
- **One field, one calendar:** 10 NASA, USDA and PRISM datasets, from 30 m satellite pixels to county statistics, all answer "what happened on this field, this month?"
- **Local vs regional, labeled:** greenness, crops, slope and soil are measured on the field itself; rain, heat and soil moisture describe the field's neighborhood, and the app says which is which.
- **Cross-checked:** NASA rainfall agrees with ground-gauge PRISM (r = 0.92–0.93), and every gap is shown as a gap, never filled in.
