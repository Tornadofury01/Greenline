// One decision page: existing v2 recommendations in the original Compare card layout.
import { useMemo, useState } from 'react';
import { Award, ArrowRight, ChevronDown, Droplet, Layers, Lightbulb, Gamepad2 } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { buildMergedPlans, fitReason, eligibleAlternative, supportedReturn } from '../data/mergedPlans.js';
import { buildOptionCards } from '../data/v2Options.js';
import { makeV2Text } from '../data/v2Text.js';
import { Steps, ScoreGrid, FitChecks, ConfidenceNotes } from '../components/OptionCard.jsx';
import { ConfidenceBadge, PageHead } from '../components/Small.jsx';
import { SampleBanner, PlaceholderPanel } from '../components/PlaceholderTag.jsx';
import V2Gate from '../components/V2Gate.jsx';
import { setPlayPlan } from '../game/playPlan.js';

// Management choices as label + value rows. An enum value we have no text for shows as it came, never blank.
function Management({ plan }) {
  const { t } = useApp();
  const m = plan.management;
  const pick = (group, v) => { const k = `plansScreen.mgmt.${group}.${v}`; const s = t(k); return s === k ? String(v) : s; };
  const rows = [
    ['plantingDate', m.plantingDate != null && pick('plantingDate', m.plantingDate)],
    ['nitrogen', m.nitrogenLbPerAcre != null && (m.nitrogenLbPerAcre === 0 ? t('plansScreen.mgmt.nitrogen.none') : t('plansScreen.mgmt.nitrogen.rate', { lb: m.nitrogenLbPerAcre }))],
    ['maturity', m.maturity != null && pick('maturity', m.maturity)],
    ['cover', plan.hasCover ? m.coverTermination != null && pick('cover', m.coverTermination) : t('plansScreen.mgmt.cover.none')],
    ['doubleCrop', m.doubleCrop != null && t(`plansScreen.mgmt.doubleCrop.${m.doubleCrop ? 'yes' : 'no'}`)],
    ['tillage', m.tillage != null && pick('tillage', m.tillage)],
    ['irrigation', m.irrigation != null && pick('irrigation', m.irrigation)],
  ].filter(([, v]) => v);
  return (
    <section>
      <h3 className="group-head">{t('plansScreen.mgmtTitle')}</h3>
      <dl className="mgmt-list">
        {rows.map(([id, v]) => (
          <div key={id} className="mgmt-row"><dt>{t(`plansScreen.mgmt.label.${id}`)}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </section>
  );
}

function ReturnValue({ strategy, compact = false }) {
  const { t, lang } = useApp();
  const money = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const value = strategy.returns;
  return <div className="tile plan-return">
    <span className="tile-label">{t('mergedPlans.returnLabel')}</span>
    <strong className="tile-value">{value ? money.format(value.typical) : t('mergedPlans.unavailable')}</strong>
    <span className="tile-unit">{t('mergedPlans.perAcreYear')}</span>
    {!compact && value?.low != null && <span className="tile-note">{t('mergedPlans.range', { low: money.format(value.low), high: money.format(value.high) })}</span>}
    <span className="tile-note plan-number-note">{t(strategy.card.profit.placeholder ? 'mergedPlans.placeholderReturn' : 'mergedPlans.returnNote')}</span>
  </div>;
}

function Measures({ strategy, showWater, showCover }) {
  const { t } = useApp();
  const share = strategy.option.fitChecks?.water?.evidence?.params?.shortYears;
  const days = strategy.option.soilSaved?.bareDaysPerYear;
  if (!showWater && !showCover) return null;
  return <div className={`tiles plan-measures${showWater && showCover ? '' : ' single-measure'}`}>
    {showWater && <div className="tile"><span className="tile-label"><Droplet size={15} aria-hidden="true" />{t('mergedPlans.waterLabel')}</span>
      <strong className="tile-value">{Number.isFinite(share) ? `${Math.round(share * 100)}%` : t('mergedPlans.unavailable')}</strong><span className="tile-note">{t('mergedPlans.waterUnit')}</span>
    </div>}
    {showCover && <div className="tile"><span className="tile-label"><Layers size={15} aria-hidden="true" />{t('mergedPlans.coverLabel')}</span>
      <strong className="tile-value">{Number.isFinite(days) ? Math.round(days) : t('mergedPlans.unavailable')}</strong><span className="tile-note">{t('mergedPlans.coverUnit')}</span>
    </div>}
    <p className="plan-measure-note small muted">{t(strategy.card.scores.some((s) => ['water', 'soil'].includes(s.id) && s.placeholder) ? 'mergedPlans.placeholderMeasures' : 'mergedPlans.simulatedMeasures')}</p>
  </div>;
}

function Reason({ strategy, data }) {
  const { t, lang, farm } = useApp();
  const text = useMemo(() => makeV2Text(t, lang), [t, lang]);
  const selected = fitReason(strategy.option, farm.priorities, data.current);
  const message = strategy.kind === 'current' ? t('rotationPlans.currentReason')
    : strategy.reason ? text(strategy.reason) : text(selected.reason) || t('rotationPlans.eligibleReason');
  return <p className="plan-reason"><Lightbulb size={17} aria-hidden="true" /><span>{message}</span></p>;
}

function PlanDetails({ strategy, data }) {
  const { t, lang, farm } = useApp();
  const c = strategy.card, o = strategy.option;
  const text = useMemo(() => makeV2Text(t, lang), [t, lang]);
  const plan = { management: o.management || {}, hasCover: o.sequence.some((y) => y.crops.some((cr) => cr.role === 'cover')) };
  const selected = fitReason(o, farm.priorities, data.current);
  const evidence = [selected.reason, ...Object.values(o.scores).flatMap((s) => s.reasons || []).filter((r) => r.tone === 'down')].filter(Boolean);
  const unique = [...new Map(evidence.map((r) => [r.key, r])).values()].slice(0, 4);
  const sourceName = (id) => {
    const key = `rotationPlans.sources.${id}`;
    return t(key) !== key ? t(key) : data.sources.find((s) => s.id === id)?.name || id;
  };
  return <div className="rot-details merged-plan-details">
    <section><h3>{t('rotationPlans.whySuggested')}</h3><Reason strategy={strategy} data={data} />
      <p className="small muted">{t('rotationPlans.rankingNote')}</p>
      <p className="small muted">{t('rotationPlans.constraintsNote')}</p>
      {farm.priorities.includes('cattle') && <p className="small muted">{t('rotationPlans.cattleNote')}</p>}
    </section>
    <section><h3>{t('rotationPlans.evidence')}</h3><ul className="plan-evidence">{unique.map((r) => <li key={r.key}><p>{text(r)}</p><span className="small muted">{(r.src || ['simulator']).map(sourceName).join(' · ')}</span></li>)}</ul>
      <p className="small muted">{t('rotationPlans.savedAnalysis', { years: data.simulation.years, year: data.simulation.startYear })}</p>
    </section>
    <Management plan={plan} />
    <section><h3>{t('optionsScreen.scoresTitle')}</h3><p className="small muted">{t('rotationPlans.scoreNote')}</p><ScoreGrid scores={c.scores} /></section>
    <FitChecks fit={c.fit} />
    <section><h3>{t('compare.confidenceWhy')}</h3><ConfidenceBadge level={c.confidence.level} />
      {c.confidence.reasons.map((r, i) => <p key={i}>{text(r)}</p>)}<ConfidenceNotes capped={c.confidence.capped} isCurrent={strategy.kind === 'current'} />
    </section>
    {c.placeholders.length > 0 && <PlaceholderPanel items={c.placeholders} />}
    <section><h3>{t('rotationPlans.checkLocally')}</h3><ul className="plan-local-checks">{c.checkLocally.map((id) => <li key={id}><strong>{t(`optionsScreen.local.item.${id}.what`)}</strong><span className="small muted">{t('optionsScreen.local.who', { who: t(`optionsScreen.local.item.${id}.who`) })}</span></li>)}</ul></section>
    {strategy.kind === 'current' && <p className="small muted">{t('mergedPlans.currentSource')}</p>}
  </div>;
}

function StrategyCard({ strategy, data, showWater = false, showCover = false, browsing = false }) {
  const { t, farm, setScreen } = useApp();
  const label = browsing ? t('optionsScreen.option', { letter: strategy.card.letter }) : strategy.kind === 'best' ? t('mergedPlans.best') : strategy.kind === 'current' ? t('mergedPlans.current') : t(`rotationPlans.${strategy.label || 'alternative'}`);
  const tillage = strategy.option.management?.tillage;
  const eligible = eligibleAlternative(strategy.option);
  return <article className={`rot decision-card decision-${strategy.kind}${strategy.kind === 'best' && !browsing ? ' is-best' : ''}`} aria-label={label} data-strategy={strategy.kind} data-option-id={strategy.option.id}>
    <div className="rot-main">
      <header className="decision-header">
        {strategy.kind === 'best' && !browsing && <span className="pill pill-best"><Award size={14} aria-hidden="true" />{t('rotationPlans.recommended')}</span>}
        <h2>{label}</h2>
        {strategy.kind === 'current' && <span className="small muted">{t('rotationPlans.baseline')}</span>}
      </header>
      <div className="decision-sequence"><Steps steps={strategy.card.steps} /></div>
      <ReturnValue strategy={strategy} compact={browsing} />
      <Reason strategy={strategy} data={data} />
      {strategy.kind === 'best' && farm.priorities.includes('cattle') && <p className="small muted">{t('rotationPlans.cattleNote')}</p>}
      {!browsing && <Measures strategy={strategy} showWater={showWater} showCover={showCover} />}
      {browsing && !eligible && <p className="small decision-warning">{t('rotationPlans.notEligible')}</p>}
      {tillage && <p className="decision-assumption small muted">{t('rotationPlans.assumes', { tillage: t(`plansScreen.mgmt.tillage.${tillage}`) })}</p>}
      <button type="button" className="btn btn-block" onClick={() => { setPlayPlan(strategy.option); setScreen('sim'); }}><Gamepad2 size={18} aria-hidden="true" />{t('game.playThis')}</button>
    </div>
    <details className="plan-details"><summary className="rot-toggle">{t('mergedPlans.details')}<ChevronDown size={18} aria-hidden="true" /></summary><PlanDetails strategy={strategy} data={data} /></details>
  </article>;
}

function RotationBrowser({ data }) {
  const cards = useMemo(() => buildOptionCards(data, Infinity), [data]);
  return <div className="rotation-browser-list">{cards.options.map((card) => {
    const option = data.options.find((o) => o.id === card.id);
    return <StrategyCard key={card.id} strategy={{ kind: 'browse', card, option, returns: supportedReturn(option) }} data={data} browsing />;
  })}</div>;
}

export function PlansView({ data, sample = false }) {
  const { t, farm, field, setScreen, browseRotations, setBrowseRotations } = useApp();
  const built = useMemo(() => buildMergedPlans(data, farm), [data, farm]);
  const [explore, setExplore] = useState(false);
  const varying = (read) => new Set(built.strategies.map((s) => read(s.option)).filter(Number.isFinite)).size > 1;
  const showWater = varying((o) => o.fitChecks?.water?.evidence?.params?.shortYears);
  const showCover = varying((o) => o.soilSaved?.bareDaysPerYear);
  const ordered = [...built.strategies].sort((a, b) => (a.kind === 'best' ? -1 : b.kind === 'best' ? 1 : 0));
  return <div className="screen screen-compare screen-plans merged-plans decision-plans">
    <PageHead title={t('nav.plans')} intro={t('rotationPlans.intro', { id: field?.field?.id || data.field.id })} center />
    {sample && <SampleBanner />}
    <div className="rot-grid decision-grid">{ordered.map((strategy) => <StrategyCard key={strategy.kind} strategy={strategy} data={data} showWater={showWater} showCover={showCover} />)}</div>
    {built.strategies.filter((s) => s.kind !== 'current').length < 2 && <p className="small muted" role="status">{t('rotationPlans.gap')}</p>}
    <details className="rotation-browser" open={browseRotations} onToggle={(e) => { if (e.currentTarget.open !== browseRotations) setBrowseRotations(e.currentTarget.open); }}>
      <summary className="btn btn-block">{t('rotationPlans.browse')}<ChevronDown size={18} aria-hidden="true" /></summary>
      {browseRotations && <><p className="small muted rotation-browser-intro">{t('rotationPlans.browseNote', { count: data.options.length })}</p><RotationBrowser data={data} /></>}
    </details>
    <section className="card merged-explore"><button type="button" className="rot-toggle" aria-expanded={explore} aria-controls="plans-explore" onClick={() => setExplore(!explore)}>{t('mergedPlans.explore')}<ChevronDown size={18} aria-hidden="true" /></button>
      {explore && <div id="plans-explore" className="rot-details"><p className="small muted">{t('rotationPlans.simulatorNotice')}</p><button type="button" className="btn" onClick={() => setScreen('sim')}>{t('rotationPlans.openSimulator')}<ArrowRight size={18} aria-hidden="true" /></button></div>}
    </section>
  </div>;
}
export default function Plans() {
  return <V2Gate ns="plansScreen">{(v2) => <PlansView key={v2.data.field.id} data={v2.data} sample={v2.usingSample} />}</V2Gate>;
}
