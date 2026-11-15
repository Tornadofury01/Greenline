// Node-only helpers for the engine (pipeline scripts, selftests). The browser app imports the JSON files itself.
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export const loadLibrary = () => readJson(new URL('content/crop-library.json', root));
export const loadEconomics = () => readJson(new URL('content/economics.json', root));
export function loadField(id) {
  if (!SAFE_ID.test(id)) throw new Error(`bad field id: ${id}`);
  return readJson(new URL(`shared/fields/${id}.json`, root));
}
