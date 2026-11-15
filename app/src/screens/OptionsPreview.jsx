// TEMPORARY, dev only (open http://localhost:5173/#options-preview). Invented numbers to check the Options layout.
// Delete this file, its lazy import in App.jsx and the `optionsScreen.preview` keys once the loader feeds Options.
import Options from './Options.jsx';

const ev = (k, params = {}) => ({ key: `optionsScreen.preview.ev.${k}`, params });
const why = (k, params = {}) => ({ key: `optionsScreen.preview.conf.${k}`, params });
const scores = (a) => ['profit', 'risk', 'soil', 'water', 'nitrogen', 'carbon'].map((id, i) => ({ id, value: a[i] }));

const CURRENT = {
  id: 'current', kind: 'current', crops: ['cotton', 'corn', 'grain_sorghum'],
  grade: 'D', total: 31, scores: scores([48, 35, 22, 30, 28, 24]),
  fit: [
    { id: 'water', status: 'warn', evidence: ev('waterWarn', { n: 7, total: 40 }) },
    { id: 'disease', status: 'warn', evidence: ev('diseaseWarn') },
    { id: 'market', status: 'pass', evidence: ev('marketPass') },
    { id: 'season', status: 'pass', evidence: ev('seasonPass') },
  ],
  profit: { low: 20, typical: 55, high: 95, beatsCurrent: null },
  confidence: { level: 'medium', reason: why('medium') },
  checkLocally: ['buyers', 'pests', 'quirks'],
};

const A = {
  id: 'a', kind: 'option', letter: 'A', best: true, crops: ['winter_wheat', 'cowpea', 'grain_sorghum', 'cereal_rye'],
  grade: 'A', total: 80, deltaTotal: 49, scores: scores([62, 74, 88, 79, 85, 83]),
  fit: [
    { id: 'water', status: 'pass', evidence: ev('waterPass', { n: 2, total: 40 }), placeholder: true },
    { id: 'disease', status: 'pass', evidence: ev('diseasePass') },
    { id: 'market', status: 'warn', evidence: ev('marketWarn', { crop: 'cowpea' }) },
    { id: 'season', status: 'warn', evidence: ev('seasonWarn') },
  ],
  profit: { low: 60, typical: 95, high: 130, beatsCurrent: 0.87, placeholder: true },
  soilSaved: { value: 3.2, placeholder: true }, nitrogenSaved: { value: 42 },
  confidence: { level: 'high', reason: why('high', { pct: 87 }) },
  checkLocally: ['legumeN', 'coverEstablishment', 'seedPrice', 'buyers', 'equipment', 'pests', 'costShare'],
};

const B = {
  id: 'b', kind: 'option', letter: 'B', crops: ['winter_wheat', 'sorghum_sudangrass', 'cereal_rye', 'grain_sorghum'],
  grade: 'B', total: 64, deltaTotal: 33, scores: scores([71, 52, 70, 58, 44, 66]),
  fit: [
    { id: 'water', status: 'warn', evidence: ev('waterWarn', { n: 6, total: 40 }) },
    { id: 'disease', status: 'fail', evidence: ev('diseaseFail', { crop: 'rye' }) },
    { id: 'market', status: 'pass', evidence: ev('marketPass') },
    { id: 'season', status: 'pass', evidence: ev('seasonPass') },
  ],
  profit: { low: 35, typical: 78, high: 140, beatsCurrent: 0.64 },
  soilSaved: { value: 1.1 }, nitrogenSaved: { value: 0 },
  confidence: { level: 'low', reason: why('low', { pct: 64 }) },
  checkLocally: ['coverEstablishment', 'equipment', 'water'],
};

export default function OptionsPreview() {
  return <Options sample current={CURRENT} options={[A, B]} />;
}
