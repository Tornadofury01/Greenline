// Ranked priorities picker (Rotations and Your farm). The farmer's priorities are an ORDERED list: the 1st counts most in
// every score, each next one a little less (content/v2-scores.json rankStrength, scoring/scoreRotation.js RANK_STRENGTH).
// Picked ones show as numbered green chips in rank order with "move up" and "remove"; the others are plain outlines
// (not highlighted) that add themselves at the end when tapped. value / onChange = the ordered list of priority ids.
import { ArrowLeft, Plus, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useApp } from '../state/AppContext.jsx';

export default function RankedPriorities({ options, value, onChange, labelledBy }) {
  const { t } = useApp();
  const reduce = useReducedMotion();
  const name = (id) => t(`priorities.${id}`);
  const unpicked = options.filter((id) => !value.includes(id));
  const move = (i) => { const next = [...value]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onChange(next); };
  const spring = reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38 };

  return (
    <div className="flex flex-col gap-3" role="group" aria-labelledby={labelledBy}>
      {value.length > 0 && (
        <ol className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t('priorityRank.rankedLabel')}>
          <AnimatePresence initial={false}>
            {value.map((id, i) => (
              <motion.li key={id} layout={!reduce} transition={spring}
                initial={reduce ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                className="flex items-center gap-1 rounded-full bg-primary py-1 pl-1 pr-1 text-primary-content">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-primary-content text-sm font-bold text-primary" aria-hidden="true">{i + 1}</span>
                <span className="px-1.5 text-base font-semibold">
                  <span className="sr-only">{t('priorityRank.rankOf', { n: i + 1 })} </span>{name(id)}
                </span>
                {i > 0 && (
                  <button type="button" className="grid h-11 w-11 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-primary-content hover:bg-primary-content/15 focus-visible:bg-primary-content/15"
                    aria-label={t('priorityRank.moveUp', { name: name(id) })} title={t('priorityRank.moveUp', { name: name(id) })} onClick={() => move(i)}>
                    <ArrowLeft size={17} aria-hidden="true" />
                  </button>
                )}
                <button type="button" className="grid h-11 w-11 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-primary-content hover:bg-primary-content/15 focus-visible:bg-primary-content/15"
                  aria-label={t('priorityRank.remove', { name: name(id) })} title={t('priorityRank.remove', { name: name(id) })} onClick={() => onChange(value.filter((x) => x !== id))}>
                  <X size={17} aria-hidden="true" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
      {unpicked.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label={t('priorityRank.addLabel')}>
          {unpicked.map((id) => (
            <button key={id} type="button" onClick={() => onChange([...value, id])}
              aria-label={t('priorityRank.add', { name: name(id), n: value.length + 1 })}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-base-300 bg-base-100 px-4 text-base font-medium text-base-content/75 transition-colors hover:border-base-content/40 hover:text-base-content">
              <Plus size={16} aria-hidden="true" />{name(id)}
            </button>
          ))}
        </div>
      )}
      <p className="m-0 text-sm leading-relaxed text-base-content/70">{value.length ? t('priorityRank.hint') : t('priorityRank.none')}</p>
    </div>
  );
}
