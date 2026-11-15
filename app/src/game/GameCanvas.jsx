// The game's one canvas: an animation loop that asks the parent for a frame (getFrame) and draws it with scene.js.
// Taps on the canvas go to onTap(plotIndex). `api` gives the parent the live layout and particle list (for flying coins).
import { useEffect, useRef } from 'react';
import { createScene, draw, layout, plotAt } from './scene.js';

export function GameCanvas({ getFrame, onTap, pads, api, label }) {
  const canvas = useRef(null), wrap = useRef(null);
  const live = useRef({ getFrame, onTap, pads });
  live.current = { getFrame, onTap, pads };

  useEffect(() => {
    const scene = createScene();
    const ctx = canvas.current.getContext('2d');
    let raf = 0, last = performance.now(), t = 0;
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!document.hidden) t += dt;
      const el = canvas.current, box = wrap.current;
      if (!el || !box) return;
      const w = box.clientWidth, h = box.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pd = live.current.pads();
      const L = layout(w, h, pd.top, pd.bottom);
      if (api) api.current = { scene, L, t };
      const frame = live.current.getFrame(dt, L, t);
      if (frame) draw(ctx, L, { ...frame, t }, scene);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [api]);

  const tap = (e) => {
    const r = canvas.current.getBoundingClientRect();
    const pd = live.current.pads();
    const L = layout(r.width, r.height, pd.top, pd.bottom);
    const i = plotAt(L, e.clientX - r.left, e.clientY - r.top);
    if (i >= 0) live.current.onTap?.(i);
  };

  return (
    <div className="gm-canvas-wrap" ref={wrap}>
      <canvas ref={canvas} className="gm-canvas" role="img" aria-label={label} onPointerUp={tap} />
    </div>
  );
}
