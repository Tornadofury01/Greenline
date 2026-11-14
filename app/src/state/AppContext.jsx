// App-wide state: language, current screen, selected field, and the farmer's answers.
// Answers are saved in localStorage as a convenience only (it can be empty or blocked).
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { makeT } from '../i18n.js';
import { loadFieldAt, loadDemoField, guessCurrentRotation } from '../data/loadField.js';

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
  // The bad year being replayed on the Compare screen (null = normal years). Shared so Field story can open it.
  const [replayYear, setReplayYear] = useState(null);
  const [farm, setFarm] = useState({ ...DEFAULT_FARM, ...saved.farm });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ lang, farm })); } catch { /* ignore */ }
    document.documentElement.lang = lang;
  }, [lang, farm]);

  const [loading, setLoading] = useState(false);

  async function loadInto(load) {
    setLoading(true);
    try {
      const f = await load();
      setField(f);
      setReplayYear(null);
      setFarm((prev) => (prev.currentRotation.length ? prev : { ...prev, currentRotation: guessCurrentRotation(f) }));
    } finally {
      setLoading(false);
    }
  }
  // The tap position is only passed to loadFieldAt to find the nearest sampled field. It is not kept.
  const pickField = (lat, lon) => loadInto(() => loadFieldAt(lat, lon));
  const pickDemo = () => loadInto(loadDemoField);

  const updateFarm = (patch) => setFarm((prev) => ({ ...prev, ...patch }));
  const t = useMemo(() => makeT(lang), [lang]);

  const value = { lang, setLang, t, screen, setScreen, how, openHow, field, replayYear, setReplayYear, pickField, pickDemo, loading, farm, updateFarm };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
