// Checks that en.json and es.json have exactly the same keys and the same {placeholders} in every string.
// Run: npm run i18n   (from /app). Exits 1 on any difference.
import { readFileSync } from 'node:fs';

const load = (l) => JSON.parse(readFileSync(new URL(`../../content/i18n/${l}.json`, import.meta.url), 'utf8'));
const en = load('en');
const es = load('es');

const flat = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flat(v, key, out);
    else out[key] = v;
  }
  return out;
};
const a = flat(en);
const b = flat(es);
const holes = (s) => (typeof s === 'string' ? [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',') : '');

let bad = 0;
for (const k of Object.keys(a)) if (!(k in b)) { console.log('missing in es:', k); bad++; }
for (const k of Object.keys(b)) if (!(k in a)) { console.log('missing in en:', k); bad++; }
for (const k of Object.keys(a)) {
  if (k in b && holes(a[k]) !== holes(b[k])) { console.log(`placeholders differ at ${k}: en {${holes(a[k])}} vs es {${holes(b[k])}}`); bad++; }
}
console.log(bad ? `FAIL: ${bad} problem(s)` : `ok: ${Object.keys(a).length} keys match in en and es`);
process.exit(bad ? 1 : 0);
