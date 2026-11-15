// Field Shift v2: check that a computer has every file it needs to precompute its counties (no computing, reads only).
//
//   node pipeline/v2/check_share.mjs --counties 48257,48309,48349      computer B, before the precompute
//   node pipeline/v2/check_share.mjs --counties 48257,48309,48349 --results   computer B, before sending results back
//
// Checks: Node version, the code and content files the precompute reads, shared/v2/input-index.json (all 1,711 fields),
// and for every field of the given counties: shared/v2/inputs/<id>.json and shared/v2/models/<id>.json exist, parse,
// and belong to that field. With --results: shared/v2/fields/<id>.json and shared/v2/validation-raw/<id>.json too.
// Exit code 0 = ready, 1 = something is missing (listed).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const counties = (arg('--counties', '') || '').split(',').filter(Boolean);
const results = argv.includes('--results');
const NAMES = { 48139: 'Ellis', 48217: 'Hill', 48251: 'Johnson', 48257: 'Kaufman', 48309: 'McLennan', 48349: 'Navarro' };
const EXPECTED_TOTAL = 1711;

const problems = [];
const ok = (msg) => console.log(`ok    ${msg}`);
const bad = (msg) => { problems.push(msg); console.log(`MISSING ${msg}`); };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return undefined; } };

if (!counties.length) { console.error('give --counties, e.g. --counties 48257,48309,48349'); process.exit(2); }

// 1. Node
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) ok(`Node ${process.versions.node}`); else bad(`Node 20 or newer (this is ${process.versions.node})`);

// 2. code and content the precompute reads (come with git pull)
for (const f of ['scoring/tools/precompute_v2.mjs', 'scoring/v2/analyzeField.js', 'scoring/engine/node.js', 'scoring/modelSlots.node.js',
  'scoring/v2Contract.js', 'scoring/v2/reportCard.js', 'content/crop-library.json', 'content/economics.json',
  'content/model-placeholders.json', 'content/v2-scores.json']) {
  if (existsSync(resolve(root, f))) ok(f); else bad(`${f} (git pull the branch pranav-work)`);
}

// 3. the field index (comes in the zip from computer A)
const index = readJson(resolve(root, 'shared/v2/input-index.json'));
if (!index?.fields) { bad('shared/v2/input-index.json (in the zip from computer A)'); finish(); }
const rows = index.fields;
if (rows.length === EXPECTED_TOTAL) ok(`shared/v2/input-index.json lists all ${EXPECTED_TOTAL} fields`);
else bad(`shared/v2/input-index.json lists ${rows.length} fields, expected ${EXPECTED_TOTAL} (computer A builds all six counties first)`);

// 4. per county, per field
for (const c of counties) {
  const ids = rows.filter((r) => r.countyFips === c).map((r) => r.id);
  if (!ids.length) { bad(`no fields for county ${c} in the index`); continue; }
  const need = [['shared/v2/inputs', 'input'], ['shared/v2/models', 'model slot']];
  if (results) need.push(['shared/v2/fields', 'result'], ['shared/v2/validation-raw', 'validation']);
  for (const [dir, label] of need) {
    const missing = [], broken = [];
    for (const id of ids) {
      const p = resolve(root, dir, `${id}.json`);
      if (!existsSync(p)) { missing.push(id); continue; }
      const j = readJson(p);
      const owner = j?.field?.id ?? j?.fieldId;
      if (!j || (owner !== undefined && owner !== id)) broken.push(id);
    }
    const name = `${NAMES[c] ?? c} (${c}): ${ids.length - missing.length - broken.length}/${ids.length} ${label} files in ${dir}/`;
    if (!missing.length && !broken.length) ok(name);
    else bad(`${name}; missing ${missing.length} (e.g. ${missing.slice(0, 3).join(', ') || '-'}), unreadable ${broken.length} (e.g. ${broken.slice(0, 3).join(', ') || '-'})`);
  }
  if (results && !existsSync(resolve(root, `shared/v2/validation-raw/_nass-${c}.json`))) bad(`shared/v2/validation-raw/_nass-${c}.json`);
}
finish();

function finish() {
  console.log(problems.length ? `\nNOT READY: ${problems.length} problem(s) above.` : `\nREADY: everything is here for ${counties.join(', ')}.`);
  process.exit(problems.length ? 1 : 0);
}
