# Field Shift v2: the daily engine (`/scoring/engine/`)

Pure JavaScript (no React, no DOM, no fs outside `node.js`), so the browser and Node run the same code. Checks: `node scoring/engine/selftest-engine.js`.
Crop numbers: `content/crop-library.json` (built by `scoring/tools/build_crop_library.mjs`, format in `docs/v2-data-contract.md` section 3).

```js
import { createSimulation, runSimulation, planFromSlots } from '@scoring/engine/index.js';
const sim = createSimulation({ field, slots, library, plan, years, startYear, economics, weatherYears, seed });
sim.step();      // one day -> { date, rain, tmax, rootZoneWaterMm, canopyCover, erosionTonsPerAcre, ... }
sim.run();       // to the end -> summary (episodes, yearly, totals, perYear, soil, balances, ledger, events)
sim.state;       // soil water, carbon, nitrogen, crop, pests, ledger as plain objects
```
`slots` = the result of `makeSlots()` in `scoring/modelSlots.js`. `plan` = the contract's Option (`sequence[]` + `management`); `planFromSlots()` builds the current rotation from slot A.
`weatherYears: [2011]` replays another year's weather ("2011 again"); `yearsOfType(slots.C, 'drought')` lists scenario years from slot C. `record` is not needed: `run({ onDay })` or `step()` give daily rows.

## What happens each day (one `step`)
0. Events due today: planting (pre-plant tillage, seed and planting cost, N fertilizer), harvest or termination, alfalfa cuttings.
1. Weather in. 2. Irrigation decision, then water balance: SCS curve-number runoff, infiltration, soil evaporation (top ~10 cm), crop transpiration with FAO-56 stress Ks, tipping-bucket drainage through 3 layers to 1 m.
3. Crop: heat sum -> stages; biomass = WP* x water productivity scale x transpiration / ET0 (AquaCrop), times a cold factor and a nitrogen-supply factor; canopy follows the stages and drops with water stress; heat at flowering, frost kill, freeze at flowering; harvest index bent by FAO-33 Ky.
4. Nitrogen leaching with drainage. 5. Ground cover (canopy + residue) and daily RUSLE erosion (R x K x LS x C x P, gated by runoff).
6. Two-pool soil carbon (residue pool, humus pool; tillage, warmth, moisture) and mineral N (mineralization, immobilization by straw). 7. Pest risk counters and carry-over pressure. 8. Money booked on its date (seed, planting, chemicals at full canopy, fertilizer, tillage, irrigation, harvest cost, revenue).

## Where each input comes from
| Input | Source |
|---|---|
| Rain, min/max temperature | `field.climateMonthly` (2008-2025), turned into days by a seeded generator that keeps every month total exact; before 2008 the field's own monthly average with rain scaled to the real yearly total. **The days are invented inside real month totals, not observed storms.** `makeWeatherFromDaily(rows)` takes real daily rows (POWER, Daymet) with the same interface. |
| Reference ET | Hargreaves-Samani from daily min/max and latitude (`field.field.lat`) |
| Soil, slope | `field.soil` (AWC, hydrologic group, K, T, clay, organic matter), `field.terrain.slopePct` |
| Prices | `field.market.recent` (NASS 2021-2025) when the crop is there, else the library default; N price from `content/economics.json` |
| Crop calendars (current rotation) | slot A `cropDates` via `planFromSlots` |
| Drought Ky, heat threshold and loss per day | slot B |
| Starting soil moisture | slot D (`rootZoneFraction`) |
| Water-productivity scale, heat-threshold offset, typical yield | calibration E |
| Year types for scenarios | slot C (`yearsOfType`) |

Nothing from `shared/si`, `pipeline/fieldshift` or the field file's `si` / `yearType` is read (the selftest greps for it).

## Not modelled (say so in the pitch)
- Swelling-clay cracks (Houston Black swallows first rains when dry), run-on, water tables, interception.
- Denitrification, volatilization, P and K balances (removal is booked at harvest only).
- Real storm intensity (daily rain only; erosivity from a power law, calibrated to R about 280).
- Disease and insect risk are weather proxies (`pests.js`), not scouting data.
- CO2 effect, salinity, hail, lodging, weeds.

## State of calibration (important)
Nothing is fitted to yields yet: calibration E is a placeholder. On `ec-251`, 18 weather years, the mean simulated yield against the placeholder typical yield is corn 0.95x, sorghum 0.89x, cotton 0.89x, sunflower 1.14x, sesame 1.17x, winter wheat 1.33x, soybeans 0.63x. Treat the engine's yields as "plausible and moving the right way", not as forecasts, until calibration E is plugged in.
Default tillage is conventional, which gives roughly 175-300 bare days a year in the simulation (by crop). That is far above the satellite's 42 (which undercounts), so the bare-days validation check will flag it until slot A supplies the field's real management.
