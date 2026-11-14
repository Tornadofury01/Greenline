// One scored rotation. Glanceable on top (score, change vs. today, crops, badges);
// tap "Show details" for why, benefits, gaps, risks, scores by goal and data used.
import { useId, useState } from 'react';
import {
  Award, ChevronDown, ArrowUp, ArrowDown, Minus, ArrowRight, CircleCheck, CircleMinus,
  TriangleAlert, Lightbulb, Sprout, Layers, ArrowDownToLine, Shuffle, Database,
} from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { formatReason } from '../i18n.js';
import { PRIORITIES } from '@scoring/index.js';
import { ConfidenceBadge } from './Small.jsx';
import GlossaryIcon from './GlossaryIcon.jsx';

const TAG_ICON = { nitrogen: Sprout, cover: Layers, deepRoots: ArrowDownToLine, diverse: Shuffle };

export function CropSteps({ crops }) {
  const { t } = useApp();
  return (
    <ol className="steps">
      {crops.map((id, i) => (
        <li key={`${id}-${i}`}>
          {i > 0 && <ArrowRight size={16} className="step-arrow" aria-hidden="true" />}
          <span className="step-crop"><span className="step-n" aria-hidden="true">{i + 1}</span>{t(`crops.${id}`)}</span>
        </li>
      ))}
    </ol>
  );
}

function IconList({ items, Icon, tone }) {
  const { t } = useApp();
  if (!items.length) return <p className="muted">{t('compare.none')}</p>;
  return (
    <ul className="icon-list">
      {items.map((r, i) => (
        <li key={i}><Icon size={18} className={tone} aria-hidden="true" /><span>{formatReason(t, r)}</span></li>
      ))}
    </ul>
  );
}

function Delta({ value }) {
  const { t } = useApp();
  if (value == null) return null;
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'same';
  const Icon = { up: ArrowUp, down: ArrowDown, same: Minus }[dir];
  return (
    <span className={`rot-delta ${dir}`}>
      <Icon size={14} strokeWidth={2.5} aria-hidden="true" />
      {t(`compare.delta.${dir}`, { n: Math.abs(value) })}
    </span>
  );
}

// open/onToggle are optional: pass them to control several cards together (desktop side-by-side view).
export default function RotationCard({ result, label, name, best = false, delta = null, defaultOpen = false, open: openProp, onToggle }) {
  const { t } = useApp();
  const [openOwn, setOpenOwn] = useState(defaultOpen);
  const open = openProp ?? openOwn;
  const setOpen = onToggle ?? setOpenOwn;
  const detailsId = useId();

  return (
    <article className={`rot ${best ? 'is-best' : ''}`} aria-label={`${label}: ${name}`}>
      {best && (
        <div className="rot-best-bar">
          <Award size={16} aria-hidden="true" />{t('compare.bestMatch')}
        </div>
      )}
      <div className="rot-main">
        <div className="rot-top">
          <div>
            <div className="rot-label">{label}</div>
            <h3>{name}</h3>
          </div>
          <div className="rot-score">
            <div className="rot-score-num">{result.total}</div>
            <div className="rot-score-of">{t('compare.outOf')}</div>
          </div>
        </div>
        <CropSteps crops={result.crops} />
        <div className="badges">
          <ConfidenceBadge level={result.confidence.level} />
          {result.tags.map((tag) => {
            const Icon = TAG_ICON[tag];
            return <span key={tag} className="badge"><Icon size={14} aria-hidden="true" />{t(`tags.${tag}`)}</span>;
          })}
        </div>
        <Delta value={delta} />
      </div>

      <button type="button" className="rot-toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
        {open ? t('compare.hideDetails') : t('compare.showDetails')}
        <ChevronDown size={20} aria-hidden="true" />
      </button>

      {open && (
        <div className="rot-details" id={detailsId}>
          <section className="detail">
            <h4>{t('compare.why')}</h4>
            <IconList items={result.reasons} Icon={Lightbulb} tone="info" />
          </section>
          <section className="detail">
            <h4>{t('compare.benefits')}</h4>
            <IconList items={result.benefits} Icon={CircleCheck} tone="ok" />
          </section>
          <section className="detail">
            <h4>{t('compare.gaps')}</h4>
            <IconList items={result.gaps} Icon={CircleMinus} tone="gap" />
          </section>
          <section className="detail">
            <h4>{t('compare.risks')}</h4>
            <IconList items={result.risks} Icon={TriangleAlert} tone="risk" />
          </section>
          <section className="detail">
            <h4>{t('compare.breakdown')} <GlossaryIcon term="score" /></h4>
            {PRIORITIES.map((p) => {
              const b = result.breakdown[p];
              return (
                <div key={p} className="meter-row">
                  <span className="meter-label">
                    {t(`priorities.${p}`)}
                    {b.selected && <small>{t('compare.picked')}</small>}
                  </span>
                  <span className="meter" role="img" aria-label={t('compare.meterLabel', { n: b.score })}>
                    <span style={{ width: `${b.score * 10}%` }} />
                  </span>
                  <span className="meter-num">{b.score}</span>
                </div>
              );
            })}
          </section>
          <section className="detail">
            <h4>{t('compare.confidenceWhy')} <GlossaryIcon term="confidence" /></h4>
            <IconList items={result.confidence.reasons} Icon={CircleCheck} tone="info" />
          </section>
          <p className="source">
            <Database size={14} aria-hidden="true" />
            <span>{t('compare.evidence')}: {result.evidence.join(', ')}</span>
          </p>
        </div>
      )}
    </article>
  );
}
