// Farm game ("Play" on the Farm simulator page): try a plan on your own field, one season at a time.
// Turn-based: pick this year's crop (and expert inputs), then a real past year of weather on this field plays out as a
// ~20 s time-lapse. Every number comes from the engine (gameWorker.js); the scene only draws those numbers.
// Lazy: this file, the scene and the worker load only when Play opens.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Play, Pause, FastForward, RotateCcw, ArrowRight, Hourglass, Volume2, VolumeX } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { useV2 } from '../state/useV2.js';
import { PlaceholderTag } from '../components/PlaceholderTag.jsx';
import { slotsFor, todayCrops, defaultControls, pastYears, CASH_CROPS, COVERS, START_YEAR } from '../sim/simSetup.js';
import { FEEDS } from '../data/v2Options.js';
import { buildMergedPlans } from '../data/mergedPlans.js';
import { makeV2Text } from '../data/v2Text.js';
import { outlineFor } from '../data/loadField.js';
import scoresConfig from '@content/v2-scores.json';
import { gradeOf } from '@scoring/v2/scores.js';
import { planToSim, takePlayPlan } from './playPlan.js';
import { createScene, draw } from './scene.js';
import './game.css';

const YEARS = 5;
const SEASON_SECONDS = 20;
const N_RATES = ['default', 0, 40, 80, 120];
const SHIFTS = [-14, 0, 14];
const TILLAGE = ['conventional', 'reduced', 'no-till'];
// Fixed weather sequences for the challenges (real past years on this field). Goals are checked on the engine's output.
const CHALLENGES = [
  { id: 'drought', years: [2009, 2010, 2011, 2012, 2013] },
  { id: 'soil', years: [2015, 2016, 2017, 2018, 2019] },
  { id: 'cover', years: [2019, 2020, 2021, 2022, 2023] },
];
const METERS = ['money', 'risk', 'soil', 'water', 'nutrients', 'pests', 'market', 'season'];
// Which model slots feed each meter (same map as the Options / Plans cards: data/v2Options.js FEEDS).
const METER_FEEDS = {
  money: FEEDS.profit, risk: FEEDS.score.risk, soil: FEEDS.score.soil, water: FEEDS.score.water, nutrients: FEEDS.score.nutrients,
  pests: [...new Set([...FEEDS.score.pests, ...FEEDS.fit.disease])], market: FEEDS.fit.market, season: FEEDS.fit.season,
};
const MODEL_FILES = import.meta.glob('../../../shared/v2/models/*.json');

const rand = (n) => Math.floor(Math.random() * n);
function pickYears(avail) {
  const pool = [...avail], out = [];
  while (out.length < YEARS && pool.length) out.push(pool.splice(rand(pool.length), 1)[0]);
  while (out.length < YEARS) out.push(avail[rand(avail.length)]);
  return out;
}
const levelOf = (value) => { const g = gradeOf(value, scoresConfig); return g === 'A' || g === 'B' ? 'good' : g === 'C' ? 'fair' : 'low'; };
const FIT_LEVEL = { pass: 'good', warn: 'fair', fail: 'low' };

function useReducedMotion() {
  const [calm, setCalm] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq?.addEventListener) return undefined;
    const on = (e) => setCalm(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return calm;
}

