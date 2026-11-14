// One scored rotation. Glanceable on top (score, change vs. today, crops, badges);
// tap "Show details" for why, benefits, gaps, risks, scores by goal and data used.
import { useId, useState } from 'react';
import {
  Award, ChevronDown, ArrowUp, ArrowDown, Minus, ArrowRight, CircleCheck, CircleMinus,
  TriangleAlert, Lightbulb, Sprout, Layers, ArrowDownToLine, Shuffle, Database, BrainCircuit, CloudSun, Droplet, Bug, BookOpen, FlaskConical,
} from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { formatReason } from '../i18n.js';
import { PRIORITIES } from '@scoring/index.js';
import { topReasons } from '@scoring/confidence.js';
import { ConfidenceBadge, Receipt } from './Small.jsx';
import Verdict from './Verdict.jsx';
import CoverStrip from './CoverStrip.jsx';
import { DollarFace, DollarDetails } from './DollarBlock.jsx';
import GlossaryIcon from './GlossaryIcon.jsx';
import { cropInsight, cropDriverText, stressDriverText, modelSummary } from '../si.js';

const TAG_ICON = { nitrogen: Sprout, cover: Layers, deepRoots: ArrowDownToLine, diverse: Shuffle, droughtTolerant: Droplet, pestBreak: Bug };

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

// Confidence reasons: the icon follows the tone (adds / lowers / note), with a hidden label for screen readers.
const TONE = { up: { Icon: CircleCheck, cls: 'ok' }, down: { Icon: CircleMinus, cls: 'gap' }, note: { Icon: Lightbulb, cls: 'info' } };
function ToneList({ items, className = 'icon-list' }) {
  const { t } = useApp();
  return (
    <ul className={className}>
      {items.map((r, i) => {
        const tone = TONE[r.tone] ? r.tone : 'note';
        const { Icon, cls } = TONE[tone];
        return (
          <li key={i}>
            <Icon size={18} className={cls} aria-hidden="true" />
            <span><span className="sr-only">{t(`confidence.tone${tone[0].toUpperCase()}${tone.slice(1)}`)}: </span><Receipt src={r.src}>{formatReason(t, r)}</Receipt></span>
          </li>
        );
      })}
    </ul>
  );
}

