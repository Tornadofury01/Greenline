// Farm simulator start screen: the first thing a farmer sees under More -> Farm simulator.
// Hero (idle preview of the farm scene), a calm "not a forecast" line, how it works, Free play, and the challenge tiles.
// Only layout and pictures live here; the rules (years, stars) come from plots.js unchanged.
import { useEffect, useMemo, useRef } from 'react';
import { Volume2, VolumeX, Info, LayoutGrid, CloudSun, Trophy, Dices, Play } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { CHALLENGES, loadStars } from './plots.js';
import { createScene, draw, layout } from './scene.js';
import { Stars } from './EndScreen.jsx';

// Look of each challenge tile: accent strip, drawn icon and difficulty. Presentation only.
const LOOK = {
  drought: { tone: 'sun', level: 'hard' },
  soil: { tone: 'soil', level: 'medium' },
  beat: { tone: 'mint', level: 'easy' },
};

// ------------------------------------------------------------------------------------------------ hero canvas
// Four growing plots drawn by the game's own scene (no engine numbers: a fixed picture), with clouds drifting over.
const HERO_PLOTS = [
  { crop: 'corn', stage: 0.62 },
  { crop: 'cotton', stage: 0.55 },
  { crop: 'winter_wheat', stage: 0.7 },
  { crop: 'grain_sorghum', stage: 0.5 },
].map((p) => ({
  ...p, canopy: p.stage + 0.1, residue: 0.3, stress: 0, nShare: 1, pest: 0, bare: false, erosSoFar: 0, T: 5,
  rzShare: 0.8, irrigating: false, irrigationOn: false, machine: null, label: '', tillage: 'reduced',
}));

