// After a season: one card per plot with the 8 meters (ring + word), a winner badge and one plain "why" with its source.
// Meter values are the same scores and fit checks as the Plans cards (scoring/v2), over the seasons played so far.
import { useId, useMemo, useState } from 'react';
import { Trophy, Hourglass, ArrowRight } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { PlaceholderTag } from '../components/PlaceholderTag.jsx';
import { FEEDS } from '../data/v2Options.js';
import { makeV2Text } from '../data/v2Text.js';
import scoresConfig from '@content/v2-scores.json';
import { gradeOf } from '@scoring/v2/scores.js';

export const METERS = ['money', 'risk', 'soil', 'water', 'nutrients', 'pests', 'market', 'season'];
// Which model slots feed each meter (same map as the Options / Plans cards: data/v2Options.js FEEDS).
export const METER_FEEDS = {
  money: FEEDS.profit, risk: FEEDS.score.risk, soil: FEEDS.score.soil, water: FEEDS.score.water, nutrients: FEEDS.score.nutrients,
  pests: [...new Set([...FEEDS.score.pests, ...FEEDS.fit.disease])], market: FEEDS.fit.market, season: FEEDS.fit.season,
};
const SCORE_IDS = ['profit', 'risk', 'soil', 'water', 'nutrients', 'pests'];
const levelOf = (value) => { const g = gradeOf(value, scoresConfig); return g === 'A' || g === 'B' ? 'good' : g === 'C' ? 'fair' : 'low'; };
const FIT_LEVEL = { pass: 'good', warn: 'fair', fail: 'low' };

export function meterView(run, id) {
  if (!run) return null;
  if (id === 'money') {
    const s = run.scores.profit;
    return { ring: s.value, level: run.moneyTotal >= 0 ? 'good' : 'low', word: run.moneyTotal >= 0 ? 'gain' : 'loss', value: s.value, reasons: s.reasons };
  }
  if (['risk', 'soil', 'water', 'nutrients'].includes(id)) {
    const s = run.scores[id];
    return { ring: s.value, level: levelOf(s.value), word: levelOf(s.value), value: s.value, reasons: s.reasons };
  }
  if (id === 'pests') {
    const s = run.scores.pests, f = run.fit.disease;
    const level = f.status === 'pass' ? levelOf(s.value) : FIT_LEVEL[f.status] === 'low' || levelOf(s.value) === 'low' ? 'low' : 'fair';
    return { ring: s.value, level, word: level, value: s.value, reasons: [f.evidence, ...s.reasons] };
  }
  const f = run.fit[id];
  return { ring: 100, level: FIT_LEVEL[f.status], word: f.status, reasons: [f.evidence] };
}

/** Best plot = highest average of the six 0-100 scores (profit, risk, soil, water, nutrients, pests). */
export const overall = (run) => SCORE_IDS.reduce((a, id) => a + run.scores[id].value, 0) / SCORE_IDS.length;
export const winnerOf = (runs) => runs.reduce((b, r, i) => (overall(r) > overall(runs[b]) ? i : b), 0);

