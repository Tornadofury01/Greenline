import { MapPin, Tractor, CloudRain, Scale, ClipboardList } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';

// Screen ids in order, with one Lucide icon each.
export const SCREENS = [
  { id: 'field', Icon: MapPin },
  { id: 'farm', Icon: Tractor },
  { id: 'story', Icon: CloudRain },
  { id: 'compare', Icon: Scale },
  { id: 'handoff', Icon: ClipboardList },
];

// The tab buttons. Used by the bottom bar (phones/tablets) and the header nav (desktop).
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
  const { t } = useApp();
  return (
    <nav className="bottom-nav" aria-label={t('nav.label')}>
      <div className="bottom-nav-inner"><NavItems /></div>
    </nav>
  );
}
