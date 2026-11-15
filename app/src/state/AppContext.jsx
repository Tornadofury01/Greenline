// App-wide state: language, current screen, selected field, and the farmer's answers.
// Only the language is saved in localStorage (it can be empty or blocked). Farm answers are not kept between visits.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { makeT } from '../i18n.js';
import { loadFieldAt, loadFieldById, loadNearest, guessCurrentRotation } from '../data/loadField.js';

const AppContext = createContext(null);
const STORAGE_KEY = 'greenline:v1';
const THEME_KEY = 'greenline:theme'; // same key as the inline script in index.html

const DEFAULT_FARM = {
  currentRotation: [],
  priorities: ['water', 'soil'],
  waterMode: 'dryland',
  equipment: ['conventional'],
  budget: 'medium',
  waterSource: 'rain',
  market: 'elevator',
};

function readSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}

export function AppProvider({ children }) {
  const saved = useMemo(readSaved, []);
  const [lang, setLang] = useState(saved.lang || 'en');
  // Light / dark. First visit follows the phone's own setting; the header button overrides it and is saved.
  const [theme, setThemeRaw] = useState(() => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'));
  const setTheme = (next) => {
    setThemeRaw(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  };
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  // Cream background only: index.html sets data-theme="light"; the phone's dark setting is not followed.
  const [screen, setScreen] = useState('field');
  // "How we know" is opened from the header and from cards: remember where to return and which term to show.
  const [how, setHow] = useState({ from: 'field', term: null });
  const openHow = (term = null) => { setHow({ from: screen === 'how' ? how.from : screen, term }); setScreen('how'); };
  const [field, setField] = useState(null);
  // One scenario slot for the Compare screen: a real bad year (replayYear) OR a what-if ({ rainPct, heatDays }).
  // Picking one clears the other. Shared so Field story can open a replay.
  const [replayYear, setReplayYearRaw] = useState(null);
  const [whatIf, setWhatIfRaw] = useState(null);
  const setReplayYear = (year) => { setReplayYearRaw(year); if (year != null) setWhatIfRaw(null); };
  const setWhatIf = (w) => { setWhatIfRaw(w); if (w) setReplayYearRaw(null); };
  const [farm, setFarm] = useState({ ...DEFAULT_FARM });
  // Tillage (conventional / reduced / no-till) is the one farm answer kept on this device. null = not told yet:
  // the app then assumes reduced tillage and says so.
  const [tillage, setTillageRaw] = useState(() => { try { const v = localStorage.getItem('greenline:tillage'); return ['conventional', 'reduced', 'no-till'].includes(v) ? v : null; } catch { return null; } });
  const setTillage = (v) => { setTillageRaw(v); try { localStorage.setItem('greenline:tillage', v); } catch { /* ignore */ } };

  useEffect(() => {
    // Only the language is remembered. The farm answers are never saved: they reset on every visit.
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ lang })); } catch { /* ignore */ }
    document.documentElement.lang = lang;
  }, [lang]);

  const [loading, setLoading] = useState(false);
  // A field file that couldn't be loaded: { reason: 'network' | 'missing', id }. The previous field stays on screen.
  const [loadError, setLoadError] = useState(null);
  const fieldRequest = useRef(0);

  async function loadInto(load) {
    const request = ++fieldRequest.current;
    setLoading(true);
    setLoadError(null);
    try {
      const f = await load();
      if (request !== fieldRequest.current) return;
      if (f.error) { setLoadError({ reason: f.error, id: f.id }); return; }
      setField(f);
      setReplayYearRaw(null);
      setWhatIfRaw(null);
      setFarm((prev) => (prev.currentRotation.length ? prev : { ...prev, currentRotation: guessCurrentRotation(f) }));
    } finally {
      if (request === fieldRequest.current) setLoading(false);
    }
  }
  const clearField = () => {
    fieldRequest.current++;
    setField(null);
    setLoadError(null);
    setLoading(false);
    setReplayYearRaw(null);
    setWhatIfRaw(null);
    setFarm((prev) => ({ ...prev, currentRotation: [] }));
  };
  // The tap position is only passed to loadFieldAt to find the nearest sampled field. It is not kept.
  const pickField = (lat, lon) => loadInto(() => loadFieldAt(lat, lon));
  const pickFieldById = (id) => loadInto(() => loadFieldById(id));
  // A nearest-field summary from nearestTo() ({ id, nearestKm, notCropland }); no coordinates.
  const pickNearest = (info) => loadInto(() => loadNearest(info));
  // Retry by field id (no coordinates are kept for this).
  const retryLoad = () => loadError?.id && pickFieldById(loadError.id);

  const updateFarm = (patch) => setFarm((prev) => ({ ...prev, ...patch }));
  const t = useMemo(() => makeT(lang), [lang]);

  const value = { lang, setLang, theme, setTheme, t, screen, setScreen, how, openHow, field, replayYear, setReplayYear, whatIf, setWhatIf, pickField, pickFieldById, clearField, pickNearest, retryLoad, loadError, loading, farm, updateFarm, tillage, setTillage };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
