// Farm game ("Play" on the Farm simulator page): 4 plots on your own field, 5 seasons of real past weather.
// Set up each plot with the toolbar (seed, cover, tillage, fertilizer, irrigation), start the season, and watch every plot
// grow from ITS OWN daily engine run. Every number comes from the engine (gameWorker.js); the scene only draws those numbers.
// Lazy: this file, the scene and the workers load only when Play opens.
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Volume2, VolumeX, Coins, Pause, Play, ArrowRight } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { useV2 } from '../state/useV2.js';
import { slotsFor, todayCrops, pastYears } from '../sim/simSetup.js';
import { buildMergedPlans } from '../data/mergedPlans.js';
import { planToSim, takePlayPlan } from './playPlan.js';
import { GameCanvas } from './GameCanvas.jsx';
import { Toolbar } from './Toolbar.jsx';
import { SeasonView } from './SeasonView.jsx';
import { Scoreboard } from './Scoreboard.jsx';
import { EndScreen, Stars } from './EndScreen.jsx';
import { runSeason, USING_MOCK } from './runSource.js';
import { PlaceholderTag } from '../components/PlaceholderTag.jsx';
import { YEARS, PLOTS, BUDGET_PER_PLOT, CHALLENGES, emptyPlot, fillPlot, starsFor, loadStars, saveStars } from './plots.js';
import './game.css';

const rand = (n) => Math.floor(Math.random() * n);
function pickYears(avail) {
  const pool = [...avail], out = [];
  while (out.length < YEARS && pool.length) out.push(pool.splice(rand(pool.length), 1)[0]);
  while (out.length < YEARS) out.push(avail[rand(avail.length)]);
  return out;
}

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

