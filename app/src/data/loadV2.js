// The ONE place the app reads v2 data (docs/v2-data-contract.md section 2).
//
//   shared/v2/fields/<id>.json     the engine's precomputed output for that field   -> used when it exists
//   shared/v2-sample/sample-field.json   invented numbers for testing               -> used otherwise, and the
//                                                                                      screens show "Sample data for testing"
//
// A real file that breaks the contract is an error ({ error: 'invalid', problems }), never silently replaced by the
// sample: a farmer must not see invented numbers where their field's numbers should be.
import scoresConfig from '@content/v2-scores.json';
import { validateFieldOutput } from '@scoring/v2Contract.js';

// Lazy: each field's file becomes its own small chunk. Empty until the engine's precompute has been merged.
const FIELD_FILES = import.meta.glob('../../../shared/v2/fields/*.json');
const pathFor = (id) => `../../../shared/v2/fields/${id}.json`;

const cache = new Map(); // field id -> Promise<result>

async function read(fieldId) {
  try {
    const load = FIELD_FILES[pathFor(fieldId)];
    const data = load ? (await load()).default : (await import('@shared/v2-sample/sample-field.json')).default;
    const problems = validateFieldOutput(data, scoresConfig);
    if (problems.length) return { error: 'invalid', problems };
    // The sample banner shows only when the sample is what we are showing.
    return { data, usingSample: !load || data.isSampleData === true };
  } catch {
    return { error: 'network' };
  }
}

export function loadV2(fieldId) {
  if (!fieldId) return Promise.resolve({ error: 'missing' });
  if (!cache.has(fieldId)) {
    const p = read(fieldId).then((r) => { if (r.error) cache.delete(fieldId); return r; }); // retry after an error
    cache.set(fieldId, p);
  }
  return cache.get(fieldId);
}
