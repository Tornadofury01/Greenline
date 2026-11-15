// Sliding pill from Aceternity's tabs (layoutId on the active control).
// The library also stacks tab panels in 3D. That stack is left out: the scores and the plan stay on the page.
import { motion, useReducedMotion } from 'motion/react';

export default function SlidingTabs({ id, label, value, onChange, options }) {
  const reduce = useReducedMotion();
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button key={opt.value} type="button" aria-pressed={on} onClick={() => onChange(opt.value)}>
            {on && (
              <motion.span
                className="segmented-pill"
                layoutId={id}
                transition={reduce ? { duration: 0 } : { duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
              />
            )}
            <span className="segmented-label">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
