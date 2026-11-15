// One rotation's details on the Options page, built from daisyUI parts (steps, progress, badges, stats, collapse)
// with no card around it. Shown one rotation at a time (tabs in screens/Options.jsx) so the page stays roomy and
// readable. Props only (data/v2Options.js).
import { useId, useMemo, useState } from 'react';
import { ArrowUpRight, ArrowUp, ArrowDown, CircleCheck, TriangleAlert, CircleX, Users, MapPinned } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { makeV2Text } from '../data/v2Text.js';
import { PlaceholderCardTag, PlaceholderPanel } from './PlaceholderTag.jsx';
import CountUp from './bits/CountUp.jsx';

const FIT = {
  pass: { Icon: CircleCheck, badge: 'badge-success' },
  warn: { Icon: TriangleAlert, badge: 'badge-warning' },
  fail: { Icon: CircleX, badge: 'badge-error' },
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const MINUS = '−';
export const signed = (n, digits = 0) => `${n > 0 ? '+' : n < 0 ? MINUS : ''}${Math.abs(n).toFixed(digits)}`;

export function useMoney() {
  const { lang } = useApp();
  return useMemo(() => {
    const f = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    return (n) => f.format(n);
  }, [lang]);
}
export function optionLabel(t, card) {
  return card.kind === 'current' ? t('optionsScreen.current') : t('optionsScreen.option', { letter: card.letter });
}
export function rotationText(t, card) {
  return card.steps.map((crops) => crops.map((id) => t(`crops.${id}`)).join(' + ')).join(' → ');
}

// A section heading inside the details: one size, generous space above.
function Heading({ children }) {
  return <h3 className="mb-5 mt-0 text-xl font-semibold tracking-tight text-base-content sm:text-2xl">{children}</h3>;
}

export default function OptionSlice({ card, scale }) {
  const { t, lang, setScreen } = useApp();
  const v2t = useMemo(() => makeV2Text(t, lang), [t, lang]);
  const money = useMoney();
  const [phOpen, setPhOpen] = useState(false);
  const phId = useId();
  const isCurrent = card.kind === 'current';
  const span = Math.max(1, scale.max - scale.min);
  const at = (v) => clamp01((v - scale.min) / span) * 100;
  const p = card.profit;

  return (
    <div className="option-detail flex flex-col gap-5">
      {/* Name, crop order, score */}
      <div className="gl-card flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="badge badge-lg badge-outline">{optionLabel(t, card)}</span>
            {card.best && <span className="badge badge-lg badge-primary">{t('optionsScreen.best')}</span>}
            {card.placeholders.length > 0 && <PlaceholderCardTag open={phOpen} onToggle={() => setPhOpen(!phOpen)} panelId={phId} />}
          </div>
          <p className="mb-4 text-sm font-medium uppercase tracking-wider text-base-content/60">{t('optionsScreen.cropOrder')}</p>
          <ul className="steps steps-vertical w-full sm:steps-horizontal">
            {card.steps.map((crops, i) => (
              <li key={i} className="step step-primary" data-content={i + 1}>
                <span className="text-base font-medium leading-snug sm:px-2">{crops.map((id) => t(`crops.${id}`)).join(' + ')}</span>
              </li>
            ))}
          </ul>
          {!isCurrent && card.neighbors && (
            <p className="mt-6 flex items-center gap-2 text-base text-base-content/70">
              <Users size={18} aria-hidden="true" />{t('optionsScreen.neighbors', { count: card.neighbors.count, miles: card.neighbors.radiusMiles })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-5 lg:flex-col lg:items-end lg:gap-3" role="img"
          aria-label={t('optionsScreen.gradeLabel', { grade: card.grade, total: Math.round(card.total) })}>
          <div className="flex items-start gap-3" aria-hidden="true">
            <CountUp to={Math.round(card.total)} duration={1.4} className={`text-7xl font-bold leading-none tracking-tighter sm:text-8xl ${card.best ? 'text-primary' : ''}`} />
            <span className="badge badge-secondary badge-lg mt-2 font-bold">{card.grade}</span>
          </div>
          {!isCurrent && card.deltaTotal != null && (
            <span className={`badge badge-lg h-auto gap-1 whitespace-normal py-1 text-left ${card.deltaTotal > 0 ? 'badge-success' : 'badge-ghost'}`} aria-hidden="true">
              {card.deltaTotal > 0 ? <ArrowUp size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}
              {signed(card.deltaTotal)} {t('optionsScreen.vsToday')}
            </span>
          )}
        </div>
      </div>
      {phOpen && <div><PlaceholderPanel items={card.placeholders} id={phId} /></div>}

      {/* Six scores: a number and a bar each, three to a row on wide screens */}
      <section className="gl-card">
      <Heading>{t('optionsScreen.scoresTitle')}</Heading>
      <ul className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {card.scores.map((s) => (
          <li key={s.id} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-lg font-medium">{t(s.nameKey)}</span>
              <span className="text-3xl font-bold tabular-nums tracking-tight">{Math.round(s.value)}</span>
            </div>
            <progress className="progress progress-primary h-2.5 w-full" data-grow value={Math.round(s.value)} max="100" />
          </li>
        ))}
      </ul>
      </section>

      {/* Four fit checks, two to a row */}
      <section className="gl-card">
      <Heading>{t('optionsScreen.fitTitle')}</Heading>
      <ul className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2">
        {card.fit.map((c) => {
          const { Icon, badge } = FIT[c.status];
          return (
            <li key={c.id} className="flex gap-4">
              <span className={`badge ${badge} mt-0.5 h-10 w-10 flex-none rounded-full p-0`}><Icon size={20} aria-hidden="true" /></span>
              <div className="flex flex-col gap-1.5">
                <p className="text-lg font-semibold">
                  {t(`optionsScreen.fit.name.${c.id}`)}
                  <span className="ml-2 text-sm font-medium uppercase tracking-wider text-base-content/60">{t(`optionsScreen.fit.status.${c.status}`)}</span>
                </p>
                <p className="max-w-prose text-base leading-relaxed text-base-content/80">{v2t(c.evidence)}</p>
              </div>
            </li>
          );
        })}
      </ul>
      </section>

      {/* Money and what the rotation saves */}
      <section className="gl-card">
      <Heading>{t('optionsScreen.profitLabel')}</Heading>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-5xl font-bold tabular-nums tracking-tight">{money(p.typical)}</span>
            <span className="text-lg text-base-content/70">{t('optionsScreen.perAcreYear')}</span>
          </p>
          <div className="relative my-2 h-3 rounded-full bg-base-300" role="img" aria-label={t('optionsScreen.profitRange', { low: money(p.low), high: money(p.high) })}>
            <span className="absolute inset-y-0 rounded-full bg-secondary" style={{ left: `${at(p.low)}%`, width: `${Math.max(2, at(p.high) - at(p.low))}%` }} />
            <span className="absolute -inset-y-1.5 w-1 -translate-x-1/2 rounded-full bg-primary" style={{ left: `${at(p.typical)}%` }} />
          </div>
          <p className="text-base text-base-content/80">{t('optionsScreen.profitRange', { low: money(p.low), high: money(p.high) })}</p>
          <p className="text-base text-base-content/80">
            {isCurrent || p.beatsCurrent == null ? t('optionsScreen.profitBaseline') : t('optionsScreen.beatsToday', { pct: Math.round(p.beatsCurrent * 100) })}
          </p>
          <p className="text-sm leading-relaxed text-base-content/60">{t('v2.honest.costShare')} {t('v2.honest.fixedCosts')}</p>
        </div>
        {!isCurrent && (card.soilSaved || card.nitrogenSaved) && (
          <div className="stats stats-vertical bg-transparent sm:stats-horizontal lg:stats-vertical">
            {card.soilSaved && (
              <div className="stat px-0 sm:px-6 lg:px-0">
                <div className="stat-title text-base">{t('optionsScreen.soilSaved')}</div>
                <div className="stat-value text-primary">{signed(card.soilSaved.value, 1)}</div>
                <div className="stat-desc whitespace-normal text-sm">{t('optionsScreen.soilUnit')}</div>
              </div>
            )}
            {card.nitrogenSaved && (
              <div className="stat px-0 sm:px-6 lg:px-0">
                <div className="stat-title text-base">{t('optionsScreen.nitrogenSaved')}</div>
                <div className="stat-value text-primary">{signed(card.nitrogenSaved.value)}</div>
                <div className="stat-desc whitespace-normal text-sm">{t('optionsScreen.nitrogenUnit')}</div>
              </div>
            )}
          </div>
        )}
      </div>
      </section>

      {/* How sure, and what to check locally */}
      <section className="gl-card">
      <Heading>{t('compare.confidenceBadge', { level: t(`confidenceLevel.${card.confidence.level}`) })}</Heading>
      <div className="flex max-w-3xl flex-col gap-3 text-lg leading-relaxed">
        {card.confidence.reasons.slice(0, 2).map((r, i) => <p key={i}>{v2t(r)}</p>)}
        {card.confidence.capped && <p className="text-base text-base-content/75">{t('v2.honest.confCap')}</p>}
        {isCurrent && (
          <p className="text-base text-base-content/75">
            {t('v2.honest.tillage')}{' '}
            <button type="button" className="link link-primary inline-flex items-center gap-1 font-semibold" onClick={() => setScreen('sim')}>
              {t('v2.honest.tillageTry')}<ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </p>
        )}
      </div>
      {card.checkLocally?.length > 0 && (
        <div className="collapse collapse-arrow mt-6 rounded-none border border-base-300 bg-base-200/50">
          <input type="checkbox" aria-label={t('optionsScreen.local.title', { count: card.checkLocally.length })} />
          <div className="collapse-title flex items-center gap-3 text-lg font-semibold">
            <MapPinned size={20} className="text-primary" aria-hidden="true" />{t('optionsScreen.local.title', { count: card.checkLocally.length })}
          </div>
          <div className="collapse-content">
            <ul className="grid grid-cols-1 gap-6 pt-2 md:grid-cols-3">
              {card.checkLocally.map((k) => (
                <li key={k} className="flex flex-col gap-1">
                  <span className="text-base font-semibold">{t(`optionsScreen.local.item.${k}.what`)}</span>
                  <span className="text-sm text-base-content/70">{t('optionsScreen.local.who', { who: t(`optionsScreen.local.item.${k}.who`) })}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      </section>
    </div>
  );
}
