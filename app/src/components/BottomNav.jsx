import { useEffect, useRef, useState } from 'react';
import { MapPin, Tractor, CloudRain, Scale, ClipboardList, ListChecks, Trophy, ThermometerSun, Ellipsis } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';

// Screen ids in order, with one Lucide icon each. `more: true` = lives in the "More" menu on phones and tablets
// (eight tabs do not fit at 375 px); the desktop header shows all of them.
export const SCREENS = [
  { id: 'field', Icon: MapPin },
  { id: 'farm', Icon: Tractor, more: true },
  { id: 'story', Icon: CloudRain },
  { id: 'risks', Icon: ThermometerSun },
  { id: 'options', Icon: ListChecks },
  { id: 'plans', Icon: Trophy },
  { id: 'compare', Icon: Scale, more: true },
  { id: 'handoff', Icon: ClipboardList, more: true },
];
const TABS = SCREENS.filter((s) => !s.more);
const MORE = SCREENS.filter((s) => s.more);

// Desktop header: every screen as a tab.
export function NavItems() {
  const { t, screen, setScreen } = useApp();
  return SCREENS.map(({ id, Icon }) => (
    <button key={id} type="button" aria-current={screen === id ? 'page' : undefined} onClick={() => setScreen(id)}>
      <Icon size={24} strokeWidth={screen === id ? 2.25 : 1.75} aria-hidden="true" />
      <span>{t(`nav.${id}`)}</span>
    </button>
  ));
}

export default function BottomNav() {
  const { t, screen, setScreen } = useApp();
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const inMore = MORE.some((s) => s.id === screen);
  useEffect(() => { setOpen(false); }, [screen]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);
  return (
    <nav className="bottom-nav" aria-label={t('nav.label')} ref={wrap}>
      {open && (
        <ul className="more-menu" id="more-menu" aria-label={t('nav.moreLabel')}>
          {MORE.map(({ id, Icon }) => (
            <li key={id}>
              <button type="button" aria-current={screen === id ? 'page' : undefined} onClick={() => setScreen(id)}>
                <Icon size={22} aria-hidden="true" /><span>{t(`nav.${id}Long`)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="bottom-nav-inner">
        {TABS.map(({ id, Icon }) => (
          <button key={id} type="button" aria-current={screen === id ? 'page' : undefined} onClick={() => setScreen(id)}>
            <Icon size={24} strokeWidth={screen === id ? 2.25 : 1.75} aria-hidden="true" />
            <span>{t(`nav.${id}`)}</span>
          </button>
        ))}
        <button type="button" className={inMore ? 'is-active' : undefined} aria-current={inMore ? 'page' : undefined}
          aria-expanded={open} aria-controls="more-menu" onClick={() => setOpen(!open)}>
          <Ellipsis size={24} strokeWidth={inMore || open ? 2.25 : 1.75} aria-hidden="true" />
          <span>{t('nav.more')}</span>
        </button>
      </div>
    </nav>
  );
}
