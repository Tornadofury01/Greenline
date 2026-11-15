// Node-only helpers for the engine (pipeline scripts, selftests). The browser app imports the JSON files itself.
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export const loadLibrary = () => readJson(new URL('content/crop-library.json', root));
export const loadEconomics = () => readJson(new URL('content/economics.json', root));
export function loadField(id) {
  if (!SAFE_ID.test(id)) throw new Error(`bad field id: ${id}`);
  // v2 North Texas inputs (pipeline/v2/build_inputs.py) first, then the v1 Ellis files (ec-*)
  const v2 = new URL(`shared/v2/inputs/${id}.json`, root);
  return readJson(existsSync(v2) ? v2 : new URL(`shared/fields/${id}.json`, root));
}