export function Ring({ value, level, size = 40 }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <svg className="gm-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} className="gm-ring-bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className={`gm-ring-fg lvl-${level ?? 'none'}`} strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

/** The one main reason this season went the way it did, from the season's own crop numbers. */
export function whyOf(s) {
  const c = s.crops[0];
  if (!c) return { key: 'game.why.noCash', src: 'game.whySrc.money' };
  if (c.killed) return { key: 'game.why.killed', params: { crop: c.crop }, src: 'game.whySrc.frost' };
  if (c.yieldVsTypical != null && c.yieldVsTypical < 0.8) {
    if (c.pestLoss >= 0.1 && c.pestLoss * 100 > c.waterStressDays) return { key: 'game.why.pests', params: { crop: c.crop, pct: Math.round(c.pestLoss * 100) }, src: 'game.whySrc.pests' };
    if (c.heatDays > c.waterStressDays) return { key: 'game.why.heat', params: { crop: c.crop, n: c.heatDays }, src: 'game.whySrc.heat' };
    return { key: 'game.why.dry', params: { crop: c.crop, n: c.waterStressDays }, src: 'game.whySrc.water' };
  }
  return { key: 'game.why.steady', params: { crop: c.crop, pct: c.yieldVsTypical != null ? Math.round(c.yieldVsTypical * 100) : '–' }, src: 'game.whySrc.yield' };
}

function PlotCard({ run, n, k, winner, usd, phSlots }) {
  const { t, lang } = useApp();
  const [open, setOpen] = useState(null);
  const panelId = useId();
  const text = useMemo(() => makeV2Text(t, lang), [t, lang]);
  const s = run.seasons[k];
  const why = whyOf(s);
  const crop = (id) => t(`crops.${id}`);
  const ph = (id) => METER_FEEDS[id].some((x) => phSlots.has(x));
  const o = open && meterView(run, open);
  return (
    <article className={`gm-plotcard${winner ? ' is-winner' : ''}`} aria-label={t('game.plotN', { n: n + 1 })}>
      <header className="gm-plotcard-head">
        <span className="gm-pop-plot">{n + 1}</span>
        <strong>{s.crops.length ? s.crops.map((c) => crop(c.crop)).join(', ') : t('crops.fallow')}</strong>
        {winner && <span className="gm-winner"><Trophy size={14} aria-hidden="true" />{t('game.board.winner')}</span>}
        <span className={`gm-plotcard-money ${s.money >= 0 ? 'lvl-good' : 'lvl-low'}`}>{usd(s.money)}<small>{t('game.perAcre')}</small></span>
      </header>
      <div className="gm-meters">
        {METERS.map((id) => {
          const v = meterView(run, id);
          return (
            <button key={id} type="button" className={`gm-meter${open === id ? ' is-open' : ''}`} aria-expanded={open === id} aria-controls={panelId} onClick={() => setOpen(open === id ? null : id)}>
              <span className="gm-meter-ring"><Ring value={v.ring} level={v.level} /><span className="gm-meter-num">{v.value ?? ''}</span></span>
              <span className="gm-meter-name">{t(`game.meter.${id}.name`)}{ph(id) && <Hourglass size={12} aria-label={t('v2.placeholderShort')} />}</span>
              <span className={`gm-meter-word lvl-${v.level}`}>{t(`game.word.${v.word}`)}</span>
            </button>
          );
        })}
      </div>
      {o && (
        <div className="gm-panel" id={panelId} role="region" aria-label={t(`game.meter.${open}.name`)}>
          <p className="small">{t(`game.meter.${open}.what`)}</p>
          <ul className="gm-reasons">{o.reasons.filter(Boolean).slice(0, 3).map((r, i) => <li key={i}>{text(r)}</li>)}</ul>
          <p className="small muted">{t(`game.meter.${open}.src`)}</p>
          {ph(open) && <PlaceholderTag />}
        </div>
      )}
      <p className="gm-why">{t(why.key, { ...why.params, crop: why.params?.crop ? crop(why.params.crop).toLowerCase() : '' })}</p>
      <p className="small muted">{t(why.src)}</p>
    </article>
  );
}

export function Scoreboard({ runs, k, last, onNext, usd, top = 0 }) {
  const { t } = useApp();
  const phSlots = new Set(runs[0].placeholderSlots ?? []);
  const win = winnerOf(runs);
  return (
    <section className="gm-board" style={{ top }} aria-label={t('game.board.title', { year: runs[0].seasons[k].weatherYear })}>
      <div className="gm-board-inner">
        <h2>{t('game.board.title', { year: runs[0].seasons[k].weatherYear })}</h2>
        <p className="small">{t('game.board.intro')}</p>
        {runs.map((r, i) => <PlotCard key={i} run={r} n={i} k={k} winner={i === win} usd={usd} phSlots={phSlots} />)}
        <p className="small muted">{t('game.board.winnerNote')}</p>
        {phSlots.size > 0 && <p className="small"><PlaceholderTag /> {t('game.board.phNote')}</p>}
      </div>
      <div className="gm-board-foot">
        <button type="button" className="btn btn-primary btn-block" onClick={onNext}>{t(last ? 'game.results.end' : 'game.results.next')}<ArrowRight size={18} aria-hidden="true" /></button>
      </div>
    </section>
  );
}
