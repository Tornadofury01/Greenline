// Check that a model slot file is read: node scoring/tools/checkModelFile.mjs shared/v2/models/ec-251.json
// Prints, for each of the five slots, whether the engine will use "model" or "placeholder", and why a section was rejected.
// Exit code 1 if the file is unreadable, a delivered section was rejected, or no slot reads as "model".
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { makeSlots, SLOT_NAMES } from '../modelSlots.js';
import { loadPlaceholders } from '../modelSlots.node.js';

const path = process.argv[2];
if (!path || !existsSync(path)) { console.error('usage: node scoring/tools/checkModelFile.mjs <path to shared/v2/models/<field-id>.json>'); process.exit(1); }

let modelFile;
try { modelFile = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`NOT READ: not valid JSON (${e.message})`); process.exit(1); }

const fieldId = modelFile.fieldId ?? basename(path, '.json');
const fieldPath = new URL(`../../shared/fields/${fieldId}.json`, import.meta.url);
if (!/^[A-Za-z0-9_-]+$/.test(fieldId) || !existsSync(fieldPath)) { console.error(`NOT READ: no field file shared/fields/${fieldId}.json`); process.exit(1); }
if (basename(path, '.json') !== fieldId && !basename(path).startsWith('_')) console.warn(`warning: file name ${basename(path)} does not match fieldId ${fieldId}; the engine looks for ${fieldId}.json`);

const field = JSON.parse(readFileSync(fieldPath, 'utf8'));
const r = makeSlots({ field, modelFile, placeholders: loadPlaceholders() });

for (const s of SLOT_NAMES) console.log(`${r.sources[s] === 'model' ? 'MODEL      ' : 'placeholder'}  ${s}${modelFile[s] == null ? '  (section not in file)' : ''}`);
if (r.problems.length) { console.log('\nProblems:'); r.problems.forEach((p) => console.log(' - ' + p)); }

const delivered = SLOT_NAMES.filter((s) => modelFile[s] != null);
const rejected = delivered.filter((s) => r.sources[s] !== 'model');
if (rejected.length || !delivered.length || r.problems.length) { console.error(`\nFAIL: ${rejected.length ? 'rejected: ' + rejected.join(', ') : 'nothing was read'}`); process.exit(1); }
console.log(`\nOK: ${delivered.length} slot(s) read from the file for ${fieldId}. Placeholders left: ${r.placeholderSlots.join(', ') || 'none'}.`);