// ---------------------------------------------------------------------------------------------------------------- worker
function useGameWorker() {
  const ref = useRef(null), runId = useRef(0);
  const [state, setState] = useState({ status: 'idle', result: null, error: null });
  useEffect(() => {
    const w = new Worker(new URL('./gameWorker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      if (e.data.runId !== runId.current) return;
      if (e.data.type === 'result') setState({ status: 'ready', result: e.data, error: null });
      else setState({ status: 'error', result: null, error: e.data.message });
    };
    w.onerror = () => setState({ status: 'error', result: null, error: 'worker' });
    ref.current = w;
    return () => w.terminate();
  }, []);
  const run = (msg) => { const id = ++runId.current; setState((s) => ({ ...s, status: 'running' })); ref.current?.postMessage({ type: 'turn', runId: id, ...msg }); };
  const clear = () => { runId.current++; setState({ status: 'idle', result: null, error: null }); };
  return { ...state, run, clear };
}

// ---------------------------------------------------------------------------------------------------------------- meters
function meterView(plan, id) {
  if (!plan) return null;
  if (id === 'money') {
    const last = plan.seasons[plan.seasons.length - 1];
    return { ring: plan.scores.profit.value, level: plan.moneyTotal >= 0 ? 'good' : 'low', word: plan.moneyTotal >= 0 ? 'gain' : 'loss', money: last.money, total: plan.moneyTotal, reasons: plan.scores.profit.reasons };
  }
  if (['risk', 'soil', 'water', 'nutrients'].includes(id)) {
    const s = plan.scores[id];
    return { ring: s.value, level: levelOf(s.value), word: levelOf(s.value), value: s.value, reasons: s.reasons };
  }
  if (id === 'pests') {
    const s = plan.scores.pests, f = plan.fit.disease;
    const level = f.status === 'pass' ? levelOf(s.value) : FIT_LEVEL[f.status] === 'low' || levelOf(s.value) === 'low' ? 'low' : 'fair';
    return { ring: s.value, level, word: level, value: s.value, reasons: [f.evidence, ...s.reasons], fit: f.status };
  }
  const f = plan.fit[id];
  return { ring: 100, level: FIT_LEVEL[f.status], word: f.status, fit: f.status, reasons: [f.evidence] };
}

function Ring({ value, level }) {
  const r = 18, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <svg className="gm-ring" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r={r} className="gm-ring-bg" />
      <circle cx="22" cy="22" r={r} className={`gm-ring-fg lvl-${level ?? 'none'}`} strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 22 22)" />
    </svg>
  );
}

