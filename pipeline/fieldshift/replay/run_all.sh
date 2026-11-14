#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
python src/run_replay.py
python src/run_planning.py
python src/make_outputs.py
