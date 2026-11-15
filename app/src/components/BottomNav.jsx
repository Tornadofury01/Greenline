// App navigation in the plat-book world. Five main screens as tabs; the rest (and "How we know") in a More menu.
// Phones: a paper tab bar at the bottom. Desktop (lg+): the same tabs in the top bar (Header.jsx).
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MapPin, Tractor, CloudRain, ClipboardList, ListChecks, Trophy, ThermometerSun, Ellipsis, FlaskRound, Scale, BookOpen } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';

// Screen ids in order, with one Lucide icon each. `more: true` = lives in the More menu.
export const SCREENS = [
  { id: 'field', Icon: MapPin },
  { id: 'farm', Icon: Tractor },
  { id: 'story', Icon: CloudRain },
  { id: 'options', Icon: ListChecks },
  { id: 'plans', Icon: Trophy },
  { id: 'risks', Icon: ThermometerSun, more: true },
  { id: 'sim', Icon: FlaskRound, more: true },
  { id: 'compare', Icon: Scale, more: true },
  { id: 'handoff', Icon: ClipboardList, more: true },
];
export const TABS = SCREENS.filter((s) => !s.more);
const MORE = SCREENS.filter((s) => s.more);

// Open/close state for the More menu: closes on screen change, Escape and a tap outside `wrap`.
export function useMoreMenu() {
  const { screen } = useApp();
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => { setOpen(false); }, [screen]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);
  return { open, setOpen, wrap, inMore: MORE.some((s) => s.id === screen) || screen === 'how' };
}

// The More list: a ruled index of the remaining screens, like the contents page of an atlas.
export function MoreMenu({ open, id, place }) {
  const { t, screen, setScreen, openHow } = useApp();
  const reduce = useReducedMotion();
  const fromBelow = place === 'above';
  return (
    <AnimatePresence>
      {open && (
        <motion.ul id={id} aria-label={t('nav.moreLabel')}
          initial={reduce ? false : { opacity: 0, y: fromBelow ? 8 : -8, clipPath: fromBelow ? 'inset(100% 0 0 0)' : 'inset(0 0 100% 0)' }}
          animate={{ opacity: 1, y: 0, clipPath: 'inset(0 0 0 0)' }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: fromBelow ? 6 : -6 }}
          transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
          className={`absolute z-[1100] m-0 w-64 list-none border border-ink bg-paper-raised p-0 shadow-[0_12px_32px_-12px_rgb(30_26_18/0.35)] ${fromBelow ? 'bottom-[calc(100%+8px)] right-2' : 'top-[calc(100%+1px)] right-0'}`}>
          {MORE.map(({ id: sid, Icon }) => (
            <li key={sid} className="border-b border-rule last:border-b-0">
              <button type="button" aria-current={screen === sid ? 'page' : undefined} onClick={() => setScreen(sid)}
                className="flex min-h-12 w-full items-center gap-3 bg-transparent px-4 text-left text-[15px] text-ink hover:bg-paper-deep aria-[current=page]:font-semibold aria-[current=page]:text-forest">
                <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
                <span>{t(`nav.${sid}Long`)}</span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" aria-current={screen === 'how' ? 'page' : undefined} onClick={() => openHow()}
              className="flex min-h-12 w-full items-center gap-3 bg-transparent px-4 text-left text-[15px] text-ink hover:bg-paper-deep aria-[current=page]:font-semibold aria-[current=page]:text-forest">
              <BookOpen size={18} strokeWidth={1.6} aria-hidden="true" />
              <span>{t('how.open')}</span>
            </button>
          </li>
        </motion.ul>
      )}
    </AnimatePresence>
  );
}

// Phones and tablets: paper tab bar, active tab marked by a forest bar on its top edge.
export default function BottomNav() {
  const { t, screen, setScreen } = useApp();
  const { open, setOpen, wrap, inMore } = useMoreMenu();
  return (
    <nav ref={wrap} aria-label={t('nav.label')}
      className="fixed inset-x-0 bottom-0 z-[1000] border-t-[3px] border-double border-ink/70 bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden">
      <MoreMenu open={open} id="more-menu" place="above" />
      <div className="grid h-[var(--plat-nav)] grid-cols-6">
        {TABS.map(({ id, Icon }) => {
          const on = screen === id;
          return (
            <button key={id} type="button" aria-current={on ? 'page' : undefined} onClick={() => setScreen(id)}
              className={`relative flex flex-col items-center justify-center gap-1 border-0 bg-transparent text-[12px] font-medium ${on ? 'text-ink' : 'text-ink-soft'}`}>
              <span className={`absolute inset-x-3 top-0 h-[3px] bg-forest transition-transform duration-300 ease-[var(--ease-ink)] ${on ? 'scale-x-100' : 'scale-x-0'}`} aria-hidden="true" />
              <Icon size={22} strokeWidth={on ? 2 : 1.5} aria-hidden="true" />
              <span>{t(`nav.${id}`)}</span>
            </button>
          );
        })}
        <button type="button" aria-current={inMore ? 'page' : undefined} aria-expanded={open} aria-controls="more-menu"
          onClick={() => setOpen(!open)}
          className={`relative flex flex-col items-center justify-center gap-1 border-0 bg-transparent text-[12px] font-medium ${inMore || open ? 'text-ink' : 'text-ink-soft'}`}>
          <span className={`absolute inset-x-3 top-0 h-[3px] bg-forest transition-transform duration-300 ${inMore ? 'scale-x-100' : 'scale-x-0'}`} aria-hidden="true" />
          <Ellipsis size={22} strokeWidth={inMore || open ? 2 : 1.5} aria-hidden="true" />
          <span>{t('nav.more')}</span>
        </button>
      </div>
    </nav>
  );
}
