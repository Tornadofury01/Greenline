// One rotation (today's or an option) as an open section of the Options page, laid out like a product slice on
// anduril.com: label and tag on the left, name and score on the right, then its numbers side by side in rows.
// No card: the section sits on the cream page, opened by a hairline rule. Props only (data/v2Options.js).
import { useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUpRight, CircleCheck, TriangleAlert, CircleX, Users } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { makeV2Text } from '../data/v2Text.js';
import { PlaceholderCardTag, PlaceholderPanel } from './PlaceholderTag.jsx';

const FIT_ICON = { pass: CircleCheck, warn: TriangleAlert, fail: CircleX };
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

// A row inside a slice: small uppercase label in the left columns, content in the right ones.
function Row({ label, children }) {
  return (
    <div className="ad-row">
      <p className="ad-label ad-row-label">{label}</p>
      <div className="ad-row-body">{children}</div>
    </div>
  );
}

export default function OptionSlice({ card, scale }) {
  const { t, lang, setScreen } = useApp();
  const v2t = useMemo(() => makeV2Text(t, lang), [t, lang]);
  const money = useMoney();
  const [phOpen, setPhOpen] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const phId = useId();
  const localId = useId();
  const isCurrent = card.kind === 'current';
  const span = Math.max(1, scale.max - scale.min);
  const at = (v) => clamp01((v - scale.min) / span) * 100;
  const p = card.profit;

  return (
    <section id={`opt-${card.id}`} className={`ad-slice${card.best ? ' is-best' : ''}`} aria-label={optionLabel(t, card)}>
      <div className="ad-slice-head">
        <div className="ad-slice-tags">
          <p className="ad-label">{optionLabel(t, card)}</p>
          {card.best && <p className="ad-label ad-tag">[{t('optionsScreen.best')}]</p>}
          {card.placeholders.length > 0 && <PlaceholderCardTag open={phOpen} onToggle={() => setPhOpen(!phOpen)} panelId={phId} />}
        </div>
        <div className="ad-slice-name">
          <h2>{rotationText(t, card)}</h2>
          {!isCurrent && card.neighbors && (
            <p className="ad-muted"><Users size={15} aria-hidden="true" />{t('optionsScreen.neighbors', { count: card.neighbors.count, miles: card.neighbors.radiusMiles })}</p>
          )}
        </div>
        <div className="ad-slice-score" role="img" aria-label={t('optionsScreen.gradeLabel', { grade: card.grade, total: Math.round(card.total) })}>
          <span className="ad-big">{Math.round(card.total)}<span className="ad-grade">{card.grade}</span></span>
          {!isCurrent && card.deltaTotal != null && (
            <span className={`ad-delta${card.deltaTotal > 0 ? ' is-up' : ''}`}>{signed(card.deltaTotal)} {t('optionsScreen.vsToday')}</span>
          )}
        </div>
      </div>
      {phOpen && <div className="ad-row"><span /><div className="ad-row-body"><PlaceholderPanel items={card.placeholders} id={phId} /></div></div>}

      <Row label={t('optionsScreen.scoresTitle')}>
        <ul className="ad-cols ad-cols-6">
          {card.scores.map((s) => (
            <li key={s.id}>
              <span className="ad-num">{Math.round(s.value)}</span>
              <span className="ad-bar" aria-hidden="true"><span style={{ width: `${clamp01(s.value / 100) * 100}%` }} /></span>
              <span className="ad-small">{t(s.nameKey)}</span>
            </li>
          ))}
        </ul>
      </Row>

      <Row label={t('optionsScreen.fitTitle')}>
        <ul className="ad-cols ad-cols-4">
          {card.fit.map((c) => {
            const Icon = FIT_ICON[c.status];
            return (
              <li key={c.id}>
                <span className={`ad-fit ad-fit-${c.status}`}><Icon size={15} aria-hidden="true" />{t(`optionsScreen.fit.status.${c.status}`)}</span>
                <span className="ad-strong">{t(`optionsScreen.fit.name.${c.id}`)}</span>
                <span className="ad-small">{v2t(c.evidence)}</span>
              </li>
            );
          })}
        </ul>
      </Row>

      <Row label={t('optionsScreen.profitLabel')}>
        <ul className="ad-cols ad-cols-4">
          <li className="ad-span-2">
            <span className="ad-num">{money(p.typical)} <span className="ad-unit">{t('optionsScreen.perAcreYear')}</span></span>
            <span className="ad-range" role="img" aria-label={t('optionsScreen.profitRange', { low: money(p.low), high: money(p.high) })}>
              <span className="ad-range-span" style={{ left: `${at(p.low)}%`, width: `${Math.max(2, at(p.high) - at(p.low))}%` }} />
              <span className="ad-range-mark" style={{ left: `${at(p.typical)}%` }} />
            </span>
            <span className="ad-small">{t('optionsScreen.profitRange', { low: money(p.low), high: money(p.high) })}</span>
            <span className="ad-small">
              {isCurrent || p.beatsCurrent == null ? t('optionsScreen.profitBaseline') : t('optionsScreen.beatsToday', { pct: Math.round(p.beatsCurrent * 100) })}
            </span>
          </li>
          {!isCurrent && card.soilSaved && (
            <li>
              <span className="ad-num">{signed(card.soilSaved.value, 1)}</span>
              <span className="ad-strong">{t('optionsScreen.soilSaved')}</span>
              <span className="ad-small">{t('optionsScreen.soilUnit')}</span>
            </li>
          )}
          {!isCurrent && card.nitrogenSaved && (
            <li>
              <span className="ad-num">{signed(card.nitrogenSaved.value)}</span>
              <span className="ad-strong">{t('optionsScreen.nitrogenSaved')}</span>
              <span className="ad-small">{t('optionsScreen.nitrogenUnit')}</span>
            </li>
          )}
        </ul>
        <p className="ad-small ad-note">{t('v2.honest.costShare')} {t('v2.honest.fixedCosts')}</p>
      </Row>

      <Row label={t('compare.confidenceBadge', { level: t(`confidenceLevel.${card.confidence.level}`) })}>
        <div className="ad-text">
          {card.confidence.reasons.slice(0, 2).map((r, i) => <p key={i}>{v2t(r)}</p>)}
          {card.confidence.capped && <p>{t('v2.honest.confCap')}</p>}
          {isCurrent && (
            <p>{t('v2.honest.tillage')}{' '}
              <button type="button" className="ad-link" onClick={() => setScreen('sim')}>{t('v2.honest.tillageTry')}<ArrowUpRight size={15} aria-hidden="true" /></button>
            </p>
          )}
          {card.checkLocally?.length > 0 && (
            <>
              <button type="button" className="ad-link" aria-expanded={localOpen} aria-controls={localId} onClick={() => setLocalOpen(!localOpen)}>
                {t('optionsScreen.local.title', { count: card.checkLocally.length })}
                <ArrowDown size={15} aria-hidden="true" className={localOpen ? 'is-flipped' : undefined} />
              </button>
              {localOpen && (
                <ul className="ad-cols ad-cols-3 ad-local" id={localId}>
                  {card.checkLocally.map((k) => (
                    <li key={k}>
                      <span className="ad-strong">{t(`optionsScreen.local.item.${k}.what`)}</span>
                      <span className="ad-small">{t('optionsScreen.local.who', { who: t(`optionsScreen.local.item.${k}.who`) })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </Row>
    </section>
  );
}
