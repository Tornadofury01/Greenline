// Quick sanity check: node scoring/selftest.js
import { readFileSync } from 'node:fs';
import { scoreRotation, suggestRotations } from './index.js';
import { priorityWeight } from './scoreRotation.js';
import { weightsFor } from './v2/scores.js';
import { topReasons, estimatedTraits } from './confidence.js';
import { yearHazards, hazardsFromRow } from './rules/replay.js';

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

// Bad-year replay on a real field (ec-251) in the 2011 drought.
const real = load('../shared/fields/ec-251.json');
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
check(bd(['corn', 'cotton']).calibrated.length === 2, 'bare days: corn and cotton calibrated on ec-251 own record');
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
// Landsat 8/9 only: field calibration reads coverYearlyL89 when the file has it (Landsat 7 reads NDVI lower).
{
  const noL89 = { ...real, coverYearlyL89: real.coverYearlyL89.map((r) => ({ ...r, months: r.months.map(() => 'bare') })) };
  check(bd(['corn', 'cotton'], noL89).bareDays > bd(['corn', 'cotton']).bareDays, 'bare days: field calibration reads coverYearlyL89');
  const lib89 = load('../shared/crop-calendars-l89.json');
  check(lib.crops.find((c) => c.id === 'corn').bareShare.every((p, m) => Math.abs(p - lib89.crops.corn.bareShare[m]) < 0.006), 'corn calendar = shared/crop-calendars-l89.json');
}

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

// Confidence: every reason has a tone, estimated traits cost a point, top-2 reasons for the card face.
const confOf = (crops, f = real) => scoreRotation({ crops }, f, [], {}, lib).confidence;
const basic = confOf(['winter_wheat', 'corn']);
check(basic.reasons.length > 0 && basic.reasons.every((r) => ['up', 'down', 'note'].includes(r.tone)), 'confidence: every reason has a tone (up / down / note)');
check(basic.reasons.some((r) => r.key === 'confidence.resolution' && r.params.fine === '30 m'), 'confidence: resolution reason names the real 30 m / ~11 km / ~50 km');
const vetch = confOf(['hairy_vetch', 'cotton']);
check(vetch.reasons.some((r) => r.key === 'confidence.traitsEstimated' && r.params.crops.includes('hairy_vetch')), 'confidence: hairy vetch (estimated drought sensitivity) is flagged');
check(!basic.reasons.some((r) => r.key === 'confidence.traitsEstimated'), 'confidence: wheat / corn have no estimated scored traits');
check(estimatedTraits(lib.crops.find((c) => c.id === 'alfalfa')).includes('nFixLbPerAcre'), 'confidence: alfalfa unknown nitrogen counts as an estimate');
check(topReasons(basic).length === 2 && topReasons(basic).every((r) => r.tone), 'confidence: two top reasons for the card face');
check(topReasons({ reasons: [{ tone: 'up', key: 'a' }, { tone: 'down', key: 'b' }, { tone: 'up', key: 'c' }] }).map((r) => r.key).join() === 'b,a', 'confidence: top reasons = one lowering, one adding');
check(confOf(['corn'], field).reasons.every((r) => r.tone), 'confidence: sample field (no SI) also has tones');
check(basic.reasons.some((r) => r.key === 'confidence.prism.agreesLower' && r.params.name === 'NASA POWER'), 'confidence: ec-251 shows POWER vs PRISM agreement (real data)');
check(basic.reasons.some((r) => r.key.startsWith('confidence.prism.') && r.params.name === 'GPM IMERG'), 'confidence: ec-251 shows IMERG vs PRISM agreement');
const noPrism = { ...real, quality: { ...real.quality, rainVsPrism: null } };
check(!confOf(['corn'], noPrism).reasons.some((r) => r.key.startsWith('confidence.prism')), 'confidence: no PRISM reason when the data is absent');
check(confOf(['corn'], noPrism).points === confOf(['corn']).points, 'confidence: PRISM adds no points');

// Dollars: display only, from real NASS data.
const econ = load('../content/economics.json');
const dollarsOf = (crops, f = real) => scoreRotation({ crops }, f, ['water'], dry, lib, { economics: econ });
for (const crops of [['corn', 'cotton'], ['winter_wheat', 'cowpea', 'grain_sorghum', 'cereal_rye'], ['sesame', 'winter_wheat', 'cowpea']]) {
  const a = scoreRotation({ crops }, real, ['water'], dry, lib);
  const b = dollarsOf(crops);
  check(a.total === b.total && JSON.stringify(a.breakdown) === JSON.stringify(b.breakdown), `dollars never change the score (${crops.join('/')})`);
}
check(plain.dollars === null, 'dollars: off unless economics is passed');
const cc = dollarsOf(['corn', 'cotton']).dollars;
check(cc.grossPerAcreYear === Math.round((451 + 444) / 2), `dollars: corn/cotton gross per acre-year from Ellis County NASS (${cc.grossPerAcreYear})`);
check(cc.fertilizer === null, 'dollars: no fertilizer value without nitrogen fixers (corn/cotton)');
check(dollarsOf(['winter_wheat', 'grain_sorghum']).dollars.fertilizer === null, 'dollars: no fertilizer value for wheat/sorghum');
const cow = dollarsOf(['winter_wheat', 'cowpea', 'grain_sorghum', 'cereal_rye']).dollars;
check(cow.fertilizer?.lo > 0 && cow.fertilizer.hi >= cow.fertilizer.lo, `dollars: cowpea adds fertilizer value (${cow.fertilizer?.lo}-${cow.fertilizer?.hi} $/acre/yr)`);
check(dollarsOf(['hairy_vetch', 'cotton']).dollars.fertilizer?.lo > 0, 'dollars: hairy vetch adds fertilizer value');
check(cow.byCrop.find((d) => d.crop === 'cereal_rye').status === 'cover' && cow.years === 2, 'dollars: cover crops are not sold and ride along with a cash-crop year');
check(cow.byCrop.find((d) => d.crop === 'grain_sorghum').yieldLevel === 'state' && cow.levels.includes('state'), 'dollars: state-level sorghum yield is flagged');
const alf = dollarsOf(['alfalfa']).dollars;
check(alf.nUnknown.includes('alfalfa') && alf.fertilizer === null && alf.byCrop[0].status === 'priceOnly', 'dollars: alfalfa nitrogen "not known yet", hay price only');
const ses = dollarsOf(['sesame', 'winter_wheat', 'cowpea']).dollars;
check(ses.byCrop.find((d) => d.crop === 'sesame').status === 'noData' && ses.pricedYears === 1 && ses.years === 2, 'dollars: sesame has no NASS data, only priced years are averaged');
check(dollarsOf(['corn'], field).dollars === null, 'dollars: sample field without market data shows none');

