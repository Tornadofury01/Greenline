# Notes for Claude Code

Project: Field Shift (NASA Space Apps). Crop-rotation decision support for farmers; demo site Ellis County, TX.
Read README.md first for the pipeline and data.

## Ground rules
- Run order: `src/run_replay.py` → `src/run_planning.py` → `src/make_outputs.py` (or `bash run_all.sh`). Each later
  step reads the previous step's files in `outputs/`. After changing `fs_replay.py`, rerun all three.
- `data/raw/` is source data. Don't edit it; regenerate it with `notebooks/field_shift_replay_export.ipynb` (Colab).
- `fs_replay.py` and `fs_planning.py` are libraries; `run_*.py` and `make_outputs.py` are scripts with paths
  relative to the repo root.
- The replay is a simulation built on published agronomy (FAO-56, FAO-33, TR-55, RUSLE), not a trained model.
  Don't describe it as ML. The trained models (crop classifier, stress model, year-pattern clustering) live elsewhere
  and plug in through `fr.year_types(..., model3_labels=...)` and the `current` rotation in `fr.ROTATIONS`.
- The recommendation must stay transparent: every score traces to a metric and a fixed anchor in
  `fs_planning.ANCHORS`. Cost-share is reported, never scored.

## Where to change things
- Add/edit a rotation: `ROTATIONS` in `fs_replay.py` (`check_rotations()` validates schedules).
- Add a crop: `CROPS` in `fs_replay.py`, plus `ECON` and `N_NEED` in `fs_planning.py` if it's a cash crop,
  `COVER_COST` if it's a cover.
- Farmer priorities: `PRIORITY_PRESETS` or pass `custom_weights` to `fp.recommend()`.
- Prices / costs / EQIP / N price: constants at the top of `fs_planning.py` (each has a source note).

## Sanity checks that should keep passing
- `python -c "import sys; sys.path.insert(0,'src'); import fs_replay as fr; fr.check_rotations()"`
- Hardest replayed wheat years should include known Texas droughts (2006, 2011, 2022).
- `ravc = revenue - var_cost - cover_cost + n_savings` for any row of the econ table.
- wheat+cowpea N credit ≈ half the cowpea's fixed N.

## Known open items
- Calibrate against NASS Ellis County yields by year (validation plan).
- Replace R-factor placeholder; get local cover-seed quotes; confirm EQIP rates with NRCS.
- `fields_terrain_twi.csv` (wetness index) is unused; could drive frost-pocket / waterlogging flags.