const accentColor = () => {
  try { return getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#c8f05a'; } catch { return '#c8f05a'; }
};

// ---------------------------------------------------------------------------------------------------------------- start screen
function StartScreen({ loaded, avail, sound, setSound, onStart }) {
  const { t } = useApp();
  const best = useMemo(loadStars, []);
  const ok = (c) => c.years.every((y) => avail.includes(y));
  return (
    <section className="card gm-card">
      <h2>{t('game.start.title')}</h2>
      <p>{t('game.start.intro')}</p>
      <p className="gm-banner" role="note">{t('game.banner')}</p>
      {loaded && (
        <div className="gm-loaded">
          <p><strong>{t('game.start.loaded')}</strong> {loaded.sim.crops.map((c) => t(`crops.${c.main}`)).join(' → ')}</p>
          {loaded.sim.notes.map((n) => <p key={n} className="small muted">{t(`game.planNote.${n}`)}</p>)}
          <p className="small muted">{t('game.start.loadedWhere')}</p>
        </div>
      )}
      <h3>{t('game.start.challenges')}</h3>
      <ul className="gm-challenges">
        {CHALLENGES.filter(ok).map((c) => (
          <li key={c.id}>
            <button type="button" className="btn btn-block gm-challenge" onClick={() => onStart({ kind: 'challenge', id: c.id }, c.years)}>
              <span className="gm-challenge-top"><strong>{t(`game.challenge.${c.id}.name`)}</strong><Stars n={best[c.id] ?? 0} label={t('game.end.stars', { n: best[c.id] ?? 0 })} /></span>
              <span className="small">{t(`game.challenge.${c.id}.goal`)}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="btn btn-block gm-challenge" onClick={() => onStart({ kind: 'free' }, pickYears(avail))}>
            <strong>{t('game.challenge.free.name')}</strong>
            <span className="small">{t('game.challenge.free.goal')}</span>
          </button>
        </li>
      </ul>
      <button type="button" className="chip gm-sound" aria-pressed={sound} onClick={() => setSound(!sound)}>
        {sound ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}{t(sound ? 'game.sound.on' : 'game.sound.off')}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- the game
export default function FarmGame() {
  const { t, lang, field, farm, tillage } = useApp();
  const v2 = useV2();
  const calm = useReducedMotion();
  const slots = useMemo(() => (field ? slotsFor(field) : null), [field]);
  const avail = useMemo(() => (field ? pastYears(field) : []), [field]);
  const irrigated = farm.waterMode === 'irrigated';
  const baseTillage = tillage ?? 'reduced';

  const [phase, setPhase] = useState('start'); // start | setup | growing | season | (board | end in later steps)
  const [mode, setMode] = useState({ kind: 'free' });
  const [years, setYears] = useState([]);
  const [k, setK] = useState(0);
  const [plots, setPlots] = useState(() => Array.from({ length: PLOTS }, (_, i) => emptyPlot(i, baseTillage)));
  const [sel, setSel] = useState(0);
  const [coins, setCoins] = useState(PLOTS * BUDGET_PER_PLOT);
  const [sound, setSound] = useState(false);
  const [loaded, setLoaded] = useState(null);
  const [season, setSeason] = useState(null);     // { runs, prevRuns, coinsBefore, today }
  const [seasonDone, setSeasonDone] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [month, setMonth] = useState(0);
  const [error, setError] = useState(null);
  const [ending, setEnding] = useState(null);     // { runs, stars, outOfMoney, played, coins }
  const lastRuns = useRef(null);
  const hudRef = useRef(null), barRef = useRef(null), api = useRef(null), coinRef = useRef(null);
  const accent = useMemo(accentColor, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const usd0 = useMemo(() => new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }), [lang]);
  const usd = (x) => usd0.format(x);

  // "Play this plan" from Plans / Compare.
  useEffect(() => {
    const option = takePlayPlan();
    if (option) setLoaded({ id: option.id, sim: planToSim(option) });
  }, []);

  // Full screen: no page scroll behind the game.
  useEffect(() => {
    if (phase === 'start') return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [phase]);

  const todaySim = useMemo(() => (field && slots ? { crops: todayCrops(field, slots), controls: { tillage: baseTillage, nScale: 1, irrigation: 'none' } } : null), [field, slots, baseTillage]);
  const bestSim = useMemo(() => {
    if (v2.status !== 'ready' || v2.usingSample) return null;
    const best = buildMergedPlans(v2.data, farm).best?.option;
    if (!best) return null;
    const s = planToSim(best);
    return { crops: s.crops, controls: { tillage: s.controls.tillage, nScale: s.nitrogenScale ?? 1, irrigation: irrigated ? s.controls.irrigation : 'none' } };
  }, [v2, farm, irrigated]);
  const loadedSim = loaded ? { crops: loaded.sim.crops, controls: { tillage: loaded.sim.controls.tillage, nScale: loaded.sim.nitrogenScale ?? 1, irrigation: irrigated ? loaded.sim.controls.irrigation : 'none' } } : null;

  const setPlot = (i, p) => setPlots((ps) => ps.map((x, j) => (j === i ? p : x)));
  // Quick fill keeps the plot's tillage / fertilizer / irrigation after year 1 (the engine runs them for the whole plan).
  const fillFrom = (i, sim, from) => setPlots((ps) => ps.map((x, j) => {
    if (j !== i) return x;
    const filled = fillPlot(x, sim.crops, k > 0 ? x.controls : sim.controls, from);
    return { ...filled, crops: filled.crops.map((c, yi) => (yi < k ? x.crops[yi] : sim.crops[yi % sim.crops.length])) };
  }));

  function startGame(nextMode, ys, keepPlots = false) {
    setMode(nextMode); setYears(ys); setK(0); setSel(0);
    setCoins(PLOTS * BUDGET_PER_PLOT); setSeason(null); lastRuns.current = null; setError(null); setEnding(null);
    if (!keepPlots) {
      let ps = Array.from({ length: PLOTS }, (_, i) => emptyPlot(i, baseTillage));
      if (loadedSim) ps = ps.map((p, i) => (i === 0 ? fillPlot(p, loadedSim.crops, loadedSim.controls, 'loaded') : p));
      setPlots(ps);
    }
    setPhase('setup');
  }

  const prevCrop = slots?.slots.A.cropByYear?.at(-1)?.crop ?? null;

  async function startSeason() {
    setPhase('growing'); setError(null);
    try {
      const res = await runSeason({ field, plots, today: todaySim, years: years.slice(0, k + 1), prevCrop });
      const prevRuns = lastRuns.current;
      const coinsBefore = plots.map((_, i) => BUDGET_PER_PLOT + (prevRuns ? prevRuns[i].money.reduce((a, x) => a + x, 0) : 0));
      setSeason({ runs: res.runs, prevRuns, coinsBefore, today: res.today });
      setSeasonDone(false); setPlaying(true); setMonth(0);
      setPhase('season');
    } catch (err) {
      setError(String(err?.message ?? err)); setPhase('setup');
    }
  }

  function endSeason() {
    lastRuns.current = season.runs;
    const total = season.runs.reduce((a, r) => a + BUDGET_PER_PLOT + r.money.reduce((x, y) => x + y, 0), 0);
    setCoins(Math.round(total));
    const outOfMoney = total < 0;
    if (outOfMoney || k >= YEARS - 1) {
      const start = PLOTS * BUDGET_PER_PLOT;
      const stars = mode.kind === 'challenge' ? starsFor(mode.id, season.runs, season.today, { outOfMoney, coinsEnd: total, coinsStart: start }) : 0;
      if (mode.kind === 'challenge' && stars > 0) saveStars(mode.id, stars);
      setEnding({ runs: season.runs, stars, outOfMoney, played: k + 1, coins: Math.round(total) });
      setPhase('end');
      return;
    }
    setK(k + 1); setSeason(null); setPhase('setup');
  }

  if (!field) return <p className="muted">{t('common.noField')}</p>;
  if (phase === 'start') return <StartScreen loaded={loaded} avail={avail} sound={sound} setSound={setSound} onStart={startGame} />;

  const crop = (id) => t(`crops.${id}`);
  const monthName = (m) => new Intl.DateTimeFormat(lang, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2001, m, 1)));
  const plotLabel = (p) => { const c = p.crops[k]; return c?.main ? crop(c.main) : t('game.plotEmpty'); };
  const fills = [
    { id: 'best', label: t('game.fill.best'), disabled: !bestSim, run: () => fillFrom(2, bestSim, 'best') },
    { id: 'today', label: t('game.fill.today'), disabled: !todaySim, run: () => fillFrom(3, todaySim, 'today') },
    ...(loadedSim ? [{ id: 'loaded', label: t('game.fill.loaded', { n: sel + 1 }), run: () => fillFrom(sel, loadedSim, 'loaded') }] : []),
    { id: 'clear', label: t('game.fill.clear', { n: sel + 1 }), run: () => setPlot(sel, { ...plots[sel], crops: plots[sel].crops.map((c, yi) => (yi < k ? c : null)), from: null }) },
  ];

  const getFrame = () => ({
    mode: 'setup', month: 2, weather: null, calm, selected: sel, flag: -1, accent,
    plots: plots.map((p) => ({ choice: p.crops[k], controls: p.controls, residue0: 0.35, label: plotLabel(p) })),
  });
  const pads = () => ({ top: (hudRef.current?.offsetHeight ?? 90) + 8, bottom: (barRef.current?.offsetHeight ?? 150) + 8 });

  return (
    <div className="gm-full" role="region" aria-label={t('game.title')}>
      {phase !== 'season' && phase !== 'end' && <GameCanvas getFrame={getFrame} onTap={setSel} pads={pads} api={api} label={t('game.scene.alt')} />}
      <div className="gm-hud" ref={hudRef}>
        <div className="gm-hud-row">
          <button type="button" className="gm-icon-btn" aria-label={t('game.hud.exit')} onClick={() => setPhase('start')}><X size={22} aria-hidden="true" /></button>
          <span className="gm-pill">{t('game.progress', { n: k + 1, total: YEARS })}</span>
          <span className={`gm-pill gm-coins${coins < 0 ? ' is-low' : ''}`} ref={coinRef} aria-label={t('game.hud.coins', { usd: usd(coins) })}><Coins size={16} aria-hidden="true" />{usd(coins)}</span>
          <span className="gm-spacer" />
          {phase === 'season' && (
            <button type="button" className="gm-icon-btn" aria-label={t(playing ? 'game.play.pause' : 'game.play.play')} disabled={seasonDone} onClick={() => setPlaying(!playing)}>
              {playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
            </button>
          )}
          <button type="button" className="gm-icon-btn" aria-pressed={sound} aria-label={t(sound ? 'game.sound.on' : 'game.sound.off')} onClick={() => setSound(!sound)}>
            {sound ? <Volume2 size={20} aria-hidden="true" /> : <VolumeX size={20} aria-hidden="true" />}
          </button>
        </div>
        <p className="gm-hud-banner" role="note">{t('game.banner')}{mode.kind === 'challenge' && ` · ${t(`game.challenge.${mode.id}.name`)}`}</p>
        {phase === 'season' && season && (
          <p className="gm-hud-sub">
            <strong>{monthName(month)}</strong> · {t('game.weatherOf', { year: years[k] })}
            {season.runs[0].yearType && <> · {t(`game.yearType.${season.runs[0].yearType}`)}</>}
            {season.runs[0].placeholderSlots?.includes('modelC') && <PlaceholderTag />}
          </p>
        )}
        {USING_MOCK && <p className="gm-mock" role="note">{t('game.mock')}</p>}
      </div>
      {(phase === 'setup' || phase === 'growing') && (
        <Toolbar k={k} plots={plots} sel={sel} setSel={setSel} setPlot={setPlot} irrigated={irrigated} fills={fills} usd={usd} barRef={barRef}
          onStart={phase === 'setup' ? startSeason : null} />
      )}
      {phase === 'growing' && <div className="gm-growing" role="status"><span className="gm-sprout" aria-hidden="true" />{t('game.running')}</div>}
      {error && phase === 'setup' && <p className="gm-error" role="alert">{t('game.error')} ({error})</p>}
      {phase === 'season' && season && (
        <SeasonView runs={season.runs} prevRuns={season.prevRuns} coinsBefore={season.coinsBefore} plots={plots} labels={plots.map(plotLabel)}
          playing={playing} setPlaying={setPlaying} onMonth={setMonth} onCoins={setCoins} onDone={() => { setSeasonDone(true); setPlaying(false); }}
          sound={sound} calm={calm} accent={accent} hudRef={hudRef} coinRef={coinRef} usd={usd} done={seasonDone} />
      )}
      {phase === 'end' && ending && (
        <EndScreen runs={ending.runs} mode={mode} stars={ending.stars} outOfMoney={ending.outOfMoney} played={ending.played} coins={ending.coins} usd={usd}
          top={(hudRef.current?.offsetHeight ?? 100) + 4}
          onAgain={() => startGame(mode, years, true)} onNew={() => setPhase('start')} />
      )}
      {phase === 'season' && seasonDone && <Scoreboard runs={season.runs} k={k} last={k >= YEARS - 1} onNext={endSeason} usd={usd} top={(hudRef.current?.offsetHeight ?? 100) + 4} />}

    </div>
  );
}
