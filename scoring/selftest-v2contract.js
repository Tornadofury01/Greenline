// Output contract checks: node scoring/selftest-v2contract.js
import { readFileSync } from 'node:fs';
import { validateFieldOutput, validateReportCard } from './v2Contract.js';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
let failed = 0;
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failed++; };

const cfg = load('../content/v2-scores.json');
const sample = load('../shared/v2-sample/sample-field.json');
const card = load('../shared/v2-sample/validation.json');
const bad = (mut) => { const c = structuredClone(sample); mut(c); return validateFieldOutput(c, cfg); };

check(validateFieldOutput(sample, cfg).length === 0, 'sample-field.json follows the output contract');
check(validateReportCard(card).length === 0, 'sample validation.json follows the report-card contract');
check(Math.abs(cfg.scores.reduce((a, s) => a + s.weight, 0) - 1) < 1e-9 && cfg.scores.length === 6, 'v2-scores.json: six scores, weights add to 1');
check(sample.options.length <= 30 && sample.current.kind === 'current', 'sample: at most 30 options plus current');
check(bad((c) => { delete c.options[0].scores.pests; }).length > 0, 'contract catches a missing score');
check(bad((c) => { c.options[0].fitChecks.water.status = 'maybe'; }).length > 0, 'contract catches a bad fit-check status');
check(bad((c) => { c.options[0].profit.returnAboveVariable.low = 999; }).length > 0, 'contract catches a profit range out of order');
check(bad((c) => { c.bestPlans.safest.optionId = 'nope'; }).length > 0, 'contract catches a best plan pointing at a missing option');
check(bad((c) => { c.slots.placeholderSlots = []; }).length > 0, 'contract catches placeholderSlots that disagree with sources');
check(bad((c) => { c.options[0].checkLocally = ['telepathy']; }).length > 0, 'contract catches an unknown check-locally id');
check(bad((c) => { c.current.profit.chanceBeatsCurrent = 0.5; }).length > 0, 'contract: current rotation has no chanceBeatsCurrent');

process.exit(failed ? 1 : 0);
