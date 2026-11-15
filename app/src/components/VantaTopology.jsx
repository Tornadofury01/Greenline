// Animated contour lines (Vanta TOPOLOGY, drawn with p5) behind a hero: they read like the elevation lines of a
// field map. Decorative only. Not started under prefers-reduced-motion; paused when scrolled out of view.
import { useEffect, useRef } from 'react';

export default function VantaTopology({ color = 0x1f5f40, backgroundColor = 0xf5f2ea, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    let effect = null;
    let cancelled = false;
    (async () => {
      const [{ default: p5 }, { default: TOPOLOGY }] = await Promise.all([
        import('p5'),
        import('vanta/dist/vanta.topology.min'),
      ]);
      if (cancelled) return;
      effect = TOPOLOGY({
        el, p5, color, backgroundColor,
        mouseControls: true, touchControls: true, gyroControls: false,
        minHeight: 200, minWidth: 200, scale: 1, scaleMobile: 1,
      });
    })().catch(() => {});
    // Pause the drawing loop while the hero is off screen.
    const io = new IntersectionObserver(([entry]) => {
      const p = effect?.p5;
      if (!p) return;
      if (entry.isIntersecting) p.loop(); else p.noLoop();
    });
    io.observe(el);
    return () => { cancelled = true; io.disconnect(); effect?.destroy(); };
  }, [color, backgroundColor]);
  return <div ref={ref} className={className} aria-hidden="true" />;
}
