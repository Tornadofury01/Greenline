// App-wide state: language, current screen, selected field, and the farmer's answers.
// Answers are saved in localStorage as a convenience only (it can be empty or blocked).
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { makeT } from '../i18n.js';
import { loadFieldAt, loadFieldById, loadDemoField, guessCurrentRotation } from '../data/loadField.js';

const AppContext = createContext(null);
const STORAGE_KEY = 'greenline:v1';

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
  const [farm, setFarm] = useState({ ...DEFAULT_FARM, ...saved.farm });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ lang, farm })); } catch { /* ignore */ }
    document.documentElement.lang = lang;
  }, [lang, farm]);

  const [loading, setLoading] = useState(false);
  // A field file that couldn't be loaded: { reason: 'network' | 'missing', id }. The previous field stays on screen.
  const [loadError, setLoadError] = useState(null);

  async function loadInto(load) {
    setLoading(true);
    setLoadError(null);
    try {
      const f = await load();
      if (f.error) { setLoadError({ reason: f.error, id: f.id }); return; }
      setField(f);
      setReplayYearRaw(null);
      setWhatIfRaw(null);
      setFarm((prev) => (prev.currentRotation.length ? prev : { ...prev, currentRotation: guessCurrentRotation(f) }));
    } finally {
      setLoading(false);
    }
  }
  // The tap position is only passed to loadFieldAt to find the nearest sampled field. It is not kept.
  const pickField = (lat, lon) => loadInto(() => loadFieldAt(lat, lon));
  const pickFieldById = (id) => loadInto(() => loadFieldById(id));
  const pickDemo = () => loadInto(loadDemoField);
  // Retry by field id (no coordinates are kept for this).
  const retryLoad = () => loadError?.id && pickFieldById(loadError.id);

  const updateFarm = (patch) => setFarm((prev) => ({ ...prev, ...patch }));
  const t = useMemo(() => makeT(lang), [lang]);

  const value = { lang, setLang, t, screen, setScreen, how, openHow, field, replayYear, setReplayYear, whatIf, setWhatIf, pickField, pickFieldById, pickDemo, retryLoad, loadError, loading, farm, updateFarm };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
