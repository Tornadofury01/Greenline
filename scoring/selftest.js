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

// Bad-year replay on a real field (nt-103) in the 2011 drought.
const real = load('../shared/fields/nt-103.json');
const dry = { water: 'dryland' };
const replayOf = (crops, year = 2011) => scoreRotation({ crops }, real, ['water'], dry, lib, { replayYear: year });
const cornHeavy = replayOf(['corn', 'corn', 'winter_wheat']);
const hardy = replayOf(['grain_sorghum', 'sesame', 'cowpea']);
check(hardy.replay.score > cornHeavy.replay.score, `2011 replay: sorghum/sesame/cowpea (${hardy.replay.score.toFixed(1)}) holds up better than corn-heavy (${cornHeavy.replay.score.toFixed(1)})`);
check(hardy.replayTotal > cornHeavy.replayTotal, `2011 replay totals: ${hardy.replayTotal} vs ${cornHeavy.replayTotal}`);
const plain = scoreRotation({ crops: ['corn', 'cotton'] }, real, ['water'], dry, lib);
const withOpt = replayOf(['corn', 'cotton']);
check(plain.replay === null && plain.replayTotal === null, 'replay off: no replay fields');
check(plain.total === withOpt.total, 'replay on leaves the normal total unchanged');
check(scoreRotation({ crops: ['corn'] }, real, [], {}, lib, { replayYear: 1900 }).replay === null, 'unknown replay year is ignored');

// Bare days per rotation.
const bd = (crops, f = real) => scoreRotation({ crops }, f, ['erosion'], {}, lib).bareDays;
const cotton2 = bd(['cotton', 'cotton']);
const covered = bd(['winter_wheat', 'cowpea', 'grain_sorghum', 'cereal_rye']);
const fallow2 = bd(['fallow', 'fallow']);
check(covered.bareDays < cotton2.bareDays, `bare days: cover-crop rotation (${covered.bareDays}) < continuous cotton (${cotton2.bareDays})`);
check(fallow2.bareDays > cotton2.bareDays && fallow2.bareDays > covered.bareDays, `bare days: fallow is worst (${fallow2.bareDays})`);
check(bd(['corn', 'cotton']).calibrated.length === 2, 'bare days: corn and cotton calibrated on nt-103 own record');
check(bd(['corn', 'cotton'], field).calibrated.length === 0, 'bare days: sample field has no own record, uses regional pattern');
check(bd(['winter_wheat', 'cereal_rye']).bareDays < bd(['winter_wheat']).bareDays, 'bare days: adding a cover crop never adds bare days');
const eroLow = scoreRotation({ crops: ['winter_wheat', 'cowpea', 'grain_sorghum', 'cereal_rye'] }, real, ['erosion'], {}, lib).breakdown.erosion.score;
const eroHigh = scoreRotation({ crops: ['cotton', 'cotton'] }, real, ['erosion'], {}, lib).breakdown.erosion.score;
check(eroLow > eroHigh, `erosion score follows bare days (${eroLow} vs ${eroHigh})`);

// Cover crops: risk line, and drought replays count them as half established.
const withCover = ['winter_wheat', 'cowpea', 'grain_sorghum', 'cereal_rye'];
const covR = (year) => scoreRotation({ crops: withCover }, real, ['erosion'], {}, lib, { replayYear: year });
check(covR(null).risks.some((r) => r.key === 'risks.coverEstablish'), 'cover-crop rotation carries the "assumes it establishes" risk');
check(!scoreRotation({ crops: ['corn', 'cotton'] }, real, [], {}, lib).risks.some((r) => r.key === 'risks.coverEstablish'), 'no cover crops, no cover risk');
check(covR(2011).replay.bareDays.bareDays > covR(null).bareDays.bareDays, `drought replay: cover crops half established (${covR(2011).replay.bareDays.bareDays} vs ${covR(null).bareDays.bareDays} bare days)`);
check(covR(2011).replay.coverPartial && !covR(2007).replay.coverPartial, 'half-established rule applies in drought years only');
check(covR(2007).replay.bareDays.bareDays === covR(null).bareDays.bareDays, 'wet-year replay leaves bare days unchanged');
check(scoreRotation({ crops: ['corn', 'cotton'] }, real, [], {}, lib, { replayYear: 2011 }).replay.coverPartial === false, 'no covers: nothing changes in a drought replay');
check(plain.gaps.some((g) => g.key === 'gaps.sensorChange'), 'sensor-change gap shown with bare-day numbers');

// Soil-health tags: drought-tolerant and pest-cycle break.
const tagsOf = (crops) => scoreRotation({ crops }, real, [], {}, lib).tags;
check(tagsOf(['sesame', 'cowpea']).includes('droughtTolerant'), 'tags: sesame/cowpea is drought-tolerant');
check(!tagsOf(['corn', 'winter_wheat']).includes('droughtTolerant'), 'tags: corn (drought-sensitive 4) is not drought-tolerant');
check(!tagsOf(['fallow']).includes('droughtTolerant'), 'tags: fallow alone is not drought-tolerant');
check(tagsOf(['sesame', 'winter_wheat', 'cowpea']).includes('pestBreak'), 'tags: sesame / wheat / cowpea breaks the pest cycle');
check(tagsOf(['grain_sorghum', 'cotton']).includes('pestBreak'), 'tags: sorghum then cotton alternates grass and mallow');
check(!tagsOf(['corn', 'corn']).includes('pestBreak'), 'tags: corn after corn is not a pest break');
check(!tagsOf(['corn', 'winter_wheat', 'grain_sorghum']).includes('pestBreak'), 'tags: all grasses is not a pest break');
check(!tagsOf(['cotton', 'cotton']).includes('pestBreak'), 'tags: cotton after cotton is not a pest break');
check(!tagsOf(['winter_wheat', 'cotton', 'cotton']).includes('pestBreak'), 'tags: back-to-back cotton inside a longer rotation fails');

process.exit(failed ? 1 : 0);
