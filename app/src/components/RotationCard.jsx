// One scored rotation. Glanceable on top (score, change vs. today, crops, badges);
// tap "Show details" for why, benefits, gaps, risks, scores by goal and data used.
import { useId, useState } from 'react';
import {
  Award, ChevronDown, ArrowUp, ArrowDown, Minus, ArrowRight, CircleCheck, CircleMinus,
  TriangleAlert, Lightbulb, Sprout, Layers, ArrowDownToLine, Shuffle, Database, BrainCircuit, CloudSun,
} from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { formatReason } from '../i18n.js';
import { PRIORITIES } from '@scoring/index.js';
import { ConfidenceBadge, Receipt } from './Small.jsx';
import GlossaryIcon from './GlossaryIcon.jsx';
import { cropInsight, cropDriverText, stressDriverText, modelSummary } from '../si.js';

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
        <li key={i}><Icon size={18} className={tone} aria-hidden="true" /><Receipt src={r.src}>{formatReason(t, r)}</Receipt></li>
      ))}
    </ul>
  );
}

// One glanceable SHAP line on the card face: the first crop in the rotation the model has seen on this field.
function TopReason({ crops }) {
  const { t, field } = useApp();
  if (!field?.si) return null;
  const x = [...new Set(crops)].map((id) => cropInsight(field, id)).find((i) => i?.driver);
  if (!x) return null;
  return (
    <p className="si-top">
      <BrainCircuit size={16} aria-hidden="true" />
      <Receipt src={['Greenline SI models', 'Landsat 5/7/8/9']}>
        {t('si.topReason', { crop: t(`crops.${x.cropId}`), why: cropDriverText(t, x.driver) })}
      </Receipt>
    </p>
  );
}

// SI, visible: for each crop, how well the crop model recognised it on this field in years it never saw,
// the SHAP "what mattered most", and the weather risk signal only where it beat "always normal".
function ModelInsights({ crops }) {
  const { t, field } = useApp();
  const m = modelSummary(field);
  if (!m) return null;
  const ids = [...new Set(crops)].filter((id) => id !== 'fallow');
  return (
    <section className="detail">
      <h4><BrainCircuit size={18} aria-hidden="true" /> {t('si.cardTitle')} <GlossaryIcon term="heldOut" /></h4>
      <p className="muted small">
        <Receipt src={['Greenline SI models']}>{t('si.cardAccuracy', { acc: m.cropAcc, bal: m.cropBal })}</Receipt>
      </p>
      <ul className="icon-list">
        {ids.map((id) => {
          const x = cropInsight(field, id);
          const name = t(`crops.${id}`);
          if (!x?.hasModel) return <li key={id}><Lightbulb size={18} className="info" aria-hidden="true" /><span>{t('si.noModel', { crop: name })}</span></li>;
          return (
            <li key={id} className="si-crop">
              <Lightbulb size={18} className="info" aria-hidden="true" />
              <span>
                {x.years > 0
                  ? <Receipt src={['Greenline SI models', 'Landsat 5/7/8/9', 'USDA Cropland Data Layer']}>{t('si.recognized', { crop: name, n: x.recognized, of: x.years })}</Receipt>
                  : t('si.neverGrown', { crop: name })}
                {x.driver && <span className="si-why">{t('si.whyCrop', { year: x.driverYear, why: cropDriverText(t, x.driver) })}</span>}
                {x.recall != null && x.recall < 0.5 && <span className="si-warn">{t('si.hardToSee', { pct: Math.round(x.recall * 100) })}</span>}
                <span className="si-risk">
                  <CloudSun size={16} aria-hidden="true" />
                  {x.signalAllowed
                    ? (x.seasons > 0
                      ? <Receipt src={['Greenline SI models', 'SMAP L4', 'NASA POWER', 'GPM IMERG']}>
                          {t('si.riskSignal', { n: x.flagged, of: x.seasons })}
                          {x.stressDriver && ` ${t('si.whyStress', { year: x.stressYear, why: stressDriverText(t, x.stressDriver) })}`}
                        </Receipt>
                      : t('si.riskNoSeasons'))
                    : t('si.riskNotForCrop')}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
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
        <TopReason crops={result.crops} />
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
          <ModelInsights crops={result.crops} />
          <div className="source">
            <Database size={14} aria-hidden="true" />
            <span>
              {t('compare.evidence')}:{' '}
              {result.evidence.map((d, i) => (
                <span key={d}>{i > 0 && ', '}<Receipt src={[d]}>{d}</Receipt></span>
              ))}
            </span>
          </div>
        </div>
      )}
    </article>
  );
}
