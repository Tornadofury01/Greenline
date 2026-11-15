// One option (or today's rotation) on the Options screen. Props only; data comes from data/v2Options.js.
//
// `card` (see buildOptionCards): { id, kind: 'current'|'option', letter, best, steps: [[cropId, ...] per year], total, grade,
//   deltaTotal, scores: [{ id, nameKey, value, placeholder }] (six), fit: [{ id, status, evidence, placeholder }] (four),
//   profit: { low, typical, high, beatsCurrent, placeholder }, soilSaved / nitrogenSaved: { value, placeholder } | null,
//   confidence: { level, reasons: [{ key, params }] }, checkLocally: [id], neighbors: { count, radiusMiles } | null,
//   placeholders: [{ labelKey, slots: [slotName] }] }
// `scale` = { min, max } dollars, the same for every card so the profit bars can be compared.
// Placeholder mark: ONE small tag in the card heading (card.placeholders lists the numbers and the slots they wait for);
// no tags on individual numbers.
import { useId, useMemo, useState } from 'react';
import { ChevronDown, ArrowRight, CircleCheck, TriangleAlert, CircleX, Layers, Sprout, MapPinned, Users } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { makeV2Text } from '../data/v2Text.js';
import { ConfidenceBadge } from './Small.jsx';
import { PlaceholderCardTag, PlaceholderPanel } from './PlaceholderTag.jsx';

const FIT_ICON = { pass: CircleCheck, warn: TriangleAlert, fail: CircleX };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const MINUS = '−';
const signed = (n, digits = 0) => `${n > 0 ? '+' : n < 0 ? MINUS : ''}${Math.abs(n).toFixed(digits)}`;

function useV2Text() {
  const { t, lang } = useApp();
  return useMemo(() => makeV2Text(t, lang), [t, lang]);
}

// A group heading.
function GroupHead({ title }) {
  return <h3 className="group-head">{title}</h3>;
}

