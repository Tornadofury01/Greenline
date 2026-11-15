// One option (or today's rotation) on the Options screen. Props only: no data loading here.
//
// LAYOUT-TIME SHAPE of `option` (will be mapped from docs/v2-data-contract.md by the loader; change only the mapping):
//   { id, kind: 'current' | 'option', letter?: 'A' | 'B' | ... (options only), crops: [cropId], best?: bool,
//     grade: 'A'..'D', total: 0-100, deltaTotal?: number (vs today),
//     scores: [{ id, value: 0-100, placeholder? }]                          (six)
//     fit: [{ id: 'water'|'disease'|'market'|'season', status: 'pass'|'warn'|'fail',
//             evidence: { key, params }, placeholder? }]                   (four)
//     profit: { low, typical, high, beatsCurrent: 0-1 | null, placeholder? }   ($ per acre per year)
//     soilSaved?: { value, placeholder? }        (tons of soil per acre per year, vs today)
//     nitrogenSaved?: { value, placeholder? }    (lb N per acre per year, vs today)
//     confidence: { level: 'high'|'medium'|'low', reason: { key, params } },
//     checkLocally: [itemId] }
// `scale` = { min, max } dollars, the same for every card so the profit bars can be compared.
// Text: every string goes through t(); evidence and confidence reasons arrive as { key, params }.
import { useId, useState } from 'react';
import { ChevronDown, CircleCheck, TriangleAlert, CircleX, Layers, Sprout, MapPinned } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { CropSteps } from './RotationCard.jsx';
import { ConfidenceBadge } from './Small.jsx';
import { PlaceholderTag } from './PlaceholderTag.jsx';

const FIT_ICON = { pass: CircleCheck, warn: TriangleAlert, fail: CircleX };
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function useMoney() {
  const { lang } = useApp();
  const f = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  return (n) => f.format(n);
}

function Signed({ n, unit }) {
  // "+34" / "−12" with a real minus sign.
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return <>{sign}{Math.abs(n)}{unit}</>;
}

export function GradeBadge({ grade, total }) {
  const { t } = useApp();
  return (
    <div className="grade" aria-label={t('optionsScreen.gradeLabel', { grade, total })}>
      <span className="grade-letter" aria-hidden="true">{grade}</span>
      <span className="grade-total" aria-hidden="true">{total}</span>
    </div>
  );
}

// Six scores: a number and a thin bar each. The bar is a second cue; the number is always there.
export function ScoreGrid({ scores }) {
  const { t } = useApp();
  return (
    <ul className="score-grid" aria-label={t('optionsScreen.scoresTitle')}>
      {scores.map((s) => (
        <li key={s.id} className="score-cell">
          <span className="score-name">{t(`optionsScreen.score.${s.id}`)}</span>
          <span className="score-num">{Math.round(s.value)}</span>
          <span className="thin-bar" aria-hidden="true"><span style={{ width: `${clamp01(s.value / 100) * 100}%` }} /></span>
          {s.placeholder && <PlaceholderTag />}
        </li>
      ))}
    </ul>
  );
}

