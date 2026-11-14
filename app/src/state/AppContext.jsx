// App-wide state: language, current screen, selected field, and the farmer's answers.
// Answers are saved in localStorage as a convenience only (it can be empty or blocked).
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { makeT } from '../i18n.js';
import { loadFieldAt, guessCurrentRotation } from '../data/loadField.js';

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
  const [field, setField] = useState(null);
  const [farm, setFarm] = useState({ ...DEFAULT_FARM, ...saved.farm });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ lang, farm })); } catch { /* ignore */ }
    document.documentElement.lang = lang;
  }, [lang, farm]);

  async function pickField(lat, lon) {
    const f = await loadFieldAt(lat, lon);
    setField(f);
    setFarm((prev) => (prev.currentRotation.length ? prev : { ...prev, currentRotation: guessCurrentRotation(f) }));
  }

  const updateFarm = (patch) => setFarm((prev) => ({ ...prev, ...patch }));
  const t = useMemo(() => makeT(lang), [lang]);

  const value = { lang, setLang, t, screen, setScreen, field, pickField, farm, updateFarm };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