export function Steps({ steps }) {
  const { t } = useApp();
  return (
    <ol className="steps">
      {steps.map((crops, i) => (
        <li key={i}>
          {i > 0 && <ArrowRight size={16} className="step-arrow" aria-hidden="true" />}
          <span className="step-crop">
            <span className="step-n" aria-hidden="true">{i + 1}</span>
            {crops.map((id) => t(`crops.${id}`)).join(' + ')}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function GradeBadge({ grade, total }) {
  const { t } = useApp();
  return (
    <div className="grade" role="img" aria-label={t('optionsScreen.gradeLabel', { grade, total })}>
      <span className="grade-letter" aria-hidden="true">{grade}</span>
      <span className="grade-total" aria-hidden="true">{total}</span>
    </div>
  );
}

// Six scores: a number and a thin bar each. The bar is a second cue; the number is always there.
export function ScoreGrid({ scores }) {
  const { t } = useApp();
  return (
    <section>
      <GroupHead title={t('optionsScreen.scoresTitle')} />
      <ul className="score-grid">
        {scores.map((s) => (
          <li key={s.id} className="score-cell">
            <span className="score-name">{t(s.nameKey)}</span>
            <span className="score-num">{Math.round(s.value)}</span>
            <span className="thin-bar" aria-hidden="true"><span style={{ width: `${clamp01(s.value / 100) * 100}%` }} /></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The four fit checks. A chip (icon + word: never color alone) and one line of evidence.
export function FitChecks({ fit }) {
  const { t } = useApp();
  const v2t = useV2Text();
  return (
    <section>
      <GroupHead title={t('optionsScreen.fitTitle')} />
      <ul className="fit-list">
        {fit.map((c) => {
          const Icon = FIT_ICON[c.status];
          return (
            <li key={c.id} className="fit-row">
              <span className={`fit-chip fit-${c.status}`}>
                <Icon size={16} aria-hidden="true" />
                <span>{t(`optionsScreen.fit.name.${c.id}`)}</span>
                <span className="fit-status">{t(`optionsScreen.fit.status.${c.status}`)}</span>
              </span>
              <span className="fit-line">{v2t(c.evidence)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Profit as a range, never one promise: a bar from "low" to "high" with a marker at "typical".
export function ProfitBlock({ profit, scale, isCurrent }) {
  const { t, lang } = useApp();
  const money = useMemo(() => { const f = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }); return (n) => f.format(n); }, [lang]);
  const span = Math.max(1, scale.max - scale.min);
  const at = (v) => clamp01((v - scale.min) / span) * 100;
  const range = t('optionsScreen.profitRange', { low: money(profit.low), high: money(profit.high) });
  return (
    <div className="tile profit-tile">
      <span className="tile-label">{t('optionsScreen.profitLabel')}</span>
      <span className="tile-value">{money(profit.typical)} <span className="tile-unit">{t('optionsScreen.perAcreYear')}</span></span>
      <span className="range-bar" role="img" aria-label={range}>
        <span className="range-span" style={{ left: `${at(profit.low)}%`, width: `${Math.max(2, at(profit.high) - at(profit.low))}%` }} />
        <span className="range-mark" style={{ left: `${at(profit.typical)}%` }} />
      </span>
      <span className="tile-note">{range}</span>
      <span className="tile-note">{t('v2.honest.costShare')} {t('v2.honest.fixedCosts')}</span>
      <span className="tile-note">
        {isCurrent || profit.beatsCurrent == null
          ? t('optionsScreen.profitBaseline')
          : t('optionsScreen.beatsToday', { pct: Math.round(profit.beatsCurrent * 100) })}
      </span>
    </div>
  );
}

function SavedTile({ Icon, label, saved, unitKey, digits = 0 }) {
  const { t } = useApp();
  return (
    <div className="tile">
      <span className="tile-label"><Icon size={16} aria-hidden="true" />{label}</span>
      <span className="tile-value">{signed(saved.value, digits)}</span>
      <span className="tile-unit">{t(unitKey)}</span>
    </div>
  );
}

// "Check locally": the things the tool can't settle, each with who can.
export function CheckLocally({ items }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!items?.length) return null;
  return (
    <div className="check-local">
      <button type="button" className="local-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <MapPinned size={18} aria-hidden="true" />
        <span>{t('optionsScreen.local.title', { count: items.length })}</span>
        <ChevronDown size={18} className="chev" aria-hidden="true" />
      </button>
      {open && (
        <ul className="local-list" id={id}>
          {items.map((k) => (
            <li key={k}>
              <strong>{t(`optionsScreen.local.item.${k}.what`)}</strong>
              <span className="muted">{t('optionsScreen.local.who', { who: t(`optionsScreen.local.item.${k}.who`) })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Why the confidence badge cannot say "high" yet, and what the current rotation assumes about tillage.
export function ConfidenceNotes({ capped, isCurrent }) {
  const { t, setScreen } = useApp();
  return (
    <>
      {capped && <p className="opt-conf-reason">{t('v2.honest.confCap')}</p>}
      {isCurrent && (
        <p className="opt-conf-reason">
          {t('v2.honest.tillage')}{' '}
          <button type="button" className="btn-text" onClick={() => setScreen('farm')}>{t('v2.honest.tillageTry')}</button>
        </p>
      )}
    </>
  );
}

export default function OptionCard({ card, scale }) {
  const { t } = useApp();
  const v2t = useV2Text();
  const [phOpen, setPhOpen] = useState(false);
  const phId = useId();
  const isCurrent = card.kind === 'current';
  const label = isCurrent ? t('optionsScreen.current') : t('optionsScreen.option', { letter: card.letter });
  return (
    <article className={`card opt${card.best ? ' is-best' : ''}${isCurrent ? ' is-current' : ''}`} aria-label={label}>
      <header className="opt-head">
        <div className="opt-title">
          <div className="opt-name"><h2>{label}</h2>{card.placeholders.length > 0 && <PlaceholderCardTag open={phOpen} onToggle={() => setPhOpen(!phOpen)} panelId={phId} />}</div>
          {card.best && <span className="pill pill-best">{t('optionsScreen.best')}</span>}
          <Steps steps={card.steps} />
        </div>
        <GradeBadge grade={card.grade} total={card.total} />
      </header>
      {phOpen && <PlaceholderPanel items={card.placeholders} id={phId} />}
      {!isCurrent && card.deltaTotal != null && (
        <p className="opt-delta">{signed(card.deltaTotal)} {t('optionsScreen.vsToday')}</p>
      )}

      <ScoreGrid scores={card.scores} />
      <FitChecks fit={card.fit} />
      <ProfitBlock profit={card.profit} scale={scale} isCurrent={isCurrent} />

      {!isCurrent && (card.soilSaved || card.nitrogenSaved) && (
        <div className="tiles">
          {card.soilSaved && <SavedTile Icon={Layers} label={t('optionsScreen.soilSaved')} saved={card.soilSaved} unitKey="optionsScreen.soilUnit" digits={1} />}
          {card.nitrogenSaved && <SavedTile Icon={Sprout} label={t('optionsScreen.nitrogenSaved')} saved={card.nitrogenSaved} unitKey="optionsScreen.nitrogenUnit" />}
        </div>
      )}

      <div className="opt-conf">
        <ConfidenceBadge level={card.confidence.level} />
        {card.confidence.reasons.slice(0, 2).map((r, i) => <p key={i} className="opt-conf-reason">{v2t(r)}</p>)}
        <ConfidenceNotes capped={card.confidence.capped} isCurrent={isCurrent} />
      </div>

      {card.neighbors && !isCurrent && (
        <p className="opt-neighbors"><Users size={16} aria-hidden="true" />{t('optionsScreen.neighbors', { count: card.neighbors.count, miles: card.neighbors.radiusMiles })}</p>
      )}

      <CheckLocally items={card.checkLocally} />
    </article>
  );
}