// The four fit checks. A chip (icon + word: never color alone) and one line of evidence.
export function FitChecks({ fit }) {
  const { t } = useApp();
  return (
    <ul className="fit-list" aria-label={t('optionsScreen.fitTitle')}>
      {fit.map((c) => {
        const Icon = FIT_ICON[c.status];
        return (
          <li key={c.id} className="fit-row">
            <span className={`fit-chip fit-${c.status}`}>
              <Icon size={16} aria-hidden="true" />
              <span>{t(`optionsScreen.fit.name.${c.id}`)}</span>
              <span className="fit-status">{t(`optionsScreen.fit.status.${c.status}`)}</span>
            </span>
            <span className="fit-line">
              {t(c.evidence.key, c.evidence.params)}
              {c.placeholder && <> <PlaceholderTag /></>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// Profit as a range, never one promise: a bar from "low" to "high" with a marker at "typical".
export function ProfitBlock({ profit, scale, isCurrent }) {
  const { t } = useApp();
  const money = useMoney();
  const span = Math.max(1, scale.max - scale.min);
  const pos = (v) => `${clamp01((v - scale.min) / span) * 100}%`;
  const left = clamp01((profit.low - scale.min) / span) * 100;
  const width = Math.max(2, (clamp01((profit.high - scale.min) / span) * 100) - left);
  return (
    <div className="tile profit-tile">
      <span className="tile-label">{t('optionsScreen.profitLabel')} {profit.placeholder && <PlaceholderTag />}</span>
      <span className="tile-value">{money(profit.typical)}<span className="tile-unit"> {t('optionsScreen.perAcreYear')}</span></span>
      <span className="range-bar" role="img" aria-label={t('optionsScreen.profitRange', { low: money(profit.low), high: money(profit.high) })}>
        <span className="range-span" style={{ left: `${left}%`, width: `${width}%` }} />
        <span className="range-mark" style={{ left: pos(profit.typical) }} />
      </span>
      <span className="tile-note">{t('optionsScreen.profitRange', { low: money(profit.low), high: money(profit.high) })}</span>
      <span className="tile-note">
        {isCurrent || profit.beatsCurrent == null
          ? t('optionsScreen.profitBaseline')
          : t('optionsScreen.beatsToday', { pct: Math.round(profit.beatsCurrent * 100) })}
      </span>
    </div>
  );
}

function SavedTile({ Icon, label, saved, unitKey, decimals = 0 }) {
  const { t } = useApp();
  const v = saved.value;
  const shown = decimals ? v.toFixed(decimals) : Math.round(v);
  return (
    <div className="tile">
      <span className="tile-label"><Icon size={16} aria-hidden="true" />{label} {saved.placeholder && <PlaceholderTag />}</span>
      <span className="tile-value">{v > 0 ? '+' : ''}{shown}</span>
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

export default function OptionCard({ option, scale }) {
  const { t } = useApp();
  const isCurrent = option.kind === 'current';
  const label = isCurrent ? t('optionsScreen.current') : t('optionsScreen.option', { letter: option.letter });
  return (
    <article className={`card opt${option.best ? ' is-best' : ''}${isCurrent ? ' is-current' : ''}`} aria-label={label}>
      <header className="opt-head">
        <div className="opt-title">
          <h2>{label}</h2>
          {option.best && <span className="pill pill-best">{t('optionsScreen.best')}</span>}
          <CropSteps crops={option.crops} />
        </div>
        <GradeBadge grade={option.grade} total={option.total} />
      </header>
      {!isCurrent && option.deltaTotal != null && (
        <p className="opt-delta"><Signed n={option.deltaTotal} /> {t('optionsScreen.vsToday')}</p>
      )}

      <ScoreGrid scores={option.scores} />
      <FitChecks fit={option.fit} />
      <ProfitBlock profit={option.profit} scale={scale} isCurrent={isCurrent} />

      {!isCurrent && (option.soilSaved || option.nitrogenSaved) && (
        <div className="tiles">
          {option.soilSaved && <SavedTile Icon={Layers} label={t('optionsScreen.soilSaved')} saved={option.soilSaved} unitKey="optionsScreen.soilUnit" decimals={1} />}
          {option.nitrogenSaved && <SavedTile Icon={Sprout} label={t('optionsScreen.nitrogenSaved')} saved={option.nitrogenSaved} unitKey="optionsScreen.nitrogenUnit" />}
        </div>
      )}

      <div className="opt-conf">
        <ConfidenceBadge level={option.confidence.level} />
        <p className="opt-conf-reason">{t(option.confidence.reason.key, option.confidence.reason.params)}</p>
      </div>

      <CheckLocally items={option.checkLocally} />
    </article>
  );
}
