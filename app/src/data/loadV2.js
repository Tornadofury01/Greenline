// The ONE place the app reads v2 data (docs/v2-data-contract.md section 2).
//
//   /v2f/<id>.json.gz          the engine's precomputed output for that field, gzipped (scripts/pack-v2-fields.mjs
//                              packs shared/v2/fields/<id>.json before dev and build)  -> used when the id is listed
//   /v2f/index.json            the ids that have a file
//   shared/v2-sample/sample-field.json   invented numbers for testing -> DEVELOPMENT ONLY, and the screens show
//                                        "Sample data for testing"
//
// A field with no file is { error: 'missing' } in production ("No data here yet"), never the sample.
// A real file that breaks the contract is an error ({ error: 'invalid', problems }), never silently replaced by the
// sample: a farmer must not see invented numbers where their field's numbers should be.
import scoresConfig from '@content/v2-scores.json';
import { validateFieldOutput } from '@scoring/v2Contract.js';

const BASE = `${import.meta.env.BASE_URL}v2f/`;
const cache = new Map(); // field id -> Promise<result>
let indexPromise = null;

/** Set of ids with a file, or null when the list could not be fetched (offline and not cached). */
function available() {
  indexPromise ||= fetch(`${BASE}index.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`index ${r.status}`))))
    .then((j) => new Set(j.ids ?? []))
    .catch(() => { indexPromise = null; return null; });
  return indexPromise;
}

/** Fetch and unpack one field. Works whether or not the server already undid the gzip. */
async function fetchField(id) {
  const r = await fetch(`${BASE}${encodeURIComponent(id)}.json.gz`);
  if (!r.ok) throw new Error(`field ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function read(fieldId) {
  try {
    const ids = await available();
    if (ids === null) return { error: 'network' };
    let data;
    if (ids.has(fieldId)) data = await fetchField(fieldId);
    else if (import.meta.env.DEV) data = (await import('@shared/v2-sample/sample-field.json')).default;
    else return { error: 'missing' };
    const problems = validateFieldOutput(data, scoresConfig);
    if (problems.length) return { error: 'invalid', problems };
    // The sample banner shows only when the sample is what we are showing.
    return { data, usingSample: !ids.has(fieldId) || data.isSampleData === true };
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
