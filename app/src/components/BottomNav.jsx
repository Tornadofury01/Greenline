import { useApp } from '../state/AppContext.jsx';

// Screen ids in order. Icons are simple inline SVG paths (24x24).
export const SCREENS = [
  { id: 'field', icon: 'M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z' },
  { id: 'farm', icon: 'M3 21V10l9-6 9 6v11h-6v-6H9v6H3z' },
  { id: 'story', icon: 'M4 20h16v-2H4v2zm1-4h3V8H5v8zm5 0h3V4h-3v12zm5 0h3v-6h-3v6z' },
  { id: 'compare', icon: 'M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h6V3zm4 0v18h6a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-6z' },
  { id: 'handoff', icon: 'M6 2h9l5 5v15H6V2zm8 1.5V8h4.5M9 12h8M9 16h8' },
];

export default function BottomNav() {
  const { t, screen, setScreen } = useApp();
  return (
    <nav className="bottom-nav">
      {SCREENS.map((s) => (
        <button
          key={s.id}
          className={screen === s.id ? 'active' : ''}
          aria-current={screen === s.id ? 'page' : undefined}
          onClick={() => setScreen(s.id)}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d={s.icon} fill="currentColor" stroke="currentColor" strokeWidth={s.id === 'handoff' ? 1.2 : 0} />
          </svg>
          <span>{t(`nav.${s.id}`)}</span>
        </button>
      ))}
    </nav>
  );
}
