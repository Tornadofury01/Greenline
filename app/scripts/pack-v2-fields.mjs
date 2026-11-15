// Packs the precomputed v2 field files for the app: shared/v2/fields/<id>.json -> public/v2f/<id>.json.gz (gzip -9)
// plus public/v2f/index.json (the ids the app can load; any other id shows "No data here yet").
// Why: ~130 KB of JSON per field x 1,711 fields is ~220 MB; gzipped it is ~10 KB per field (~17 MB), which fits a
// Vercel deploy, and the files stay out of the JS bundle (no 1,711 build chunks). data/loadV2.js unpacks them.
// Runs before `npm run dev` and `npm run build`. public/v2f/ is generated: never edit or commit it.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const src = new URL('../../shared/v2/fields/', import.meta.url);
const out = new URL('../public/v2f/', import.meta.url);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const ids = existsSync(src) ? readdirSync(src).filter((f) => /^[A-Za-z0-9_-]+\.json$/.test(f)).map((f) => f.slice(0, -5)).sort() : [];
let raw = 0, packed = 0;
for (const id of ids) {
  const buf = readFileSync(new URL(`${id}.json`, src));
  const gz = gzipSync(buf, { level: 9 });
  writeFileSync(new URL(`${id}.json.gz`, out), gz);
  raw += buf.length;
  packed += gz.length;
}
writeFileSync(new URL('index.json', out), JSON.stringify({ ids }));
const mb = (n) => (n / 1048576).toFixed(1);
console.log(`pack-v2-fields: ${ids.length} fields, ${mb(raw)} MB -> ${mb(packed)} MB in public/v2f/`);
