// Node-only loader for the model slots (pipeline scripts, selftests). The browser app does not import this file.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeSlots } from './modelSlots.js';

const root = new URL('../', import.meta.url);
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export const loadPlaceholders = () => readJson(new URL('content/model-placeholders.json', root));

/** shared/v2/models/<fieldId>.json, or null when it does not exist. `modelsDir` is for tests (a URL or path string). */
export function loadModelFile(fieldId, modelsDir = new URL('shared/v2/models/', root)) {
  if (!SAFE_ID.test(fieldId)) throw new Error(`bad field id: ${fieldId}`);
  const dir = typeof modelsDir === 'string' ? pathToFileURL(resolve(modelsDir) + sep) : modelsDir;
  const file = new URL(`${fieldId}.json`, dir);
  return existsSync(file) ? readJson(file) : null;
}

/** Everything the engine needs for one field. `field` = shared/fields/<id>.json (parsed). */
export function slotsForField(field, { modelsDir, placeholders = loadPlaceholders() } = {}) {
  const modelFile = loadModelFile(field.field.id, modelsDir);
  return makeSlots({ field, modelFile, placeholders });
}
