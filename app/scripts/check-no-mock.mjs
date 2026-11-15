// Fails if mock numbers come back into the shipped app (G2c: the Farm game runs only on the real engine).
// Checks: no file with "mock" in its name under app/src, no mock flag / mock run in the code, no "game.mock" text key.
// Run by `npm run selftest`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const src = new URL('../src/', import.meta.url);
const root = src.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BAD = /\bUSING_MOCK\b|\bmockRuns?\b|\bmockWeather\b|\bmock\s*:\s*true\b|['"]game\.mock['"]|\bisMock\b|\buseMock\b/;
const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (/mock/i.test(name)) problems.push(`mock file: ${p}`);
    if (!/\.(jsx?|mjs|json)$/.test(name)) continue;
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => { if (BAD.test(line)) problems.push(`mock flag: ${p}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
}
walk(root);
for (const lang of ['en', 'es']) {
  const j = JSON.parse(readFileSync(new URL(`../../content/i18n/${lang}.json`, import.meta.url), 'utf8'));
  if (j.game && 'mock' in j.game) problems.push(`i18n key game.mock is back in ${lang}.json`);
}
if (problems.length) {
  console.error(`FAIL no-mock check (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('ok   no mock files, flags or text in app/src (Farm game runs on the engine only)');
