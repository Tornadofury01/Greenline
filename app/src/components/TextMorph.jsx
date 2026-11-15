// One word or phrase melts into the next (the Componentry "text morph" technique: two copies cross-blur under an
// SVG alpha-threshold filter, so the letters read as liquid ink between states). Inherits the surrounding font.
// Screen readers get the current text only. Reduced motion: an instant swap.
import { useEffect, useId, useRef, useState } from 'react';
import { animate } from 'motion';

export default function TextMorph({ text, as: Tag = 'span', className, duration = 0.75 }) {
  const [shown, setShown] = useState({ from: text, to: text });
  const fromRef = useRef(null);
  const toRef = useRef(null);
  const filterId = `morph-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;

  useEffect(() => {
    setShown((s) => (s.to === text ? s : { from: s.to, to: text }));
  }, [text]);

  const morphing = shown.from !== shown.to;
  useEffect(() => {
    if (!morphing) return undefined;
    const a = fromRef.current; const b = toRef.current;
    let live = true;
    const done = () => {
      live = false;
      if (b) { b.style.filter = ''; b.style.opacity = ''; }
      setShown((s) => ({ from: s.to, to: s.to }));
    };
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { done(); return undefined; }
    const controls = animate(0, 1, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (f) => {
        if (!live) return;
        const inF = Math.max(f, 0.0001); const outF = Math.max(1 - f, 0.0001);
        if (b) { b.style.filter = `blur(${Math.min(8 / inF - 8, 100)}px)`; b.style.opacity = `${inF ** 0.4}`; }
        if (a) { a.style.filter = `blur(${Math.min(8 / outF - 8, 100)}px)`; a.style.opacity = `${outF ** 0.4}`; }
      },
      onComplete: done,
    });
    // Fallback: if animation frames are paused (background tab), land on the final text anyway.
    const timer = setTimeout(done, duration * 1000 + 250);
    return () => { live = false; controls.stop(); clearTimeout(timer); };
  }, [morphing, shown, duration]);

  return (
    <Tag className={className}>
      <span className="sr-only">{shown.to}</span>
      <span aria-hidden="true" style={{ display: 'inline-grid', filter: morphing ? `url(#${filterId})` : undefined }}>
        {morphing && <span ref={fromRef} style={{ gridArea: '1 / 1' }}>{shown.from}</span>}
        <span ref={toRef} style={{ gridArea: '1 / 1' }}>{shown.to}</span>
      </span>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
        <defs>
          <filter id={filterId}>
            <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 255 -140" />
          </filter>
        </defs>
      </svg>
    </Tag>
  );
}
