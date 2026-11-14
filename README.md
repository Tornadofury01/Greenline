# Greenline 🌱

Compare crop rotations for North Texas fields using NASA Earth observation data.
Built for NASA Space Apps, "Field Shift: Adapting Farms with NASA Data".

> Greenline supports farmer judgment and local experts. It doesn't replace them.
> **Current version uses fake sample data.**

## Run it

Needs Node 18+ (tested on Node 24).

```bash
cd app
npm install
npm run dev
```

Open http://localhost:5173. On a phone on the same Wi-Fi, run `npm run dev -- --host` and open the Network URL it prints.

Other commands (from `/app`):

| Command | What it does |
|---|---|
| `npm run build` | Production build into `app/dist`, including the service worker |
| `npm run preview` | Serve the build (test install and offline here) |
| `npm run selftest` | Sanity checks for the scoring rules |

## How it works

1. **Field**: tap the map to load a field. Today this always loads the sample near Denton.
2. **Farm**: current rotation, priorities, water, equipment, budget and market.
3. **Story**: 20 years of rain, drought and heat, plus months the ground was bare.
4. **Compare**: your rotation and the top 2 suggestions, each with a score, tags, confidence, and why. You can also build your own rotation.
5. **Expert**: a printable summary for your county extension agent.

English / Español toggle in the header.

## Project layout

```
app/       React PWA (Vite)
scoring/   Rule-based rotation scoring (plain JS)
content/   Crop library, candidate rotations, en/es text
shared/    Sample field data + data-format.md
pipeline/  Future NASA data processing (README only)
```

See [CLAUDE.md](CLAUDE.md) for contributor rules and the roadmap.
