// Data integrity checks for the merged presentation, across all real field files.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { buildMergedPlans, rotationKey, eligibleAlternative, supportedReturn, alternativeDistinction } = await server.ssrLoadModule('/src/data/mergedPlans.js');
  const dir = new URL('../../shared/v2/fields/', import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  const { pickBestPlans } = await server.ssrLoadModule('@scoring/v2/analyzeField.js');
  const { weightsFor } = await server.ssrLoadModule('@scoring/v2/scores.js');
  const config = JSON.parse(await readFile(new URL('../../content/v2-scores.json', import.meta.url), 'utf8'));
  let distinct = 0, overlap = 0, alternatives = 0, fallback = 0, noEligible = 0;
  for (const file of files) {
    const data = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
    const original = JSON.stringify(data);
    const built = buildMergedPlans(data);
    // Some fields have no rotation that passes every limit (e.g. none is as safe as today in the worst years). Then there
    // is no "best" and only today's rotation is shown: never an invented alternative.
    const anyEligible = data.options.some((o) => eligibleAlternative(o) && rotationKey(o) !== rotationKey(data.current));
    assert.equal(!!built.best, anyEligible, file + ' best exists exactly when an eligible rotation exists');
    if (!built.best) {
      noEligible++;
      assert.equal(built.strategies.length, 1, file + ' no eligible rotation: only today is shown');
      assert.equal(built.strategies[0].option, data.current, file);
      assert.equal(JSON.stringify(data), original, 'Presentation must not mutate v2 data');
      continue;
    }
    assert.equal(built.best.option.id, data.bestPlans.bestBalance.optionId, file);
    assert.equal(built.best.returns.typical, built.best.option.profit.returnAboveVariable.typical, file);
    assert.equal(built.strategies[0].option, data.current, file);
    const unique = new Set(['mostProfitable', 'bestBalance', 'safest'].map((k) => data.bestPlans[k].optionId));
    if (unique.size === 3) distinct++;
    else overlap++;
    const eligible = data.options.filter((o) => eligibleAlternative(o)
      && rotationKey(o) !== rotationKey(built.best.option) && rotationKey(o) !== rotationKey(data.current));
    const alt = built.strategies.find((s) => s.kind === 'alternative');
    assert.equal(!!alt, eligible.length > 0, file);
    if (alt) {
      alternatives++;
      assert(eligible.includes(alt.option), file);
      assert.notEqual(rotationKey(alt.option), rotationKey(built.best.option), file);
    }
    if (built.alternativeFromOverlap) fallback++;
    for (const [priorities, mapped] of [[['water', 'soil'], ['saveWater', 'soil']], [['income'], ['income']], [['soil'], ['soil']]]) {
      const farm = { priorities, waterMode: 'dryland' };
      const pool = data.options.filter((o) => eligibleAlternative(o, farm) && rotationKey(o) !== rotationKey(data.current));
      const actual = buildMergedPlans(data, farm);
      if (!pool.length) { assert.equal(actual.best, null, file + ' priority selection: none eligible'); continue; }
      const expected = pickBestPlans(pool, data.current, weightsFor(mapped, config), config).bestBalance.optionId;
      assert.equal(actual.best.option.id, expected, file + ' priority selection');
      assert.equal(new Set(actual.strategies.map((s) => rotationKey(s.option))).size, actual.strategies.length, file + ' duplicate crop cycle');
      const alt = actual.strategies.find((s) => s.kind === 'alternative');
      if (alt) assert.deepEqual({ label: alt.label, reason: alt.reason }, alternativeDistinction(alt.option, actual.best.option));
    }
    assert.equal(JSON.stringify(data), original, 'Presentation must not mutate v2 data');
  }
  const source = JSON.parse(await readFile(new URL('ec-003.json', dir), 'utf8'));
  const unavailable = structuredClone(source);
  for (const option of unavailable.options) option.limits.soilMet = false;
  assert.equal(buildMergedPlans(unavailable).strategies.length, 1, 'Do not invent an eligible alternative');
  const irrigated = structuredClone(source);
  irrigated.options[0].management.irrigation = 'full';
  const dry = buildMergedPlans(irrigated, { priorities: ['income'], waterMode: 'dryland' });
  assert(dry.strategies.every((s) => s.kind === 'current' || s.option.management.irrigation === 'none'));
  const current = source.current;
  const shifted = { ...current, sequence: [...current.sequence.slice(1), current.sequence[0]] };
  assert.equal(rotationKey(current), rotationKey({ ...current, sequence: [...current.sequence, ...current.sequence] }));
  assert.equal(rotationKey(current), rotationKey(shifted), 'Shifted crop cycle is not a new strategy');
  assert.equal(supportedReturn({ profit: { returnAboveVariable: { typical: 10, unit: 'usd/acre' } } }), null);
  assert.equal(supportedReturn({ profit: { returnAboveVariable: { typical: 10, low: 20, high: 30, unit: 'usd/acre/year' } } }).low, null);
  assert.equal(supportedReturn({ profit: { returnAboveVariable: { typical: -10, low: -20, high: 0, unit: 'usd/acre/year' } } }).typical, -10);
  console.log(JSON.stringify({ fields: files.length, distinct, overlap, alternatives, fallback, noEligible, guards: 'passed' }));
} finally {
  await server.close();
}
