// One scored rotation. Tap to open details: why, evidence, benefits, gaps, risks.
import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { formatReason } from '../i18n.js';
import { PRIORITIES } from '@scoring/index.js';
import { ConfidencePill } from './Small.jsx';
import GlossaryIcon from './GlossaryIcon.jsx';

function ReasonList({ items }) {
  const { t } = useApp();
  if (!items.length) return <p className="muted">{t('compare.none')}</p>;
  return <ul>{items.map((r, i) => <li key={i}>{formatReason(t, r)}</li>)}</ul>;
}

export default function RotationCard({ result, kind, title, defaultOpen = false }) {
  const { t } = useApp();
  const [open, setOpen] = useState(defaultOpen);
  const name = title || (result.rotationId ? t(`rotations.${result.rotationId}`) : '');

  return (
    <article className={`rotation-card kind-${kind}`}>
      <button type="button" className="card-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <div className="card-kind">{t(`compare.${kind}`)}</div>
        <div className="card-title-row">
          <h3>{name}</h3>
          <div className="score" aria-label={`${t('compare.score')} ${result.total} ${t('common.outOf100')}`}>
            <span className="score-num">{result.total}</span>
            <span className="score-of">/100</span>
          </div>
        </div>
        <div className="card-crops">{result.crops.map((id) => t(`crops.${id}`)).join(' → ')}</div>
        <div className="tags">
          {result.tags.map((tag) => <span key={tag} className="tag">{t(`tags.${tag}`)}</span>)}
          <ConfidencePill level={result.confidence.level} />
        </div>
        <div className="card-more">{open ? t('compare.hideDetails') : t('compare.tapForDetails')}</div>
      </button>

      {open && (
        <div className="card-body">
          <section>
            <h4>{t('compare.breakdown')} <GlossaryIcon term="score" /></h4>
            {PRIORITIES.map((p) => (
              <div key={p} className="bar-row">
                <span className="bar-label">
                  {t(`priorities.${p}`)}
                  {result.breakdown[p].selected && <em> · {t('compare.picked')}</em>}
                </span>
                <span className="bar"><span style={{ width: `${result.breakdown[p].score * 10}%` }} /></span>
                <span className="bar-num">{result.breakdown[p].score}</span>
              </div>
            ))}
          </section>
          <section><h4>{t('compare.why')}</h4><ReasonList items={result.reasons} /></section>
          <section>
            <h4>{t('compare.evidence')}</h4>
            <ul className="evidence">{result.evidence.map((d) => <li key={d}>{d}</li>)}</ul>
          </section>
          <section><h4>{t('compare.benefits')}</h4><ReasonList items={result.benefits} /></section>
          <section><h4>{t('compare.gaps')}</h4><ReasonList items={result.gaps} /></section>
          <section><h4>{t('compare.risks')}</h4><ReasonList items={result.risks} /></section>
          <section>
            <h4>{t('compare.confidenceWhy')} <GlossaryIcon term="confidence" /></h4>
            <ReasonList items={result.confidence.reasons} />
          </section>
        </div>
      )}
    </article>
  );
}
