// Precompute the v2 output for every Ellis County study field: shared/v2/fields/<id>.json (docs/v2-data-contract.md 2.1)
// and the report card shared/v2/validation.json. Each file is checked with scoring/v2Contract.js before it is written.
//
//   node scoring/tools/precompute_v2.mjs                    all 300 fields, 6 worker threads
//   node scoring/tools/precompute_v2.mjs --ids ec-251,ec-000 --workers 2
//   node scoring/tools/precompute_v2.mjs --out shared/v2/fields-test --no-report
//
// Model slot files in shared/v2/models/<id>.json are picked up automatically (placeholders are used where a file or section is missing).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = new URL('../../', import.meta.url);
const rootPath = fileURLToPath(root);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const MILES_PER_KM = 0.621371;
const RECENT_CROP_YEARS = 8;      // "grown in the last 8 years" (market fit)
const NEIGHBOR_CROP_YEARS = 6;    // a neighbour "does this" when its last 6 crop-map years include every cash crop of the option

if (isMainThread) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const outDir = resolve(rootPath, arg('--out', 'shared/v2/fields'));
  const workers = Math.max(1, Number(arg('--workers', 6)));
  const noReport = argv.includes('--no-report');
  const allIds = readdirSync(resolve(rootPath, 'shared/fields')).filter((f) => /^ec-\d+\.json$/.test(f)).map((f) => f.replace('.json', '')).sort();
  const ids = arg('--ids', null) ? arg('--ids').split(',') : allIds;
  mkdirSync(outDir, { recursive: true });

  // regional context: how common is each crop among the study fields, and where is everybody
  const index = [];
  const grewIn = {};
  for (const id of allIds) {
    const f = readJson(resolve(rootPath, `shared/fields/${id}.json`));
    const hist = f.cropHistory ?? [];
    const recent = new Set(hist.slice(-RECENT_CROP_YEARS).map((r) => r.crop));
    for (const c of recent) grewIn[c] = (grewIn[c] ?? 0) + 1;
    index.push({ id, lat: f.field.lat, lon: f.field.lon, crops: [...new Set(hist.slice(-NEIGHBOR_CROP_YEARS).map((r) => r.crop))] });
  }
  const cropFieldShare = Object.fromEntries(Object.entries(grewIn).map(([c, n]) => [c, n / allIds.length]));
  const now = new Date().toISOString();
  console.log(`precompute v2: ${ids.length} fields, ${workers} workers -> ${outDir}`);
  const t0 = Date.now();
  const results = [];
  let done = 0;
  const chunks = Array.from({ length: Math.min(workers, ids.length) }, () => []);
  ids.forEach((id, i) => chunks[i % chunks.length].push(id));
  let failed = false;
  await Promise.all(chunks.map((chunk) => new Promise((ok) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { ids: chunk, outDir, index, cropFieldShare, now } });
    w.on('message', (m) => {
      if (m.error) { failed = true; console.error(`FAILED ${m.id}: ${m.error}`); }
      results.push(m);
      done++;
      if (done % 10 === 0 || done === ids.length) console.log(`  ${done}/${ids.length} fields, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    });
    w.on('error', (e) => { failed = true; console.error('worker error', e); ok(); });
    w.on('exit', ok);
  })));
  const wall = (Date.now() - t0) / 1000;
  const good = results.filter((r) => !r.error);
  const ms = good.map((r) => r.ms).sort((a, b) => a - b);
  const sizes = good.map((r) => r.bytes).sort((a, b) => a - b);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const bad = good.filter((r) => r.problems.length);
  console.log(`\nDone in ${wall.toFixed(0)} s (${(wall / 60).toFixed(1)} min). ${good.length} written, ${results.length - good.length} failed, ${bad.length} failed the contract check.`);
  console.log(`Per field: median ${(ms[ms.length >> 1] / 1000).toFixed(1)} s, mean ${(sum(ms) / ms.length / 1000).toFixed(1)} s, max ${(ms[ms.length - 1] / 1000).toFixed(1)} s (one thread).`);
  console.log(`File size: min ${(sizes[0] / 1024).toFixed(0)} KB, median ${(sizes[sizes.length >> 1] / 1024).toFixed(0)} KB, max ${(sizes[sizes.length - 1] / 1024).toFixed(0)} KB, total ${(sum(sizes) / 1048576).toFixed(1)} MB.`);
  const kept = good.map((r) => r.kept).sort((a, b) => a - b);
  console.log(`Options kept per field: min ${kept[0]}, median ${kept[kept.length >> 1]}, max ${kept[kept.length - 1]}.`);
  for (const r of bad.slice(0, 5)) console.log('  contract problems', r.id, r.problems.slice(0, 3));
  if (!noReport && good.length) {
    const { buildReportCard } = await import('../v2/reportCard.js');
    const { validateReportCard } = await import('../v2Contract.js');
    const first = readJson(resolve(rootPath, `shared/fields/${ids[0]}.json`));
    const card = buildReportCard(good.map((r) => ({ fieldId: r.id, bare: r.validationRaw.bare, dateErrors: r.validationRaw.dateErrors, yields: r.validationRaw.yields })), first.market.yields, {
      generatedAt: now, engineVersion: good[0].engineVersion, defaultTillage: good[0].tillage,
    });
    const probs = validateReportCard(card);
    if (probs.length) console.error('report card problems', probs);
    writeFileSync(resolve(rootPath, 'shared/v2/validation.json'), JSON.stringify(card, null, 1));
    console.log('Report card written: shared/v2/validation.json');
    for (const c of card.checks) console.log(`  check ${c.id}: ${c.status}`);
  }
  process.exit(failed ? 1 : 0);
} else {
  const { slotsForField } = await import('../modelSlots.node.js');
  const { loadField, loadLibrary, loadEconomics } = await import('../engine/node.js');
  const { analyzeField } = await import('../v2/analyzeField.js');
  const { validateFieldOutput } = await import('../v2Contract.js');
  const { NEIGHBOR_RADIUS_MILES } = await import('../v2/constants.js');
  const { ids, outDir, index, cropFieldShare, now } = workerData;
  const library = loadLibrary(), economics = loadEconomics();
  const scoresConfig = readJson(resolve(rootPath, 'content/v2-scores.json'));
  const hav = (a, b) => {
    const R = 6371, d2r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * d2r, dLon = (b.lon - a.lon) * d2r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };
  for (const id of ids) {
    try {
      const field = loadField(id);
      const slots = slotsForField(field);
      const me = index.find((x) => x.id === id);
      const near = index.filter((x) => x.id !== id && hav(me, x) * MILES_PER_KM <= NEIGHBOR_RADIUS_MILES);
      const neighborsFor = (cash) => ({ count: near.filter((x) => cash.every((c) => x.crops.includes(c))).length, radiusMiles: NEIGHBOR_RADIUS_MILES });
      const { out, meta } = analyzeField({ field, slots, library, economics, scoresConfig, regional: { cropFieldShare }, neighborsFor, now, validationExtra: true });
      const problems = validateFieldOutput(out, scoresConfig);
      const text = JSON.stringify(out);
      writeFileSync(resolve(outDir, `${id}.json`), text);
      parentPort.postMessage({ id, ms: meta.ms, bytes: Buffer.byteLength(text), problems, kept: out.options.length, validationRaw: meta.validationRaw, engineVersion: out.engineVersion, tillage: out.simulation.currentTillageAssumed });
    } catch (e) {
      parentPort.postMessage({ id, error: String(e?.stack ?? e) });
    }
  }
}
