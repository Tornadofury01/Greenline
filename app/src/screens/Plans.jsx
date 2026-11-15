// Screen 5 (v2): Best plans. Most profitable / best balance / safest, side by side, with the management choices
// that go with each. Profit is a range and a chance of beating today, never a promise.
// Data: ONE loader (data/loadV2.js) -> data/v2Plans.js -> cards. One placeholder notice per screen, one tag per card.
import { useId, useMemo, useState } from 'react';
import { Lightbulb, ShieldCheck, Trophy, Scale, Umbrella } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { buildBestPlans } from '../data/v2Plans.js';
import { makeV2Text } from '../data/v2Text.js';
import { Steps, ProfitBlock, CheckLocally, ConfidenceNotes } from '../components/OptionCard.jsx';
import { ConfidenceBadge, PageHead } from '../components/Small.jsx';
import { SampleBanner, PlaceholderNotice, PlaceholderCardTag, PlaceholderPanel } from '../components/PlaceholderTag.jsx';
import V2Gate from '../components/V2Gate.jsx';

const KIND_ICON = { mostProfitable: Trophy, bestBalance: Scale, safest: Umbrella };
const MINUS = '−';

function useMoney() {
  const { lang } = useApp();
  return useMemo(() => {
    const f = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    return (n) => `${n < 0 ? MINUS : ''}${f.format(Math.abs(n))}`;
  }, [lang]);
}

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

// The three answers in one row: name, typical profit, chance of beating today. Short enough to sit three across at 375 px.
function Glance({ plans, money }) {
  const { t } = useApp();
  return (
    <section className="card plan-glance" aria-label={t('plansScreen.glanceTitle')}>
      <h2 className="group-head">{t('plansScreen.glanceTitle')}</h2>
      <ul className="glance-cols">
        {plans.map((p) => {
          const Icon = KIND_ICON[p.kind];
          const beats = p.card.profit.beatsCurrent;
          return (
            <li key={p.kind} className="glance-col">
              <span className="glance-name"><Icon size={16} aria-hidden="true" />{t(`plansScreen.kind.${p.kind}.name`)}</span>
              <span className="glance-num">{money(p.card.profit.typical)}</span>
              <span className="tile-unit">{t('plansScreen.typicalPerAcre')}</span>
              {beats != null && <span className="tile-note">{t('plansScreen.glanceChance', { pct: Math.round(beats * 100) })}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PlanCard({ plan, scale, money }) {
  const { t, lang } = useApp();
  const v2t = useMemo(() => makeV2Text(t, lang), [t, lang]);
  const [phOpen, setPhOpen] = useState(false);
  const phId = useId();
  const Icon = KIND_ICON[plan.kind];
  const c = plan.card;
  const name = t(`plansScreen.kind.${plan.kind}.name`);
  const diff = `${plan.typicalVsToday > 0 ? '+' : ''}${money(plan.typicalVsToday)}`;
  return (
    <article className="card plan" aria-label={name}>
      <header className="opt-head">
        <div className="opt-title">
          <div className="opt-name">
            <Icon size={20} aria-hidden="true" /><h2>{name}</h2>
            {plan.placeholders.length > 0 && <PlaceholderCardTag open={phOpen} onToggle={() => setPhOpen(!phOpen)} panelId={phId} />}
          </div>
          <p className="muted">{t(`plansScreen.kind.${plan.kind}.blurb`)}</p>
        </div>
        <div className="grade" role="img" aria-label={t('optionsScreen.gradeLabel', { grade: c.grade, total: c.total })}>
          <span className="grade-letter" aria-hidden="true">{c.grade}</span>
          <span className="grade-total" aria-hidden="true">{c.total}</span>
        </div>
      </header>
      {phOpen && <PlaceholderPanel items={plan.placeholders} id={phId} />}
      {plan.alsoKinds.length > 0 && (
        <p className="pill pill-best plan-same">{t('plansScreen.sameAs', { name: plan.alsoKinds.map((k) => t(`plansScreen.kind.${k}.name`)).join(', ') })}</p>
      )}
      <p className="plan-why">{v2t(plan.why)}</p>

      <section>
        <h3 className="group-head">{t('plansScreen.rotationTitle')}</h3>
        <Steps steps={c.steps} />
      </section>

      <ProfitBlock profit={c.profit} scale={scale} isCurrent={false} />
      <p className="opt-delta">{t('plansScreen.vsToday', { diff })}</p>

      <Management plan={plan} />

      <div className="opt-conf">
        <ConfidenceBadge level={c.confidence.level} />
        {c.confidence.reasons.slice(0, 2).map((r, i) => <p key={i} className="opt-conf-reason">{v2t(r)}</p>)}
        <ConfidenceNotes capped={c.confidence.capped} />
      </div>
      <CheckLocally items={c.checkLocally} />
    </article>
  );
}

// Props only (a preview or test can feed it anything): built = { plans, limits } from buildBestPlans().
export function PlansView({ built, sample = false }) {
  const { t } = useApp();
  const money = useMoney();
  const { plans, limits } = built;
  const pad = 10;
  const scale = {
    min: Math.max(0, Math.min(...plans.map((p) => p.card.profit.low)) - pad),
    max: Math.max(...plans.map((p) => p.card.profit.high)) + pad,
  };
  // Limit lines: only the ones we have words for.
  const limitLines = Object.entries(limits).map(([k, v]) => `plansScreen.limits.${k}.${v}`).filter((k) => t(k) !== k);
  return (
    <div className="screen screen-plans">
      {sample && <SampleBanner />}
      {plans.some((p) => p.placeholders.length > 0) && <PlaceholderNotice />}
      <PageHead title={t('plansScreen.title')} intro={t('plansScreen.intro')} />
      {limitLines.length > 0 && (
        <section className="card plan-limits">
          <h2 className="group-head"><ShieldCheck size={16} aria-hidden="true" />{t('plansScreen.limitsTitle')}</h2>
          <ul>{limitLines.map((k) => <li key={k}>{t(k)}</li>)}</ul>
        </section>
      )}
      <Glance plans={plans} money={money} />
      <div className="plan-grid">
        {plans.map((p) => <PlanCard key={p.kind} plan={p} scale={scale} money={money} />)}
      </div>
      <p className="takeaway small"><Lightbulb size={18} aria-hidden="true" /><span>{t('plansScreen.takeaway')}</span></p>
    </div>
  );
}

function PlansBuilt({ data, sample }) {
  const built = useMemo(() => buildBestPlans(data), [data]);
  return <PlansView built={built} sample={sample} />;
}

export default function Plans() {
  return (
    <V2Gate ns="plansScreen">
      {(v2) => <PlansBuilt data={v2.data} sample={v2.usingSample} />}
    </V2Gate>
  );
}
