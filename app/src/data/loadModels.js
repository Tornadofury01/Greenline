// The ONE place the browser app reads model files: shared/v2/models/<fieldId>.json (docs/v2-model-plugin.md), the same
// file the Node precompute reads through scoring/modelSlots.node.js. The result goes straight into makeSlots()
// (scoring/modelSlots.js), which checks it and falls back to the placeholder slot by slot. No file = null = all placeholders.
// Lazy: each model file becomes its own small chunk, fetched only for the field that is open. Works for any field id.
const MODEL_FILES = import.meta.glob('../../../shared/v2/models/*.json');
const pathFor = (id) => `../../../shared/v2/models/${id}.json`;
const cache = new Map();

/** Model file for a field, or null when there is none (or it can't be read: makeSlots then uses the placeholders). */
export function loadModelFile(fieldId) {
  if (!fieldId) return Promise.resolve(null);
  if (!cache.has(fieldId)) {
    const load = MODEL_FILES[pathFor(fieldId)];
    cache.set(fieldId, load ? load().then((m) => m.default ?? null, () => { cache.delete(fieldId); return null; }) : Promise.resolve(null));
  }
  return cache.get(fieldId);
}
