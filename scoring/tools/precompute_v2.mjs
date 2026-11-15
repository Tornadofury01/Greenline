// Precompute the v2 output for the North Texas fields: shared/v2/fields/<id>.json (docs/v2-data-contract.md 2.1)
// and the report card shared/v2/validation.json. Each file is checked with scoring/v2Contract.js before it is written.
// Inputs: shared/v2/input-index.json + shared/v2/inputs/<id>.json (pipeline/v2/build_inputs.py). Run guide: docs/v2-precompute-guide.md
//
//   node scoring/tools/precompute_v2.mjs                              every field in the index, 6 worker threads
//   node scoring/tools/precompute_v2.mjs --counties 48139,48217,48251 one computer's share (no report card: --no-report)
//   node scoring/tools/precompute_v2.mjs --ids 48139-0000 --workers 1 --out shared/v2/fields-test --no-report
//   node scoring/tools/precompute_v2.mjs --legacy                     the old v1 Ellis files (ec-*)
//   node scoring/tools/precompute_v2.mjs --report-only                report card from the output files already there
//
// Model slot files in shared/v2/models/<id>.json are picked up automatically (placeholders are used where a file or section is missing).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, existsSync } from 'node:fs';
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
  // Which fields. v2 (default): every field in shared/v2/input-index.json (pipeline/v2/build_inputs.py), optionally only
  // --counties 48139,48217 or --ids. The index also carries each field's recent crops, so the regional context below is
  // the same on every computer even when each one only has its own counties' input files. --legacy: the v1 ec-* files.
  const legacy = argv.includes('--legacy');
  const indexPath = resolve(rootPath, 'shared/v2/input-index.json');
  let index, cropShareFor;
  if (legacy) {
    const allIds = readdirSync(resolve(rootPath, 'shared/fields')).filter((f) => /^ec-\d+\.json$/.test(f)).map((f) => f.replace('.json', '')).sort();
    const grewIn = {};
    index = allIds.map((id) => {
      const f = readJson(resolve(rootPath, `shared/fields/${id}.json`));
      const hist = f.cropHistory ?? [];
      for (const c of new Set(hist.slice(-RECENT_CROP_YEARS).map((r) => r.crop))) grewIn[c] = (grewIn[c] ?? 0) + 1;
      return { id, county: 'ec', lat: f.field.lat, lon: f.field.lon, crops: [...new Set(hist.slice(-NEIGHBOR_CROP_YEARS).map((r) => r.crop))] };
    });
    const share = Object.fromEntries(Object.entries(grewIn).map(([c, n]) => [c, n / allIds.length]));
    cropShareFor = () => share;
  } else {
    if (!existsSync(indexPath)) { console.error('shared/v2/input-index.json is missing: run python pipeline/v2/build_inputs.py first (or pass --legacy)'); process.exit(1); }
    const rows = readJson(indexPath).fields;
    index = rows.map((r) => ({ id: r.id, county: r.countyFips, lat: r.lat, lon: r.lon, crops: r.neighborCrops, texture: r.texture ?? null }));
    // how common each crop is among the fields of the SAME county (market fit), grown in the last 8 crop-map years
    const byCounty = {};
    for (const r of rows) {
      const c = (byCounty[r.countyFips] ??= { n: 0, grew: {} });
      c.n++;
      for (const crop of r.recentCrops) c.grew[crop] = (c.grew[crop] ?? 0) + 1;
    }
    const shares = Object.fromEntries(Object.entries(byCounty).map(([k, c]) => [k, Object.fromEntries(Object.entries(c.grew).map(([crop, n]) => [crop, n / c.n]))]));
    cropShareFor = (county) => shares[county] ?? {};
  }
  const counties = arg('--counties', null)?.split(',');
  let ids = arg('--ids', null) ? arg('--ids').split(',') : index.filter((x) => !counties || counties.includes(x.county)).map((x) => x.id);
  if (!legacy) {
    const missing = ids.filter((id) => !existsSync(resolve(rootPath, `shared/v2/inputs/${id}.json`)));
    if (missing.length) console.warn(`skipping ${missing.length} fields with no input file in shared/v2/inputs (e.g. ${missing.slice(0, 3).join(', ')})`);
    ids = ids.filter((id) => !missing.includes(id));
    // Not farmland: no soil data at all (SSURGO "Pits, gravel" and the like). The app shows "No data here yet".
    const noSoil = ids.filter((id) => readJson(resolve(rootPath, `shared/v2/inputs/${id}.json`)).soil?.waterStorage100Cm == null);
    if (noSoil.length) console.warn(`skipping ${noSoil.length} fields with no soil data (not farmland): ${noSoil.join(', ')}`);
    ids = ids.filter((id) => !noSoil.includes(id));
  }
  mkdirSync(outDir, { recursive: true });
  const cropFieldShare = Object.fromEntries([...new Set(index.map((x) => x.county))].map((k) => [k, cropShareFor(k)]));
  const now = new Date().toISOString();
  const rawDir = resolve(rootPath, arg('--raw', 'shared/v2/validation-raw'));      // per-field validation numbers
  const cardsDir = resolve(rootPath, arg('--cards', 'shared/v2'));                  // validation.json + validation-by-county/
  const loadInput = (id) => readJson(existsSync(resolve(rootPath, `shared/v2/inputs/${id}.json`)) ? resolve(rootPath, `shared/v2/inputs/${id}.json`) : resolve(rootPath, `shared/fields/${id}.json`));
  function writeCard(card, path) {
    return import('../v2Contract.js').then(({ validateReportCard }) => {
      const probs = validateReportCard(card);
      if (probs.length) console.error('report card problems', probs);
      writeFileSync(path, JSON.stringify(card, null, 1));
      console.log(`Report card written: ${path}`);
      for (const c of card.checks) console.log(`  check ${c.id}: ${c.status}`);
    });
  }
  // One card per county from every validation-raw file present (merge both computers' runs first), Hill included.
  // shared/v2/validation.json (the card the app shows) = Ellis (48139) when it is there, else the largest county.
  async function writeReport() {
    const { buildReportCard } = await import('../v2/reportCard.js');
    const { neighborBacktest } = await import('../v2/neighborBacktest.js');
    const erPath = resolve(rootPath, 'shared/v2/erosion-check.json');
    const erosionCheck = existsSync(erPath) ? readJson(erPath) : null;
    // check 7: every field's recommended cash crops vs what similar neighbors grew (neighbors from all six counties)
    const outDirAll = outDir;
    const idxRows = existsSync(indexPath) ? readJson(indexPath).fields : [];
    const nbFields = idxRows.map((r) => {
      const has = existsSync(resolve(outDirAll, `${r.id}.json`));
      const o = has ? readJson(resolve(outDirAll, `${r.id}.json`)) : null;
      const best = o?.options.find((x) => x.id === o.bestPlans?.bestBalance?.optionId);
      const inp = existsSync(resolve(rootPath, `shared/v2/inputs/${r.id}.json`)) ? readJson(resolve(rootPath, `shared/v2/inputs/${r.id}.json`)) : null;
      return { id: r.id, county: r.countyFips, lat: r.lat, lon: r.lon, texture: r.texture ?? inp?.soil?.texture ?? null, crops: r.neighborCrops, recommended: best?.name?.params?.cashAll ?? [], has };
    });
    const msPath = resolve(rootPath, 'shared/v2/model-scores.json');
    const modelScores = existsSync(msPath) ? readJson(msPath) : null;
    const rows = readdirSync(rawDir).filter((f) => !f.startsWith('_') && f.endsWith('.json')).map((f) => readJson(resolve(rawDir, f)));
    const byCounty = {};
    for (const r of rows) (byCounty[r.county] ??= []).push(r);
    mkdirSync(resolve(cardsDir, 'validation-by-county'), { recursive: true });
    const cards = {};
    for (const [county, rs] of Object.entries(byCounty)) {
      const nassPath = resolve(rawDir, `_nass-${county}.json`);
      const nass = existsSync(nassPath) ? readJson(nassPath) : [];
      cards[county] = buildReportCard(rs.map((r) => ({ fieldId: r.fieldId, bare: r.bare, dateErrors: r.dateErrors, yields: r.yields, soilMoisture: r.soilMoisture })), nass, {
        generatedAt: now, engineVersion: rs[0].engineVersion, defaultTillage: rs[0].tillage, modelScores, erosionCheck,
        neighbor: neighborBacktest(nbFields, { countIds: new Set(nbFields.filter((f) => f.has && f.county === county && rs.some((x) => x.fieldId === f.id)).map((f) => f.id)) }),
      });
      await writeCard(cards[county], resolve(cardsDir, `validation-by-county/${county}.json`));
    }
    const main = cards['48139'] ?? Object.entries(byCounty).sort((x, y) => y[1].length - x[1].length).map(([k]) => cards[k])[0];
    if (main) await writeCard(main, resolve(cardsDir, 'validation.json'));
    console.log(`Report cards from ${rows.length} fields in ${Object.keys(byCounty).length} counties`);
  }
  if (argv.includes('--report-only')) { await writeReport(); process.exit(0); }
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
  // Per-field validation numbers go to shared/v2/validation-raw/ so a report card can merge runs from several computers.
  if (!legacy) {
    mkdirSync(rawDir, { recursive: true });
    const nassDone = new Set();
    for (const r of good) {
      const county = index.find((x) => x.id === r.id)?.county;
      writeFileSync(resolve(rawDir, `${r.id}.json`), JSON.stringify({ fieldId: r.id, county, engineVersion: r.engineVersion, tillage: r.tillage, ...r.validationRaw }));
      if (county && !nassDone.has(county)) {
        nassDone.add(county);
        writeFileSync(resolve(rawDir, `_nass-${county}.json`), JSON.stringify(loadInput(r.id).market.yields));
      }
    }
  }
  if (!noReport && good.length) {
    if (legacy) {
      const { buildReportCard } = await import('../v2/reportCard.js');
      const first = loadInput(ids[0]);
      await writeCard(buildReportCard(good.map((r) => ({ fieldId: r.id, ...r.validationRaw })), first.market.yields, {
        generatedAt: now, engineVersion: good[0].engineVersion, defaultTillage: good[0].tillage,
      }), resolve(rootPath, 'shared/v2/validation.json'));
    } else await writeReport();
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
      // crops grown in the last crop-map years by fields on the same soil texture within the radius (check 7)
      const neighborCrops = new Set(near.filter((x) => me.texture == null || x.texture === me.texture).flatMap((x) => x.crops));
      const neighborsFor = (cash) => ({ count: near.filter((x) => cash.every((c) => x.crops.includes(c))).length, radiusMiles: NEIGHBOR_RADIUS_MILES });
      const { out, meta } = analyzeField({ field, slots, library, economics, scoresConfig, regional: { cropFieldShare: cropFieldShare[me.county] ?? {} }, neighborsFor, neighborCrops, now, validationExtra: true });
      const problems = validateFieldOutput(out, scoresConfig);
      const text = JSON.stringify(out);
      writeFileSync(resolve(outDir, `${id}.json`), text);
      parentPort.postMessage({ id, ms: meta.ms, bytes: Buffer.byteLength(text), problems, kept: out.options.length, validationRaw: meta.validationRaw, engineVersion: out.engineVersion, tillage: out.simulation.currentTillageAssumed });
    } catch (e) {
      parentPort.postMessage({ id, error: String(e?.stack ?? e) });
    }
  }
}