// The headline number for erosion: estimated bare days a year, and how many this option removes (or adds) vs. today.
function BareBlock({ bare, delta }) {
  const { t } = useApp();
  if (!bare) return null;
  const dir = delta == null ? null : delta < 0 ? 'fewer' : delta > 0 ? 'more' : 'same';
  return (
    <div className="bare-block">
      <div className="bare-big">
        <span className="bare-num">{bare.bareDays}</span>
        <span className="bare-unit">{t('bareUi.unit')} <small>({t('bareUi.estimate')})</small></span>
      </div>
      {dir && <span className={`bare-delta ${dir}`}>{t(`bareUi.${dir}`, { n: Math.abs(delta) })}</span>}
    </div>
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
        <Receipt src={['Greenline SI models']}>{t('si.cardAccuracy', { acc: m.cropAcc, bal: m.cropBal, base: m.cropBase })}</Receipt>
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
                {x.beat && <span className="si-sub">{t('si.riskBeat', x.beat)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// On the card face during a replay: verdict, the year's score and how it differs from a normal year.
// When the score bottomed out at 0 (maxed), the verdict is already the headline: show why instead of numbers.
function ReplaySummary({ replay, normal, shown, maxed }) {
  const { t } = useApp();
  const diff = shown - normal;
  const dir = diff > 0 ? 'Up' : diff < 0 ? 'Down' : 'Same';
  if (maxed) return <div className="replay-sum"><span className="muted">{t('replayUi.maxedNote')}</span></div>;
  return (
    <div className="replay-sum">
      <Verdict verdict={replay.verdict} />
      <span>{replay.hypothetical
        ? t('whatIfUi.scoreLine', { score: Math.round(replay.score * 10) / 10 })
        : t('replayUi.scoreLine', { year: replay.year, score: Math.round(replay.score * 10) / 10 })}</span>
      <span className="muted">{diff === 0 ? t('replayUi.vsNormalSame') : t('replayUi.vsNormal', { n: Math.abs(diff), dir: t(`replayUi.dir${dir}`) })}</span>
    </div>
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

// Data used, plus the SI models' "what mattered most" reason, and a link to the plain-language explanations.
function EvidenceFooter({ result }) {
  const { t, field, openHow } = useApp();
  const datasets = field?.si ? [...result.evidence, 'Greenline SI models'] : result.evidence;
  const x = field?.si ? [...new Set(result.crops)].map((id) => cropInsight(field, id)).find((i) => i?.driver) : null;
  return (
    <div className="evidence">
      <p className="source">
        <Database size={14} aria-hidden="true" />
        <span>
          {t('compare.evidence')}:{' '}
          {datasets.map((d, i) => (
            <span key={d}>{i > 0 && ', '}<Receipt src={[d]}>{d}</Receipt></span>
          ))}
        </span>
      </p>
      {x && (
        <p className="source">
          <BrainCircuit size={14} aria-hidden="true" />
          <Receipt src={['Greenline SI models', 'Landsat 5/7/8/9']}>
            {t('si.evidenceWhy', { crop: t(`crops.${x.cropId}`), why: cropDriverText(t, x.driver) })}
          </Receipt>
        </p>
      )}
      <button type="button" className="btn-text" onClick={() => openHow()}>
        <BookOpen size={16} aria-hidden="true" />{t('how.link')}
      </button>
    </div>
  );
}

// open/onToggle are optional: pass them to control several cards together (desktop side-by-side view).
export default function RotationCard({ result, label, name, best = false, delta = null, bareDelta = null, defaultOpen = false, open: openProp, onToggle }) {
  const { t, replayYear, whatIf } = useApp();
  // A scenario (real replay year or what-if) is on: the card shows its numbers.
  const rp = (replayYear != null || whatIf) && result.replay ? result.replay : null;
  const scenarioTitle = rp && (rp.hypothetical ? t('whatIfUi.heading') : t('replayUi.heading', { year: rp.year }));
  const shown = rp ? result.replayTotal : result.total;
  // Extreme scenarios clamp the score to 0: lead with the verdict, keep the number in the details.
  const maxed = !!rp && shown === 0;
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
            {rp?.hypothetical && <span className="badge badge-hypo"><FlaskConical size={14} aria-hidden="true" />{t('whatIfUi.badge')}</span>}
            <h3>{name}</h3>
          </div>
          <div className="rot-score">
            {maxed
              ? <Verdict verdict={rp.verdict} maxed big />
              : <div className="rot-score-num">{shown}</div>}
            <div className="rot-score-of">{rp ? scenarioTitle : t('compare.outOf')}</div>
          </div>
        </div>
        <CropSteps crops={result.crops} />
        <BareBlock bare={rp?.bareDays ?? result.bareDays} delta={bareDelta} />
        <div className="badges">
          <ConfidenceBadge level={result.confidence.level} />
          {result.tags.map((tag) => {
            const Icon = TAG_ICON[tag];
            return <span key={tag} className="badge" title={t(`tags.explain.${tag}`)}><Icon size={14} aria-hidden="true" />{t(`tags.${tag}`)}</span>;
          })}
        </div>
        <ToneList items={topReasons(result.confidence)} className="icon-list conf-face" />
        <Delta value={delta} />
        {rp && <ReplaySummary replay={rp} normal={result.total} shown={shown} maxed={maxed} />}
        <TopReason crops={result.crops} />
        <DollarFace dollars={result.dollars} />
      </div>

      <button type="button" className="rot-toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
        {open ? t('compare.hideDetails') : t('compare.showDetails')}
        <ChevronDown size={20} aria-hidden="true" />
      </button>

      {open && (
        <div className="rot-details" id={detailsId}>
          {rp && (
            <section className="detail">
              <h4>{scenarioTitle}</h4>
              <p className="small">{t('replayUi.totalLine', { score: shown })} {shown === result.total ? t('replayUi.vsNormalSame') : t('replayUi.vsNormal', { n: Math.abs(shown - result.total), dir: t(`replayUi.dir${shown > result.total ? 'Up' : 'Down'}`) })}</p>
              <IconList items={rp.reasons} Icon={Lightbulb} tone="info" />
              {rp.coverPartial && <p className="muted small">{t('replayUi.coverRule')}</p>}
              <p className="muted small">{rp.hypothetical ? t('whatIfUi.note') : t('replayUi.note')}</p>
            </section>
          )}
          {result.tags.length > 0 && (
            <section className="detail">
              <h4>{t('tags.detailTitle')}</h4>
              <ul className="icon-list">
                {result.tags.map((tag) => {
                  const Icon = TAG_ICON[tag];
                  return (
                    <li key={tag}>
                      <Icon size={18} className="ok" aria-hidden="true" />
                      <span><strong>{t(`tags.${tag}`)}.</strong> {t(`tags.explain.${tag}`)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
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
            <h4>{t('bareUi.stripTitle')} <GlossaryIcon term="bareDays" /></h4>
            <CoverStrip months={(rp?.bareDays ?? result.bareDays).bareMonths} />
            <p className="muted small">
              <Receipt src={['Landsat 5/7/8/9', 'USDA Cropland Data Layer']}>
                {result.bareDays.calibrated.length
                  ? t('bareUi.calibrated', { crops: result.bareDays.calibrated.map((c) => t(`crops.${c.crop}`)).join(', ') })
                  : t('bareUi.regional')}
              </Receipt>
            </p>
            {result.bareDays.estimated.length > 0 && (
              <p className="muted small">{t('bareUi.estimatedFor', { crops: result.bareDays.estimated.map((id) => t(`crops.${id}`)).join(', ') })}</p>
            )}
            {result.crops.includes('fallow') && <p className="muted small">{t('bareUi.fallowNote')}</p>}
            {result.tags.includes('cover') && <p className="muted small">{t('bareUi.coverAssumption')}</p>}
            {rp?.coverPartial && <p className="muted small">{t('replayUi.coverRule')}</p>}
            <p className="muted small">{t('bareUi.caveat')}</p>
          </section>
          <DollarDetails dollars={result.dollars} />
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
            <ToneList items={result.confidence.reasons} />
          </section>
          <ModelInsights crops={result.crops} />
          <EvidenceFooter result={result} />
        </div>
      )}
    </article>
  );
}
