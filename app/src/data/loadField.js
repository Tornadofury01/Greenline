// The ONE place the app gets field data. Today it returns the bundled sample.
// Later: fetch the pipeline's output for the tapped 30 m cell, e.g.
//   const res = await fetch(`/data/fields/${gridCellFor(lat, lon)}.json`);
// Whatever comes back must follow /shared/data-format.md.
import sampleField from '@shared/sample-field.json';
import cropLibrary from '@content/crops.json';
import rotationLibrary from '@content/rotations.json';

// eslint-disable-next-line no-unused-vars
export async function loadFieldAt(lat, lon) {
  return sampleField;
}

export const crops = cropLibrary;
export const candidateRotations = rotationLibrary.rotations;

// Bare months are derived, not stored: NDVI below this means little plant cover.
export const BARE_NDVI = 0.25;

// Default "current rotation" guess: distinct crops from the last 4 years, oldest first.
export function guessCurrentRotation(field) {
  const recent = field.cropHistory.slice(-4).map((h) => h.crop);
  return [...new Set(recent)];
}
