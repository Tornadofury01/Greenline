// The season playing out: one real past year on all 4 plots at once, each plot drawn from its own daily numbers.
// Speed 1x / 2x, skip to the next harvest, tap a plot for its live mini-meters, pop-ups for what happened (with source).
import { useEffect, useMemo, useRef, useState } from 'react';
import { FastForward, X } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { libById } from './plots.js';
import { GameCanvas } from './GameCanvas.jsx';
import { spawnCoins } from './scene.js';
import { buildSeason, frameAt, coinsAt, liveMeters, monthOf } from './season.js';

const SEASON_SECONDS = 26;   // one year at 1x
const POP_SECONDS = 3.2;

function beeper() {
  let audio = null;
  return {
    beep(f, on) {
      if (!on) return;
      try {
        audio ??= new (window.AudioContext || window.webkitAudioContext)();
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = f; g.gain.value = 0.04; o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.1);
      } catch { /* no sound */ }
    },
    close() { try { audio?.close(); } catch { /* ignore */ } },
  };
}

export function SeasonView({ runs, prevRuns, coinsBefore, plots, labels, playing, setPlaying, onMonth, onCoins, onDone, sound, calm, accent, hudRef, coinRef, usd, done }) {
  const { t, lang } = useApp();
  const S = useMemo(() => buildSeason({ runs, prevRuns, coinsBefore, plots }), [runs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [speed, setSpeed] = useState(1);
  const [pop, setPop] = useState(null);
  const [sel, setSel] = useState(-1);
  const [tick, setTick] = useState(0);          // re-render the mini-meters a few times a second
  const cur = useRef(0), evIdx = useRef(0), popUntil = useRef(0), queue = useRef([]), lastMonth = useRef(-1), lastCoins = useRef(null), lastTick = useRef(0);
  const live = useRef({ playing, speed, sound, done });
  live.current = { playing, speed, sound, done };
  const api = useRef(null), barRef = useRef(null);
  const snd = useMemo(beeper, []);
  useEffect(() => () => snd.close(), [snd]);

  // Pause when the tab is hidden.
  useEffect(() => {
    const on = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [setPlaying]);

  const coinTarget = () => {
    const c = coinRef.current?.getBoundingClientRect(), box = api.current && document.querySelector('.gm-canvas')?.getBoundingClientRect();
    return c && box ? [c.left - box.left + c.width / 2, c.top - box.top + c.height / 2] : [40, 20];
  };

  const getFrame = (dt, L, tSec) => {
    const { playing: on, speed: sp } = live.current;
    if (on && !live.current.done) cur.current = Math.min(S.days - 1, cur.current + dt * sp * (S.days / SEASON_SECONDS));
    const day = cur.current;
    // events reached today
    while (evIdx.current < S.events.length && S.events[evIdx.current].day <= day) {
      const e = S.events[evIdx.current++];
      if (e.harvest && api.current) {
        spawnCoins(api.current.scene, api.current.L, e.plot, Math.max(1, Math.min(12, Math.round(e.usd / 40))), coinTarget(), tSec, calm);
        snd.beep(880, live.current.sound);
      }
      queue.current.push(e);
      if (queue.current.length > 3) queue.current = queue.current.filter((x, n) => x.harvest || n >= queue.current.length - 3);
    }
    if (tSec >= popUntil.current) {
      // pop-ups more than a month old (after a skip) are dropped, harvests always show
      queue.current = queue.current.filter((x) => x.harvest || x.day >= day - 30);
      const next = queue.current.shift();
      if (next) { popUntil.current = tSec + POP_SECONDS; setPop(next); } else if (popUntil.current) { popUntil.current = 0; setPop(null); }
    }
    const m = monthOf(Math.floor(day));
    if (m !== lastMonth.current) { lastMonth.current = m; onMonth(m); }
    const coins = Math.round(coinsAt(S, day).reduce((a, x) => a + x, 0));
    if (coins !== lastCoins.current) { lastCoins.current = coins; onCoins(coins); }
    if (tSec - lastTick.current > 0.25) { lastTick.current = tSec; setTick((x) => x + 1); }
    if (day >= S.days - 1 && !live.current.done) { live.current.done = true; onDone(); }
    const f = frameAt(S, day, labels);
    return { mode: 'season', ...f, calm, selected: sel, flag: pop?.plot ?? -1, accent };
  };

  const skip = () => {
    const next = S.harvestDays.find((d) => d > cur.current + 1);
    cur.current = next != null ? Math.max(cur.current, next - 2) : S.days - 1;
    setPlaying(true);
  };

  const pads = () => ({ top: (hudRef.current?.offsetHeight ?? 90) + 24, bottom: (barRef.current?.offsetHeight ?? 130) + 8 });
  const lm = sel >= 0 ? liveMeters(S, sel, cur.current) : null;
  void tick;
  const crop = (id) => (id ? t(`crops.${id}`) : t('game.live.noCrop'));
  const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  const num1 = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const popText = pop && popLine(t, lang, pop, usd);

  return (
    <>
      <GameCanvas getFrame={getFrame} onTap={(i) => setSel(sel === i ? -1 : i)} pads={pads} api={api} label={t('game.scene.alt')} />
      <div className="gm-pop-slot" aria-live="polite" style={{ top: (hudRef.current?.offsetHeight ?? 120) + 6 }}>
        {pop && (
          <div className={`gm-pop${pop.harvest ? ' is-harvest' : ''}`} key={`${pop.key}-${pop.day}-${pop.plot}`}>
            <p className="gm-pop-text">{pop.plot >= 0 && <span className="gm-pop-plot">{pop.plot + 1}</span>}{popText}</p>
            <p className="gm-pop-src">{t(`game.src.${pop.src}`)}</p>
          </div>
        )}
      </div>
      <div className="gm-bottom gm-season-bar" ref={barRef}>
        {lm && (
          <div className="gm-live" role="region" aria-label={t('game.live.title', { n: sel + 1 })}>
            <div className="gm-tray-head">
              <strong>{t('game.plotN', { n: sel + 1 })} · {crop(lm.crop)}{lm.crop && libById[lm.crop]?.kind === 'cash' ? ` · ${t('game.live.stage', { pct: pct(Math.min(1, lm.stage)) })}` : ''}</strong>
              <button type="button" className="gm-icon-btn" aria-label={t('common.close')} onClick={() => setSel(-1)}><X size={20} aria-hidden="true" /></button>
            </div>
            <dl className="gm-live-grid">
              <div><dt>{t('game.live.water')}</dt><dd>{pct(lm.water)}</dd><Bar v={lm.water} /></div>
              <div><dt>{t('game.live.cover')}</dt><dd>{pct(lm.cover)}</dd><Bar v={lm.cover} /></div>
              <div><dt>{t('game.live.soil')}</dt><dd>{t('game.live.soilVal', { t: num1.format(lm.soil), max: num1.format(lm.T) })}</dd><Bar v={1 - lm.soil / lm.T} /></div>
              <div><dt>{t('game.live.n')}</dt><dd>{pct(lm.n)}</dd><Bar v={lm.n} /></div>
              <div><dt>{t('game.live.pest')}</dt><dd>{lm.pest == null ? '–' : t('game.live.pestVal', { pct: Math.round(lm.pest * 100) })}</dd><Bar v={lm.pest == null ? null : 1 - lm.pest / 0.2} /></div>
              <div><dt>{t('game.live.money')}</dt><dd>{usd(lm.money)}</dd></div>
            </dl>
          </div>
        )}
        {!lm && <p className="gm-cost">{t('game.live.hint')}</p>}
        <div className="gm-actions">
          <div className="segmented gm-speed" role="group" aria-label={t('game.play.speed')}>
            {[1, 2].map((s) => <button type="button" key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{`${s}×`}</button>)}
          </div>
          <button type="button" className="btn gm-start" onClick={skip} disabled={done}><FastForward size={18} aria-hidden="true" />{t('game.play.skip')}</button>
        </div>
      </div>
    </>
  );
}

function Bar({ v }) {
  if (v == null) return null;
  const x = Math.max(0, Math.min(1, v));
  return <span className="gm-bar" aria-hidden="true"><span style={{ width: `${x * 100}%` }} className={x > 0.6 ? 'lvl-good' : x > 0.3 ? 'lvl-fair' : 'lvl-low'} /></span>;
}

function popLine(t, lang, e, usd) {
  const month = (m) => new Intl.DateTimeFormat(lang, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2001, m, 1)));
  const date = (d) => new Intl.DateTimeFormat(lang, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2001, 0, 1 + d)));
  const num1 = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const crop = (id) => (id ? t(`crops.${id}`).toLowerCase() : '');
  const p = e.params;
  switch (e.key) {
    case 'heat': return t('game.ev.heat', { month: month(p.month), n: p.n });
    case 'rain': return t('game.ev.rain', { date: date(p.day), inches: num1.format(p.inches), tons: num1.format(p.tons) });
    case 'rainNoLoss': return t('game.ev.rainNoLoss', { date: date(p.day), inches: num1.format(p.inches) });
    case 'dry': return t('game.ev.dry', { crop: crop(p.crop) });
    case 'pest': return t('game.ev.pest', { crop: crop(p.crop), pest: p.pest ? t(`game.pest.${p.pest}`) : t('game.pest.any'), pct: Math.round(p.pct * 100) });
    case 'lowN': return t('game.ev.lowN', { crop: crop(p.crop) });
    case 'frost': return t('game.ev.frost', { crop: crop(p.crop) });
    case 'harvest': return t('game.ev.harvest', { crop: crop(p.crop), units: num1.format(p.units ?? 0), unit: libById[p.crop]?.defaults?.yieldUnit ?? '', usd: usd(p.usd) });
    default: return '';
  }
}
