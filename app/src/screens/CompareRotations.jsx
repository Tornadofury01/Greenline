// Screen 4: compare at a glance, then one card per rotation. The best match is clearly marked.
// "Build my own" is scored by the same scoreRotation() function.
import { useEffect, useState } from 'react';
import { Award, Tractor } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { useScores } from '../state/useScores.js';
import RotationCard from '../components/RotationCard.jsx';
import RotationPicker from '../components/RotationPicker.jsx';
import { NeedField, JudgmentNote, PageHead } from '../components/Small.jsx';
// import WhatIfSliders from '../components/future/WhatIfSliders.jsx'; // FUTURE

// True on desktop, where rotation cards sit side by side.
function useWide(query = '(min-width: 1024px)') {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return wide;
}

export default function CompareRotations() {
  const { t, field, setScreen } = useApp();
  const scores = useScores();
  const [custom, setCustom] = useState([]);
  const [customResult, setCustomResult] = useState(null);
  // Desktop: one toggle opens all side-by-side cards so details line up for comparison.
  const wide = useWide();
  const [allOpen, setAllOpen] = useState(false);
  const shared = wide ? { open: allOpen, onToggle: setAllOpen } : {};

  if (!field) return <div className="screen"><NeedField /></div>;

  const cropNames = (r) => r.crops.map((id) => t(`crops.${id}`)).join(', ');
  const options = scores.suggested.map((r, i) => ({
    key: r.rotationId,
    result: r,
    label: t('compare.option', { letter: t(`compare.letters.${i}`) }),
    name: t(`rotations.${r.rotationId}`),
  }));
  const current = scores.current && { key: 'current', result: scores.current, label: t('compare.current'), name: cropNames(scores.current) };
  // "Best match" = top suggestion, only if it beats what the farmer grows now.
  const bestKey = options[0] && (!current || options[0].result.total > current.result.total) ? options[0].key : null;
  const rows = [current, ...options].filter(Boolean);
  const delta = (r) => (current ? r.total - current.result.total : null);

  return (
    <div className="screen">
      <PageHead title={t('compare.title')} intro={t('compare.intro')} />

      <section className="card" aria-labelledby="glance-title">
        <h2 id="glance-title">{t('compare.glance')}</h2>
        <div className="glance">
          {rows.map((r) => (
            <div key={r.key} className={`glance-row ${r.key === bestKey ? 'is-best' : ''}`}>
              <span className="glance-name">
                {r.key === bestKey && <Award size={18} color="var(--color-primary)" aria-label={t('compare.bestMatch')} />}
                {r.label}
              </span>
              <span className="glance-score">{r.result.total}</span>
              <span className="glance-bar" aria-hidden="true"><span style={{ width: `${r.result.total}%` }} /></span>
            </div>
          ))}
        </div>
        <p className="hint">{t('compare.glanceHint')}</p>
      </section>

      {!current && (
        <div className="notice">
          <Tractor size={20} aria-hidden="true" />
          <div className="notice-body">
            <p>{t('compare.noCurrent')}</p>
            <button type="button" className="btn" onClick={() => setScreen('farm')}>{t('compare.goFarm')}</button>
          </div>
        </div>
      )}

      <div className="rot-grid">
      {options.filter((o) => o.key === bestKey).map((o) => (
        <RotationCard key={o.key} result={o.result} label={o.label} name={o.name} best delta={delta(o.result)} {...shared} />
      ))}
      {current && <RotationCard result={current.result} label={current.label} name={current.name} {...shared} />}
      {options.filter((o) => o.key !== bestKey).map((o) => (
        <RotationCard key={o.key} result={o.result} label={o.label} name={o.name} delta={delta(o.result)} {...shared} />
      ))}
      </div>

      <JudgmentNote />

      <div className="split split-build">
      <section className="card">
        <div className="field-group">
          <h2>{t('compare.buildOwn')}</h2>
          <p className="hint">{t('compare.buildHint')}</p>
        </div>
        <RotationPicker label={t('compare.buildOwn')} value={custom} onChange={(v) => { setCustom(v); setCustomResult(null); }} />
        <button type="button" className="btn btn-primary btn-block" disabled={!custom.length} onClick={() => setCustomResult(scores.scoreCustom(custom))}>
          {t('compare.scoreIt')}
        </button>
      </section>
      {customResult && (
        <RotationCard result={customResult} label={t('compare.custom')} name={cropNames(customResult)} delta={delta(customResult)} defaultOpen />
      )}
      </div>
    </div>
  );
}