function Meters({ plan, prev, phSlots }) {
  const { t, lang } = useApp();
  const [open, setOpen] = useState(null);
  const panelId = useId();
  const text = useMemo(() => makeV2Text(t, lang), [t, lang]);
  const usd = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const views = Object.fromEntries(METERS.map((id) => [id, meterView(plan, id)]));
  const ph = (id) => METER_FEEDS[id].some((s) => phSlots.has(s));
  const o = open && views[open];
  const pv = open && meterView(prev, open);
  const trend = o && pv && o.value != null && pv.value != null ? Math.sign(o.value - pv.value) : o && pv && o.total != null ? Math.sign(o.total - pv.total) : null;
  return (
    <section className="gm-meters-wrap" aria-label={t('game.meters.title')}>
      <div className="gm-meters">
        {METERS.map((id) => {
          const v = views[id];
          return (
            <button key={id} type="button" className={`gm-meter${open === id ? ' is-open' : ''}`} aria-expanded={open === id} aria-controls={panelId} onClick={() => setOpen(open === id ? null : id)}>
              <span className="gm-meter-ring"><Ring value={v?.ring} level={v?.level} /><span className="gm-meter-num">{v ? (id === 'money' ? usd.format(v.money) : v.value ?? '') : '–'}</span></span>
              <span className="gm-meter-name">{t(`game.meter.${id}.name`)}{ph(id) && v && <Hourglass size={12} aria-label={t('v2.placeholderShort')} />}</span>
              <span className={`gm-meter-word lvl-${v?.level ?? 'none'}`}>{v ? t(`game.word.${v.word}`) : t('game.word.none')}</span>
            </button>
          );
        })}
      </div>
      {o && (
        <div className="gm-panel" id={panelId} role="region" aria-label={t(`game.meter.${open}.name`)}>
          <p className="gm-panel-head"><strong>{t(`game.meter.${open}.name`)}</strong>
            {open === 'money' ? ` · ${t('game.meter.money.value', { year: usd.format(o.money), total: usd.format(o.total) })}`
              : o.value != null ? ` · ${t('game.meter.score', { n: o.value })}` : ` · ${t(`game.word.${o.fit}`)}`}
            {trend != null && <span className="muted"> · {t(trend > 0 ? 'game.trend.up' : trend < 0 ? 'game.trend.down' : 'game.trend.same')}</span>}
          </p>
          <p className="small">{t(`game.meter.${open}.what`)}</p>
          <ul className="gm-reasons">{o.reasons.filter(Boolean).slice(0, 3).map((r, i) => <li key={i}>{text(r)}</li>)}</ul>
          {open === 'pests' && plan.seasons.length === 1 && <p className="small muted">{t('game.meter.pests.oneYear')}</p>}
          <p className="small muted">{t(`game.meter.${open}.src`)}</p>
          {ph(open) && <PlaceholderTag />}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- season player
function SeasonPlayer({ you, year, sign, extras, onDone, sound }) {
  const { t, lang } = useApp();
  const calm = useReducedMotion();
  const canvas = useRef(null), wrap = useRef(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [month, setMonth] = useState(0);
  const [done, setDone] = useState(false);
  const cur = useRef(0);
  const live = useRef({ playing: true, speed: 1 });
  live.current = { playing, speed };
  const day = you.day, days = day.rain.length;
  const cumEros = useMemo(() => { let s = 0; return day.eros.map((x) => (s += x)); }, [day]);
  const harvestDay = useMemo(() => { const h = you.events.filter((e) => e.kind === 'harvested'); return h.length ? h[h.length - 1].day : days - 1; }, [you, days]);
  const usd = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  // Pause when the tab is hidden.
  useEffect(() => {
    const on = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  useEffect(() => {
    const scene = createScene();
    let raf = 0, last = performance.now(), tSec = 0, shownMonth = -1, beeped = new Set();
    const ctx = canvas.current.getContext('2d');
    let audio = null;
    const beep = (f) => {
      if (!sound) return;
      try {
        audio ??= new (window.AudioContext || window.webkitAudioContext)();
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = f; g.gain.value = 0.05; o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.12);
      } catch { /* no sound */ }
    };
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (live.current.playing) { tSec += dt; cur.current = Math.min(days - 1, cur.current + dt * live.current.speed * (days / SEASON_SECONDS)); }
      const i = Math.floor(cur.current);
      const el = canvas.current;
      if (!el) return;
      const w = wrap.current.clientWidth, h = Math.round(Math.min(w * 0.85, 460));
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); el.style.height = `${h}px`; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const d = { rain: day.rain[i], tmax: day.tmax[i], rz: day.rz[i], rzCap: day.rzCap[i], stress: day.stress[i], canopy: day.canopy[i], ground: day.ground[i], residue: day.residue[i], stage: day.stage[i] };
      const act = (kind, span) => you.events.find((e) => e.kind === kind && i >= e.day && i < e.day + span);
      const till = act('tillage', 12), harv = act('harvested', 12), rev = act('revenue', 18);
      for (const e of [till, harv, rev]) if (e && !beeped.has(e)) { beeped.add(e); beep(e.kind === 'revenue' ? 880 : 220); }
      const m = new Date(Date.UTC(year, 0, 1 + i)).getUTCMonth();
      if (m !== shownMonth) { shownMonth = m; setMonth(m); }
      draw(ctx, w, h, {
        d, crop: you.dayCrop[i], month: m, erosSoFar: cumEros[i], T: you.toleranceT,
        machine: harv ? { kind: 'combine', p: (cur.current - harv.day) / 12 } : till ? { kind: 'tractor', p: (cur.current - till.day) / 12 } : null,
        pop: rev ? { text: `${rev.usd >= 0 ? '+' : '−'}${usd.format(Math.abs(rev.usd))}${t('game.perAcre')}`, p: (cur.current - rev.day) / 18 } : null,
        sign, t: tSec, calm, spots: extras.spots, frost: extras.frost && (m <= 3 || m >= 10),
      }, scene);
      if (cur.current >= days - 1) { setDone(true); setPlaying(false); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); try { audio?.close(); } catch { /* ignore */ } };
  }, [you, year, sign, calm, sound]); // eslint-disable-line react-hooks/exhaustive-deps

  const monthName = new Intl.DateTimeFormat(lang, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2001, month, 1)));
  return (
    <div className="gm-season">
      <div className="gm-stage" ref={wrap}>
        <canvas ref={canvas} className="gm-canvas" role="img" aria-label={t('game.scene.alt', { month: monthName })} />
        <span className="gm-month" aria-live="off">{monthName}</span>
      </div>
      <div className="gm-controls">
        <button type="button" className="btn btn-primary" onClick={() => { if (done) return; setPlaying(!playing); }} disabled={done}>
          {playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}{t(playing ? 'game.play.pause' : 'game.play.play')}
        </button>
        <div className="segmented gm-speed" role="group" aria-label={t('game.play.speed')}>
          {[1, 2].map((s) => <button type="button" key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{`${s}×`}</button>)}
        </div>
        <button type="button" className="btn" disabled={done} onClick={() => { cur.current = Math.max(cur.current, Math.min(days - 1, harvestDay + 14)); setPlaying(true); }}>
          <FastForward size={20} aria-hidden="true" />{t('game.play.skip')}
        </button>
      </div>
      {done && <button type="button" className="btn btn-primary btn-block" onClick={onDone}>{t('game.play.results')}<ArrowRight size={18} aria-hidden="true" /></button>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- choice card
function Choice({ label, value, options, onChange, disabled }) {
  return (
    <fieldset className="gm-choice" disabled={disabled}>
      <legend>{label}</legend>
      <div className="gm-options">
        {options.map(([v, text]) => <button type="button" key={String(v)} aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}
      </div>
    </fieldset>
  );
}

function ChoiceCard({ k, choice, setChoice, controls, setControls, expert, setExpert, irrigated, onGo }) {
  const { t } = useApp();
  const crop = (id) => t(`crops.${id}`);
  const locked = k > 0;
  return (
    <section className="card gm-card">
      <h2>{t('game.choose.title', { n: k + 1, total: YEARS })}</h2>
      <p className="small muted">{t('game.choose.hidden')}</p>
      <div className="segmented" role="group" aria-label={t('game.choose.mode')}>
        <button type="button" aria-pressed={!expert} onClick={() => setExpert(false)}>{t('game.choose.simple')}</button>
        <button type="button" aria-pressed={expert} onClick={() => setExpert(true)}>{t('game.choose.expert')}</button>
      </div>
      <Choice label={t('game.choose.crop')} value={choice.main} onChange={(v) => setChoice({ ...choice, main: v })} options={CASH_CROPS.map((id) => [id, crop(id)])} />
      <Choice label={t('game.choose.cover')} value={choice.cover} onChange={(v) => setChoice({ ...choice, cover: v })} options={[[null, t('sim.plan.noCover')], ...COVERS.map((id) => [id, crop(id)])]} />
      <Choice label={t('game.choose.tillage')} value={controls.tillage} disabled={locked} onChange={(v) => setControls({ ...controls, tillage: v })} options={TILLAGE.map((v) => [v, t(`sim.in.tillageOpt.${v}`)])} />
      {expert && (
        <>
          <Choice label={t('sim.in.nitrogen')} value={controls.nitrogen} disabled={locked} onChange={(v) => setControls({ ...controls, nitrogen: v })} options={N_RATES.map((v) => [v, v === 'default' ? t('sim.in.nDefault') : t('sim.in.nRate', { n: v })])} />
          {irrigated
            ? <Choice label={t('sim.in.irrigation')} value={controls.irrigation} disabled={locked} onChange={(v) => setControls({ ...controls, irrigation: v })} options={['none', 'limited', 'full'].map((v) => [v, t(`sim.in.irrOpt.${v}`)])} />
            : <p className="small muted">{t('game.choose.dryland')}</p>}
          <Choice label={t('sim.in.shift')} value={controls.shiftDays} disabled={locked} onChange={(v) => setControls({ ...controls, shiftDays: v })} options={SHIFTS.map((v) => [v, v === 0 ? t('sim.in.shiftNormal') : v < 0 ? t('sim.in.shiftEarly', { n: -v }) : t('sim.in.shiftLate', { n: v })])} />
        </>
      )}
      <p className="small muted">{t(locked ? 'game.choose.locked' : 'game.choose.lockNote')}</p>
      <button type="button" className="btn btn-primary btn-block" onClick={onGo}>{t('game.choose.go')}<ArrowRight size={18} aria-hidden="true" /></button>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- results
function whyOf(s) {
  const c = s.crops[0];
  if (!c) return { key: 'game.why.noCash' };
  if (c.killed) return { key: 'game.why.killed', params: { crop: c.crop } };
  if (c.yieldVsTypical != null && c.yieldVsTypical < 0.8) {
    if (c.pestLoss >= 0.1 && c.pestLoss * 100 > c.waterStressDays) return { key: 'game.why.pests', params: { crop: c.crop, pct: Math.round(c.pestLoss * 100) } };
    if (c.heatDays > c.waterStressDays) return { key: 'game.why.heat', params: { crop: c.crop, n: c.heatDays } };
    return { key: 'game.why.dry', params: { crop: c.crop, n: c.waterStressDays } };
  }
  return { key: 'game.why.steady', params: { crop: c.crop, pct: c.yieldVsTypical != null ? Math.round(c.yieldVsTypical * 100) : '–' } };
}

function fitEvents(plan) {
  const out = [];
  const f = plan.fit;
  if (f.water.status === 'fail') out.push({ id: 'water', ev: f.water.evidence });
  if (f.disease.status !== 'pass') {
    const rep = f.disease.evidence.key === 'v2.fit.disease.warnFamilyRepeat' ? f.disease.evidence.params : null;
    out.push({ id: rep ? 'diseaseRepeat' : 'disease', ev: f.disease.evidence, params: rep ?? {} });
  }
  if (f.market.status !== 'pass') out.push({ id: f.market.status === 'fail' ? 'marketFail' : 'marketWarn', ev: f.market.evidence, params: { crop: f.market.evidence.params?.crop } });
  if (f.season.status === 'fail') out.push({ id: 'season', ev: f.season.evidence });
  return out;
}

function Results({ you, k, yearType, phSlots, onNext, last }) {
  const { t, lang } = useApp();
  const text = useMemo(() => makeV2Text(t, lang), [t, lang]);
  const s = you.seasons[k];
  const usd = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const num = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const why = whyOf(s);
  const crop = (id) => t(`crops.${id}`);
  const yieldPh = FEEDS.profit.some((x) => phSlots.has(x));
  return (
    <section className="card gm-card gm-results">
      <h2>{t('game.results.title', { n: k + 1, year: s.weatherYear })}</h2>
      <p className="small">{yearType && <>{t(`game.yearType.${yearType}`)} </>}{phSlots.has('modelC') && <PlaceholderTag />}</p>
      <div className="tiles">
        {s.crops.length ? s.crops.map((c) => (
          <div className="tile" key={c.crop}>
            <span className="tile-label">{crop(c.crop)}</span>
            <span className="tile-value">{num.format(c.yield)} <small>{c.unit}</small></span>
            <span className="tile-note">{c.yieldVsTypical != null ? t('game.results.vsTypical', { pct: Math.round(c.yieldVsTypical * 100) }) : ''}</span>
          </div>
        )) : <div className="tile"><span className="tile-label">{t('game.results.yield')}</span><span className="tile-value">–</span></div>}
        <div className="tile"><span className="tile-label">{t('game.results.money')}</span><span className="tile-value">{usd.format(s.money)}</span><span className="tile-note">{t('game.results.perAcre')}</span></div>
        <div className="tile"><span className="tile-label">{t('game.results.soil')}</span><span className="tile-value">{num.format(s.erosion ?? 0)} t</span><span className="tile-note">{t('game.results.vsT', { t: num.format(s.toleranceT) })}</span></div>
        <div className="tile"><span className="tile-label">{t('game.results.rain')}</span><span className="tile-value">{num.format((s.rainMm ?? 0) / 25.4)} in</span><span className="tile-note">{t('game.results.bare', { n: s.bareDays ?? 0 })}</span></div>
      </div>
      {yieldPh && <p className="small"><PlaceholderTag /> {t('game.results.yieldPh')}</p>}
      <p className="gm-why">{t(why.key, { ...why.params, crop: why.params?.crop ? crop(why.params.crop).toLowerCase() : '' })}</p>
      <p className="small muted">{t(s.weatherSource === 'climatology' ? 'game.results.srcClimatology' : 'game.results.src', { year: s.weatherYear })}</p>
      {fitEvents(you).length > 0 && (
        <ul className="gm-events">
          {fitEvents(you).map((e) => (
            <li key={e.id}>
              <details>
                <summary>{t(`game.event.${e.id}`, { crop: e.params?.crop ? crop(e.params.crop) : '', nextCrop: e.params?.nextCrop ? crop(e.params.nextCrop).toLowerCase() : '' })}</summary>
                <p className="small">{text(e.ev)}</p>
                <p className="small muted">{t(`game.eventSrc.${e.id}`)}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={onNext}>{t(last ? 'game.results.end' : 'game.results.next')}<ArrowRight size={18} aria-hidden="true" /></button>
    </section>
  );
}

function challengeMet(id, you, today) {
  if (!you || !today) return null;
  if (id === 'drought') return you.moneyTotal > today.moneyTotal;
  if (id === 'soil') return you.seasons.every((s) => s.erosion != null && s.erosion <= s.toleranceT);
  if (id === 'cover') {
    const avg = (p) => p.seasons.reduce((a, s) => a + (s.bareDays ?? 0), 0) / p.seasons.length;
    return avg(you) < avg(today);
  }
  return null;
}

function EndScreen({ result, mode, phSlots, onAgain, onNew }) {
  const { t, lang } = useApp();
  const usd = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const cols = ['you', 'today', 'best'].map((id) => result.plans.find((p) => p.id === id)).filter(Boolean);
  const cell = (p, id) => {
    const v = meterView(p, id);
    if (id === 'money') return <>{usd.format(v.total)}<span className={`gm-word lvl-${v.level}`}>{t(`game.word.${v.word}`)}</span></>;
    return <>{v.value != null ? v.value : ''}<span className={`gm-word lvl-${v.level}`}>{t(`game.word.${v.word}`)}</span></>;
  };
  const met = mode.kind === 'challenge' ? challengeMet(mode.id, cols[0], result.plans.find((p) => p.id === 'today')) : null;
  return (
    <section className="card gm-card gm-end">
      <h2>{t('game.end.title')}</h2>
      {met != null && <p className={`gm-goal ${met ? 'lvl-good' : 'lvl-low'}`}>{t(met ? 'game.end.goalMet' : 'game.end.goalMissed', { goal: t(`game.challenge.${mode.id}.goal`) })}</p>}
      <p className="small muted">{t('game.end.sameWeather', { years: result.plans[0].seasons.map((s) => s.weatherYear).join(', ') })}</p>
      <div className="gm-table-wrap">
        <table className="gm-table">
          <thead><tr><th scope="col">{t('game.end.meter')}</th>{cols.map((p) => <th scope="col" key={p.id}>{t(`game.end.col.${p.id}`)}</th>)}</tr></thead>
          <tbody>
            {METERS.map((id) => (
              <tr key={id}><th scope="row">{t(`game.meter.${id}.name`)}{METER_FEEDS[id].some((s) => phSlots.has(s)) && <Hourglass size={12} aria-label={t('v2.placeholderShort')} />}</th>{cols.map((p) => <td key={p.id}>{cell(p, id)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {!cols.find((p) => p.id === 'best') && <p className="small muted">{t('game.end.noBest')}</p>}
      <p className="small muted">{t('game.end.moneyNote')}</p>
      {phSlots.size > 0 && <p className="small"><PlaceholderTag /> {t('game.end.phNote')}</p>}
      <div className="gm-row">
        <button type="button" className="btn btn-primary" onClick={onAgain}><RotateCcw size={18} aria-hidden="true" />{t('game.end.again')}</button>
        <button type="button" className="btn" onClick={onNew}>{t('game.end.another')}</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- the game
export default function FarmGame() {
  const { t, field, farm, tillage } = useApp();
  const v2 = useV2();
  const worker = useGameWorker();
  const slots = useMemo(() => (field ? slotsFor(field) : null), [field]);
  const avail = useMemo(() => (field ? pastYears(field) : []), [field]);
  const fieldId = field?.field?.id;
  const [modelFile, setModelFile] = useState(null);
  const [phase, setPhase] = useState('start');
  const [mode, setMode] = useState({ kind: 'free' });
  const [loaded, setLoaded] = useState(null); // { name, sim } from Plans / Compare
  const [weatherYears, setWeatherYears] = useState([]);
  const [choices, setChoices] = useState([]);
  const [choice, setChoice] = useState({ main: 'grain_sorghum', cover: null });
  const [controls, setControls] = useState(defaultControls());
  const [expert, setExpert] = useState(false);
  const [k, setK] = useState(0);
  const [sound, setSound] = useState(false);
  const prevRes = useRef(null);
  const irrigated = farm.waterMode === 'irrigated';

  // A model file for this field, when one has been delivered: its slots replace the placeholders and the tags go away.
  useEffect(() => {
    let live = true;
    const load = fieldId && MODEL_FILES[`../../../shared/v2/models/${fieldId}.json`];
    if (!load) { setModelFile(null); return undefined; }
    load().then((m) => { if (live) setModelFile(m.default); }).catch(() => { if (live) setModelFile(null); });
    return () => { live = false; };
  }, [fieldId]);

  // "Play this plan" from Plans / Compare.
  useEffect(() => {
    const option = takePlayPlan();
    if (option) setLoaded({ id: option.id, sim: planToSim(option) });
  }, []);

  const todayPlan = useMemo(() => (field && slots ? { id: 'today', crops: todayCrops(field, slots), controls: { ...defaultControls(), ...(tillage ? { tillage } : {}) } } : null), [field, slots, tillage]);
  const bestPlan = useMemo(() => {
    if (v2.status !== 'ready' || v2.usingSample) return null;
    const best = buildMergedPlans(v2.data, farm).best?.option;
    if (!best) return null;
    const s = planToSim(best);
    return { id: 'best', crops: s.crops, controls: s.controls, nitrogenScale: s.nitrogenScale };
  }, [v2, farm]);

  const prefill = (i) => (loaded && mode.kind === 'plan' ? loaded.sim.crops[i % loaded.sim.crops.length] : choices[i - 1] ?? { main: 'grain_sorghum', cover: null });

  function startGame(nextMode, years) {
    setMode(nextMode);
    setWeatherYears(years);
    setChoices([]); setK(0); prevRes.current = null; worker.clear();
    setControls(loaded && nextMode.kind === 'plan' ? { ...loaded.sim.controls } : { ...defaultControls(), ...(tillage ? { tillage } : {}) });
    setChoice(nextMode.kind === 'plan' && loaded ? loaded.sim.crops[0] : { main: 'grain_sorghum', cover: null });
    setPhase('choose');
  }

  function playYear() {
    const next = [...choices.slice(0, k), choice];
    setChoices(next);
    prevRes.current = worker.result;
    const ctl = { ...controls, irrigation: irrigated ? controls.irrigation : 'none' };
    const you = { id: 'you', crops: next, controls: ctl, nitrogenScale: mode.kind === 'plan' ? loaded?.sim.nitrogenScale : undefined };
    const plans = [you, todayPlan, ...(k === YEARS - 1 && bestPlan ? [bestPlan] : [])];
    worker.run({ field, modelFile, plans, weatherYears: weatherYears.slice(0, k + 1), animate: 'you' });
    setPhase('season');
  }

  function nextYear() {
    if (k >= YEARS - 1) { setPhase('end'); return; }
    setK(k + 1);
    setChoice(prefill(k + 1));
    setPhase('choose');
  }

  if (!field) return <p className="muted">{t('common.noField')}</p>;
  const res = worker.status === 'ready' ? worker.result : null;
  const you = res?.plans.find((p) => p.id === 'you');
  // The meters change only after the season has played: while it plays they show the years before it.
  const meterPlan = phase === 'season' ? prevRes.current?.plans?.find((p) => p.id === 'you') : worker.result?.plans?.find((p) => p.id === 'you');
  const phSlots = new Set(res?.placeholderSlots ?? slots?.placeholderSlots ?? []);
  const acres = outlineFor(fieldId)?.acres;
  const sign = t('game.sign', { county: field.field.county, acres: acres ?? '–' });
  const challengeYears = (c) => c.years.every((y) => avail.includes(y));
  const extras = you ? { spots: you.fit.disease.status !== 'pass', frost: you.fit.season.status === 'fail' || you.seasons[k]?.crops.some((c) => c.killed === 'frost') } : {};

  return (
    <div className="gm">
      <p className="gm-banner" role="note">{t('game.banner')}</p>
      {phase !== 'start' && phase !== 'end' && (
        <>
          <p className="gm-progress">{t('game.progress', { n: k + 1, total: YEARS })}{mode.kind === 'challenge' && ` · ${t(`game.challenge.${mode.id}.name`)}`}</p>
          <Meters plan={meterPlan ?? null} prev={phase === 'season' ? null : prevRes.current?.plans?.find((p) => p.id === 'you')} phSlots={phSlots} />
        </>
      )}

      {phase === 'start' && (
        <section className="card gm-card">
          <h2>{t('game.start.title')}</h2>
          <p>{t('game.start.intro')}</p>
          {loaded && (
            <div className="gm-loaded">
              <p><strong>{t('game.start.loaded')}</strong> {loaded.sim.crops.map((c) => t(`crops.${c.main}`)).join(' → ')}</p>
              {loaded.sim.notes.map((n) => <p key={n} className="small muted">{t(`game.planNote.${n}`)}</p>)}
              <button type="button" className="btn btn-primary btn-block" onClick={() => startGame({ kind: 'plan' }, pickYears(avail))}>{t('game.start.playLoaded')}</button>
            </div>
          )}
          <button type="button" className={`btn btn-block${loaded ? '' : ' btn-primary'}`} onClick={() => startGame({ kind: 'free' }, pickYears(avail))}>{t('game.start.free')}</button>
          <h3>{t('game.start.challenges')}</h3>
          <ul className="gm-challenges">
            {CHALLENGES.filter(challengeYears).map((c) => (
              <li key={c.id}>
                <button type="button" className="btn btn-block gm-challenge" onClick={() => startGame({ kind: 'challenge', id: c.id }, c.years)}>
                  <strong>{t(`game.challenge.${c.id}.name`)}</strong>
                  <span className="small">{t(`game.challenge.${c.id}.goal`)}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="chip gm-sound" aria-pressed={sound} onClick={() => setSound(!sound)}>
            {sound ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}{t(sound ? 'game.sound.on' : 'game.sound.off')}
          </button>
        </section>
      )}

      {phase === 'choose' && (
        <ChoiceCard k={k} choice={choice} setChoice={setChoice} controls={controls} setControls={setControls} expert={expert} setExpert={setExpert} irrigated={irrigated} onGo={playYear} />
      )}

      {phase === 'season' && worker.status === 'running' && <p className="muted" role="status">{t('game.running')}</p>}
      {phase === 'season' && worker.status === 'error' && <p className="sheet-note sheet-warn" role="alert">{t('game.error')}{worker.error && worker.error !== 'worker' ? ` (${worker.error})` : ''}</p>}
      {phase === 'season' && you && (
        <>
          <p className="gm-weather">{t('game.weatherOf', { year: weatherYears[k] })}{res.yearTypes[k] && <> · {t(`game.yearType.${res.yearTypes[k]}`)}</>} {phSlots.has('modelC') && <PlaceholderTag />}</p>
          <SeasonPlayer key={k} you={you} year={START_YEAR + k} sign={sign} extras={extras} sound={sound} onDone={() => setPhase('results')} />
        </>
      )}
      {phase === 'results' && you && <Results you={you} k={k} yearType={res.yearTypes[k]} phSlots={phSlots} last={k >= YEARS - 1} onNext={nextYear} />}
      {phase === 'end' && res && (
        <EndScreen result={res} mode={mode} phSlots={phSlots}
          onAgain={() => startGame(mode, weatherYears)}
          onNew={() => { setPhase('start'); }} />
      )}
    </div>
  );
}
