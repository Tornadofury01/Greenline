// Quick sanity check: node scoring/selftest.js
import { readFileSync } from 'node:fs';
import { scoreRotation, suggestRotations } from './index.js';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const field = load('../shared/sample-field.json');
const lib = load('../content/crops.json');
const { rotations } = load('../content/rotations.json');
let failed = 0;
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failed++; };

const current = { id: 'current', crops: ['winter_wheat', 'grain_sorghum', 'cotton'] };
const base = scoreRotation(current, field, ['water'], { water: 'dryland' }, lib);
check(base.total >= 0 && base.total <= 100, `total in range (${base.total})`);
check(['high', 'medium', 'low'].includes(base.confidence.level), `confidence (${base.confidence.level})`);

const corn = scoreRotation({ crops: ['corn', 'corn'] }, field, ['water'], { water: 'dryland' }, lib);
const sesame = scoreRotation({ crops: ['sesame', 'cowpea'] }, field, ['water'], { water: 'dryland' }, lib);
check(sesame.total > corn.total, `dryland water: sesame/cowpea (${sesame.total}) beats corn (${corn.total})`);
check(corn.risks.some((r) => r.key === 'risks.thirstyDryland'), 'corn on dryland flagged as risk');

const soilA = scoreRotation({ crops: ['cotton', 'cotton'] }, field, ['soil'], {}, lib);
const soilB = scoreRotation({ crops: ['hairy_vetch', 'cereal_rye', 'cowpea'] }, field, ['soil'], {}, lib);
check(soilB.breakdown.soil.score > soilA.breakdown.soil.score, 'cover/legume mix improves soil more than cotton');

const sugg = suggestRotations(rotations, current, field, ['water', 'erosion'], { water: 'dryland' }, lib);
check(sugg.length === 2, `two suggestions: ${sugg.map((s) => `${s.rotationId}=${s.total}`).join(', ')}`);

process.exit(failed ? 1 : 0);
