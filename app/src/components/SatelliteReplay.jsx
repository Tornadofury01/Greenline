import { useEffect, useState } from 'react';
import { useRef } from 'react';
import { ChevronLeft, ChevronRight, Minus, Pause, Play, Plus, RotateCcw, Scan } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { useWide } from '../state/useWide.js';

const asset = (path) => `${import.meta.env.BASE_URL}${path}`;

// Fetch only the selected field's manifest when History opens. Never substitute another field.
export default function SatelliteReplay({ field }) {
  const { t } = useApp();
  const id = field.field.id;
  const [archive, setArchive] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setArchive(null); setError(false);
    fetch(asset(`history/fields/${id}.json`), { signal: controller.signal })
      .then((r) => { if (!r.ok) throw Error('Unavailable'); return r.json(); })
      .then((data) => {
        if (data.fieldId !== id || !data.frames?.length || !data.rings?.length) throw Error('Invalid archive');
        if (!controller.signal.aborted) setArchive(data);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [id, attempt]);
  if (archive?.fieldId !== id) return <section className="card satellite-replay replay-empty" role="status">
    <h2>{t('story.satellite.title')}</h2><p>{t(error ? 'story.satellite.noArchive' : 'story.satellite.loading')}</p>
    {error && <button type="button" className="btn" onClick={() => setAttempt(attempt + 1)}>{t('story.satellite.retry')}</button>}
  </section>;
  return <Replay key={id} field={field} archive={archive} />;
}

function Replay({ field, archive }) {
  const { t, lang } = useApp();
  const { frames, rings, imageSize, viewBox, missingPeriods } = archive;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [camera, setCamera] = useState({ zoom: 1, dx: 0, dy: 0 });
  const [visibleIndex, setVisibleIndex] = useState(null);
  const drag = useRef(null);
  const wide = useWide('(min-width: 768px)');
  const [imageState, setImageState] = useState({ src: '', status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const frame = frames[index];
  const url = asset(frame.src);
  const ready = imageState.src === url && imageState.status === 'ready';
  const failed = imageState.src === url && imageState.status === 'error';
  const last = frames.length - 1;
  const visibleFrame = frames[visibleIndex ?? index];
  const year = Number(visibleFrame.date.slice(0, 4));
  const month = Number(visibleFrame.date.slice(5, 7));
  const crop = field.cropHistory.find((r) => r.year === year);
  const cropKey = crop?.crop === 'other' ? `si.cls.${crop.cdlClass || 'other'}` : crop?.crop ? `crops.${crop.crop}` : 'common.unknown';
  const cover = field.coverYearlyL89?.find((r) => r.year === year)?.months[month - 1] || 'none';
  const formatDate = new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: 'UTC' });
  const date = formatDate.format(new Date(visibleFrame.date));
  const monthLabel = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(visibleFrame.date));
  const years = [...new Set(frames.map((entry) => entry.date.slice(0, 4)))];

  useEffect(() => {
    let active = true;
    const image = new Image();
    const timeout = window.setTimeout(() => { if (active) { setImageState({ src: url, status: 'error' }); setPlaying(false); } }, 20000);
    image.onload = () => {
      if (!active) return;
      window.clearTimeout(timeout);
      setImageState({ src: url, status: 'ready' });
      setVisibleIndex(index);
    };
    image.onerror = () => { if (active) { window.clearTimeout(timeout); setImageState({ src: url, status: 'error' }); setPlaying(false); } };
    image.src = url;
    return () => { active = false; window.clearTimeout(timeout); image.onload = null; image.onerror = null; };
  }, [url, index, attempt]);
  useEffect(() => {
    if (frames[index + 1]) { const next = new Image(); next.src = asset(frames[index + 1].src); }
  }, [index, frames]);
  useEffect(() => {
    if (!playing || !ready) return undefined;
    const timer = window.setTimeout(() => {
      if (index === last) setPlaying(false); else setIndex(index + 1);
    }, 750 / speed);
    return () => window.clearTimeout(timer);
  }, [index, playing, ready, last, speed]);
  useEffect(() => {
    const hide = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  function toggle() { if (!playing && index === last) setIndex(0); setPlaying(!playing); }
  function seek(next) { setPlaying(false); setIndex(Math.max(0, Math.min(last, next))); }
  function keyboard(event) {
    if (['INPUT', 'BUTTON', 'SUMMARY', 'SELECT'].includes(event.target.tagName)) return;
    const actions = { ArrowLeft: () => seek(index - 1), ArrowRight: () => seek(index + 1), Home: () => seek(0), End: () => seek(last), ' ': toggle };
    if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
  }
  const outline = rings.map((ring) => `M${ring.map((p) => p.join(',')).join('L')}Z`).join('');
  const [x, y, w, h] = viewBox;
  const width = wide ? h * 16 / 9 : w;
  const left = Math.max(0, Math.min(imageSize - width, x + (w - width) / 2));
  const { zoom, dx, dy } = camera;
  const viewport = [left + (width - width / zoom) / 2 + dx, y + (h - h / zoom) / 2 + dy, width / zoom, h / zoom];
  const outside = `M0,0h${imageSize}v${imageSize}h-${imageSize}Z${outline}`;
  function setZoom(next) {
    setCamera({ zoom: next, dx: 0, dy: 0 });
  }
  function startPan(event) {
    if (zoom === 1 || event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, dx, dy };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePan(event) {
    if (!drag.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const moveX = drag.current.dx - (event.clientX - drag.current.x) * viewport[2] / bounds.width;
    const moveY = drag.current.dy - (event.clientY - drag.current.y) * viewport[3] / bounds.height;
    const maxX = (width - viewport[2]) / 2;
    const maxY = (h - viewport[3]) / 2;
    setCamera({ zoom, dx: Math.max(-maxX, Math.min(maxX, moveX)), dy: Math.max(-maxY, Math.min(maxY, moveY)) });
  }
  return (
    <section className="card satellite-replay" aria-labelledby="satellite-title" onKeyDown={keyboard}>
      <div className="replay-heading">
        <div><h2 id="satellite-title">{t('story.satellite.title')}</h2><p className="muted small">{t('story.satellite.source')}</p></div>
        <span className="replay-field-id">{archive.fieldId}</span>
      </div>
      <div className="satellite-replay-stage" tabIndex="0" aria-label={t('story.satellite.keyboard')}>
        <svg viewBox={viewport.join(' ')} role="img" aria-label={t('story.satellite.imageAlt', { date })} data-field-id={archive.fieldId}
          className={zoom > 1 ? 'can-pan' : undefined} onPointerDown={startPan} onPointerMove={movePan}
          onLostPointerCapture={() => { drag.current = null; }}>
          {visibleIndex !== null && <image href={asset(visibleFrame.src)} x="0" y="0" width={imageSize} height={imageSize} />}
          <path d={outside} fill="black" fillOpacity=".16" fillRule="evenodd" />
          <path className="replay-outline-shadow" d={outline} fill="none" stroke="black" strokeWidth="4" vectorEffect="non-scaling-stroke" />
          <path className="replay-outline" d={outline} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        {(failed || visibleIndex === null) && <div className="replay-image-status" role="status"><p>{t(failed ? 'story.satellite.unavailable' : 'story.satellite.loading')}</p>
          {failed && <button type="button" className="btn" onClick={() => { setImageState({ src: url, status: 'loading' }); setAttempt(attempt + 1); }}>{t('story.satellite.retry')}</button>}
        </div>}
        {visibleIndex !== null && !failed && <time className="replay-stage-caption" dateTime={visibleFrame.date}>{date}</time>}
        <div className="replay-map-tools">
          <button type="button" onClick={() => setZoom(Math.min(3, zoom + 0.5))} disabled={zoom === 3} aria-label={t('pick.zoomIn')}><Plus size={18} /></button>
          <button type="button" onClick={() => setZoom(Math.max(1, zoom - 0.5))} disabled={zoom === 1} aria-label={t('pick.zoomOut')}><Minus size={18} /></button>
          <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1} aria-label={t('story.satellite.resetView')}><Scan size={18} /></button>
        </div>
      </div>
      <div className="satellite-replay-controls">
        <button type="button" className="btn btn-primary replay-play" disabled={last < 1 || failed} onClick={toggle}>
          {playing ? <Pause size={19} aria-hidden="true" /> : index === last ? <RotateCcw size={19} aria-hidden="true" /> : <Play size={19} aria-hidden="true" />}
          {t(playing ? 'story.satellite.pause' : 'story.satellite.play')}
        </button>
        <div className="replay-scrubber">
          <input type="range" min="0" max={last} step="1" value={index} aria-label={t('story.satellite.timeline')} aria-valuetext={formatDate.format(new Date(frame.date))} onChange={(e) => seek(Number(e.target.value))} />
        </div>
        <div className="replay-step-controls">
          <button type="button" className="icon-btn" disabled={index === 0} onClick={() => seek(index - 1)} aria-label={t('story.satellite.previous')}><ChevronLeft size={20} /></button>
          <button type="button" className="icon-btn" disabled={index === last} onClick={() => seek(index + 1)} aria-label={t('story.satellite.next')}><ChevronRight size={20} /></button>
        </div>
        <select className="replay-speed" aria-label={t('story.satellite.speed')} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option>
        </select>
      </div>
      <div className="replay-years">
        {years.map((label) => (
          <button type="button" key={label} aria-pressed={Number(label) === year}
            onClick={() => seek(frames.findIndex((entry) => entry.date.startsWith(label)))}>{label}</button>
        ))}
      </div>
      <dl className="satellite-replay-facts" aria-live={playing ? 'off' : 'polite'}>
        <div><dt>{t('story.satellite.crop', { year })}</dt><dd>{t(cropKey)}</dd></div>
        <div><dt>{t('story.satellite.monthCover', { month: monthLabel })}</dt><dd><span className={`replay-cover-dot cover-${cover}`} aria-hidden="true" />{t(`story.cover.${cover}`)}</dd></div>
      </dl>
      <details className="replay-about"><summary>{t('story.satellite.about')}</summary>
        <p>{t('story.satellite.note')}</p><p>{t('story.satellite.sampling')}</p>
        <p>{missingPeriods.length ? t('story.satellite.gaps', { dates: missingPeriods.join(', ') }) : t('story.satellite.noGaps')}</p>
        <p>{t('story.satellite.keyboard')}</p>
      </details>
    </section>
  );
}
