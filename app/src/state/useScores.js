// Turns the farmer's answers into scored rotations using /scoring.
import { useMemo } from 'react';
import { scoreRotation, suggestRotations } from '@scoring/index.js';
import { crops, candidateRotations } from '../data/loadField.js';
import { useApp } from './AppContext.jsx';
import economics from '@content/economics.json';
import { defaultBadYear } from '../display.js';

export function farmToConstraints(farm) {
  return {
    water: farm.waterMode,
    equipment: farm.equipment.filter((e) => e !== 'none'),
    budget: farm.budget,
    market: farm.market,
    waterSource: farm.waterSource,
  };
}

export function useScores() {
  const { field, farm, replayYear, whatIf } = useApp();
  // One scenario at a time (AppContext keeps them exclusive). Dollars are display only.
  const options = { replayYear, whatIf, economics };
  return useMemo(() => {
    if (!field) return null;
    const constraints = farmToConstraints(farm);
    const current = farm.currentRotation.length
      ? scoreRotation({ id: 'current', crops: farm.currentRotation }, field, farm.priorities, constraints, crops, options)
      : null;
    const suggested = suggestRotations(
      candidateRotations, { crops: farm.currentRotation }, field, farm.priorities, constraints, crops, 2, options,
    );
    const scoreCustom = (cropIds) =>
      scoreRotation({ id: 'custom', crops: cropIds }, field, farm.priorities, constraints, crops, options);
    // Scoreboard column "2011 drought": the same scoreRotation() with the bad-year replay switched on.
    // Display only; it never feeds back into the normal scores or the order of options.
    const badYear = defaultBadYear(field);
    const cache = new Map();
    const badYearScore = (cropIds) => {
      if (!badYear) return null;
      const key = cropIds.join('>');
      if (!cache.has(key)) {
        cache.set(key, scoreRotation({ id: 'bad-year', crops: cropIds }, field, farm.priorities, constraints, crops, { replayYear: badYear.year, economics }));
      }
      return cache.get(key);
    };
    return { current, suggested, scoreCustom, badYear, badYearScore };
  }, [field, farm, replayYear, whatIf]);
}