// What-if sliders: the same replay path with a pretend year.
const wi = (crops, whatIf) => scoreRotation({ crops }, real, ['water'], dry, lib, { whatIf });
const rot = ['winter_wheat', 'grain_sorghum', 'cotton'];
const normal = scoreRotation({ crops: rot }, real, ['water'], dry, lib);
const dry40 = wi(rot, { rainPct: -0.4, heatDays: 0 });
check(dry40.replay.hypothetical && dry40.replayTotal <= normal.total, `what-if -40% rain scores <= normal (${dry40.replayTotal} vs ${normal.total})`);
check(dry40.replay.yearType === 'drought', 'what-if -40% rain counts as a drought year (cover-crop rule applies)');
const zero = wi(rot, { rainPct: 0, heatDays: 0 });
const mildYear = real.climateYearly.filter((y) => y.year >= 2008).map((y) => ({ y, h: yearHazards(real, y.year) }))
  .sort((a, b) => (a.h.drought + a.h.heat + a.h.wet) - (b.h.drought + b.h.heat + b.h.wet))[0].y.year;
const mild = replayOf(rot, mildYear);
check(Math.abs(zero.replay.score - mild.replay.score) <= 1, `what-if 0/0 (${zero.replay.score.toFixed(1)}) is close to the mildest year ${mildYear} (${mild.replay.score.toFixed(1)})`);
check(wi(rot, { rainPct: 0, heatDays: 30 }).replayTotal < zero.replayTotal, 'what-if: +30 hot days scores lower than 0/0');
check(JSON.stringify(hazardsFromRow(real, real.climateYearly.find((y) => y.year === 2011))) === JSON.stringify(yearHazards(real, 2011)), 'hazardsFromRow is what yearHazards uses');
const both = scoreRotation({ crops: rot }, real, ['water'], dry, lib, { replayYear: 2011, whatIf: { rainPct: 0.5, heatDays: 0 } });
check(both.replay.year === 2011 && !both.replay.hypothetical, 'replay year wins if both are passed (one scenario at a time)');
check(dry40.total === normal.total, 'what-if leaves the normal total unchanged');
check(zero.replayTotal === normal.total, `what-if 0/0 total equals the normal total (${zero.replayTotal})`);
check(rotations.every((r) => { const x = scoreRotation(r, real, ['water'], dry, lib, { replayYear: 2011 }); return x.replayTotal <= x.total; }),
  'no rotation scores higher in the 2011 drought than in a normal year');

// Soil: K x slope and soil water storage show up as reasons.
check(normal.breakdown.water.reasons.some((r) => r.key === 'reasons.soilStore.high'), 'water rule: ec-251 Houston Black clay holds a lot of water');
const ero = scoreRotation({ crops: rot }, real, ['erosion'], dry, lib).breakdown.erosion.reasons;
check(ero.some((r) => r.key === 'reasons.erodible' && r.params.k === 0.24), 'erosion rule: K x slope reason on ec-251');

// Ranked priorities: the 1st counts most, later ones less, unpicked ones the base weight; one or no priority is unchanged.
const v2cfg = load('../content/v2-scores.json');
const wNone = weightsFor([], v2cfg), wWater = weightsFor(['saveWater'], v2cfg);
const wWS = weightsFor(['saveWater', 'soil'], v2cfg), wSW = weightsFor(['soil', 'saveWater'], v2cfg);
check(wWS.water > wSW.water && wSW.soil > wWS.soil, 'v2 weights: the same two priorities in a different order give the 1st one more weight');
check(Math.abs(Object.values(wWS).reduce((a, b) => a + b, 0) - 1) < 1e-3, 'v2 weights still add up to 1 with ranked priorities');
check(wWater.water > wNone.water && Math.abs(weightsFor(['saveWater'], { ...v2cfg, rankStrength: undefined }).water - wWater.water) < 1e-9,
  'v2 weights: a single priority gets its full boost, as before ranking');
check(priorityWeight(['water', 'soil'], 'water') === 2 && priorityWeight(['water', 'soil'], 'soil') === 1.6 && priorityWeight(['water', 'soil'], 'income') === 1,
  'v1 weights: 1st priority x2, 2nd x1.6, unpicked x1');
const ranked = scoreRotation({ crops: rot }, real, ['water', 'erosion'], dry, lib).breakdown;
check(ranked.water.rank === 1 && ranked.erosion.rank === 2 && ranked.income.rank === null && ranked.water.weight > ranked.erosion.weight,
  'v1 breakdown carries the rank of each priority, and the 1st outweighs the 2nd');

process.exit(failed ? 1 : 0);
