// Screen 4: current rotation vs 2 suggestions, plus "build my own" scored the same way.
import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { useScores } from '../state/useScores.js';
import RotationCard from '../components/RotationCard.jsx';
import RotationPicker from '../components/RotationPicker.jsx';
import { NeedField, JudgmentNote } from '../components/Small.jsx';
// import WhatIfSliders from '../components/future/WhatIfSliders.jsx'; // FUTURE

export default function CompareRotations() {
  const { t, field, setScreen } = useApp();
  const scores = useScores();
  const [custom, setCustom] = useState([]);
  const [customResult, setCustomResult] = useState(null);

  if (!field) return <div className="screen"><NeedField /></div>;

  return (
    <div className="screen">
      <h1>{t('compare.title')}</h1>
      <JudgmentNote />

      {scores.current ? (
        <RotationCard result={scores.current} kind="current" title={scores.current.crops.map((id) => t(`crops.${id}`)).join(", ")} />
      ) : (
        <div className="notice">
          <p>{t('compare.noCurrent')}</p>
          <button className="btn" onClick={() => setScreen('farm')}>{t('nav.farm')}</button>
        </div>
      )}
      {scores.suggested.map((r) => <RotationCard key={r.rotationId} result={r} kind="suggested" />)}

      <section className="card">
        <h2>{t('compare.buildOwn')}</h2>
        <p className="hint">{t('compare.buildHint')}</p>
        <RotationPicker value={custom} onChange={(v) => { setCustom(v); setCustomResult(null); }} />
        <button className="btn primary wide" disabled={!custom.length} onClick={() => setCustomResult(scores.scoreCustom(custom))}>
          {t('compare.scoreIt')}
        </button>
      </section>
      {customResult && <RotationCard result={customResult} kind="custom" title={t('compare.custom')} defaultOpen />}
    </div>
  );
}