function clouds(ctx, w, t, calm) {
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  [[0.12, 22, 1], [0.55, 14, 0.8], [0.9, 30, 0.65]].forEach(([x0, y, s], k) => {
    const span = w + 140;
    const x = (((x0 * span + (calm ? 0 : t * (8 + k * 3))) % span) + span) % span - 70;
    ctx.beginPath();
    ctx.ellipse(x, y, 26 * s, 9 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 14 * s, y + 3 * s, 16 * s, 7 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 10 * s, y - 5 * s, 15 * s, 9 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

function HeroCanvas({ calm, label }) {
  const canvas = useRef(null);
  useEffect(() => {
    const el = canvas.current, ctx = el.getContext('2d');
    const scene = createScene();
    let raf = 0, t = 0, last = performance.now(), size = '';
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!document.hidden) t += dt;
      const w = el.clientWidth, h = el.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const key = `${w}x${h}@${dpr}`;
      if (key !== size || !calm) {
        if (key !== size) { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); size = key; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const L = layout(w, h, 10, 6);
        draw(ctx, L, { mode: 'season', month: 6, weather: null, calm, selected: -1, flag: -1, plots: HERO_PLOTS, t }, scene);
        clouds(ctx, w, t, calm);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [calm]);
  return <canvas ref={canvas} className="gm-hero-canvas" role="img" aria-label={label} />;
}

// ------------------------------------------------------------------------------------------------ drawn tile icons
function TileIcon({ id }) {
  const common = { width: 48, height: 48, viewBox: '0 0 48 48', 'aria-hidden': true, className: 'gm-tile-icon' };
  if (id === 'drought') {
    // A hot sun over cracked, sun-baked soil.
    return (
      <svg {...common}>
        <circle cx="34" cy="13" r="6" fill="var(--gm-sun)" />
        <g stroke="var(--gm-sun)" strokeWidth="2" strokeLinecap="round">
          <path d="M34 3v2M34 21v2M24 13h2M42 13h2M27 6l1.5 1.5M39.5 18.5L41 20M27 20l1.5-1.5M39.5 7.5L41 6" />
        </g>
        <path d="M4 28h40v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="var(--gm-soil)" />
        <g stroke="var(--color-surface)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M10 28l4 6-3 5 2 5M14 34l6 1M24 28l-2 7 5 4-1 5M27 39l7-2M36 28l2 6 5 2" />
        </g>
      </svg>
    );
  }
  if (id === 'soil') {
    // A sprout on top of three soil layers.
    return (
      <svg {...common}>
        <path d="M24 18V8M24 12c-4-1-6-4-6-7 4 0 6 3 6 7zM24 10c3-1 6-3 6-6-4 0-6 2-6 6z" stroke="var(--gm-mint)" strokeWidth="2" fill="var(--gm-mint)" strokeLinejoin="round" />
        <path d="M4 20c6-3 12 2 20 0s14-3 20 0v6H4z" fill="var(--gm-soil-top)" />
        <path d="M4 26h40v8c-6 2-14-2-20 0s-14 2-20 0z" fill="var(--gm-soil)" />
        <path d="M4 34c6 2 14-2 20 0s14 2 20 0v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="var(--gm-soil-deep)" />
        <g fill="var(--color-surface)" opacity="0.7"><circle cx="12" cy="30" r="1.3" /><circle cx="33" cy="29" r="1.1" /><circle cx="20" cy="39" r="1.3" /><circle cx="38" cy="40" r="1" /></g>
      </svg>
    );
  }
  // A balance scale: your plan against today's rotation.
  return (
    <svg {...common}>
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M24 6v34M16 42h16M8 12h32M8 12l-6 14M8 12l6 14M40 12l-6 10M40 12l6 10" />
      </g>
      <path d="M2 26h12a6 6 0 0 1-12 0z" fill="var(--gm-mint)" />
      <path d="M34 22h12a6 6 0 0 1-12 0z" fill="var(--gm-sun)" />
      <circle cx="24" cy="6" r="2.6" fill="currentColor" />
    </svg>
  );
}

// ------------------------------------------------------------------------------------------------ the screen
export function StartScreen({ loaded, loadedName, avail, sound, setSound, calm, onFree, onChallenge }) {
  const { t } = useApp();
  const best = useMemo(loadStars, []);
  const ok = (c) => c.years.every((y) => avail.includes(y));
  const steps = [['step1', LayoutGrid], ['step2', CloudSun], ['step3', Trophy]];
  return (
    <div className="screen gm-landing">
      <section className="gm-hero">
        <div className="gm-hero-art">
          <HeroCanvas calm={calm} label={t('game.start.heroAlt')} />
          <button type="button" className="gm-hero-sound" aria-pressed={sound} aria-label={t(sound ? 'game.sound.on' : 'game.sound.off')} onClick={() => setSound(!sound)}>
            {sound ? <Volume2 size={22} aria-hidden="true" /> : <VolumeX size={22} aria-hidden="true" />}
          </button>
        </div>
        <div className="gm-hero-text">
          <h1>{t('game.title')}</h1>
          <p>{t('game.start.subtitle')}</p>
        </div>
      </section>

      <p className="gm-info"><Info size={16} aria-hidden="true" />{t('game.banner')}</p>

      {loaded && (
        <section className="gm-ready" aria-labelledby="gm-ready-title">
          <div className="gm-ready-text">
            <h2 id="gm-ready-title">{t('game.start.ready', { name: loadedName })}</h2>
            <p className="small muted">{t('game.start.loadedWhere')}</p>
            {loaded.sim.notes.map((n) => <p key={n} className="small muted">{t(`game.planNote.${n}`)}</p>)}
          </div>
          <button type="button" className="btn btn-primary" onClick={onFree}><Play size={18} aria-hidden="true" />{t('game.start.playIt')}</button>
        </section>
      )}

      <section aria-labelledby="gm-how-title" className="gm-how">
        <h2 id="gm-how-title" className="gm-kicker">{t('game.start.howTitle')}</h2>
        <ol className="gm-steps">
          {steps.map(([key, Icon], i) => (
            <li key={key}><span className="gm-step-icon" aria-hidden="true"><Icon size={18} /></span><span className="gm-step-n">{i + 1}</span>{t(`game.start.${key}`)}</li>
          ))}
        </ol>
      </section>

      <button type="button" className={`btn btn-block gm-free${loaded ? '' : ' btn-primary'}`} onClick={onFree}>
        <Dices size={22} aria-hidden="true" />{t('game.start.free')}
      </button>

      <section aria-labelledby="gm-ch-title">
        <h2 id="gm-ch-title" className="gm-kicker">{t('game.start.challenges')}</h2>
        <ul className="gm-tiles">
          {CHALLENGES.filter(ok).map((c) => {
            const look = LOOK[c.id] ?? LOOK.beat;
            const stars = best[c.id] ?? 0;
            return (
              <li key={c.id}>
                <button type="button" className={`gm-tile tone-${look.tone}`} onClick={() => onChallenge(c)}>
                  <TileIcon id={c.id} />
                  <span className="gm-tile-body">
                    <span className="gm-tile-title">{t(`game.challenge.${c.id}.name`)}</span>
                    <span className="gm-tile-goal">{t(`game.challenge.${c.id}.goal`)}</span>
                    <span className="gm-tile-chips">
                      <span className="gm-chip">{c.years[0]}–{c.years.at(-1)}</span>
                      <span className="gm-chip">{t(`game.start.level.${look.level}`)}</span>
                    </span>
                  </span>
                  <Stars n={stars} label={t('game.end.stars', { n: stars })} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
