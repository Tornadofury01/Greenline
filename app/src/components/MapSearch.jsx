// Search box at the top of the map: towns (bundled, offline) and addresses or roads (US Census Geocoder, online).
// The text and results live only in this component while the farmer searches, and are cleared after a choice.
// Nothing is saved, put in the URL or logged (see data/geocode.js).
import { useEffect, useId, useRef, useState } from 'react';
import { Search, X, MapPin, Building2, LoaderCircle, Lock, WifiOff } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { matchTowns, geocodeAddress } from '../data/geocode.js';

export default function MapSearch({ online, onChoose }) {
  const { t } = useApp();
  const [text, setText] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState(null); // null | 'searching' | 'none' | 'error'
  const [focused, setFocused] = useState(false);
  const listId = useId();
  const inputRef = useRef(null);
  const runId = useRef(0);

  // Towns show while typing (offline too). Addresses wait for Enter / the search button.
  useEffect(() => {
    setResults(matchTowns(text));
    setStatus(null);
  }, [text]);

  const clear = () => { runId.current++; setText(''); setResults([]); setStatus(null); };

  async function submit(e) {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    const towns = matchTowns(q);
    if (!online) { setResults(towns); setStatus(towns.length ? null : 'offline'); return; }
    const run = ++runId.current;
    setStatus('searching');
    try {
      const found = await geocodeAddress(q);
      if (run !== runId.current) return;
      const all = [...towns, ...found].slice(0, 3);
      setResults(all);
      setStatus(all.length ? null : 'none');
    } catch {
      if (run !== runId.current) return;
      setResults(towns);
      setStatus(towns.length ? null : 'error');
    }
  }

  function choose(r) {
    clear();
    inputRef.current?.blur();
    onChoose(r);
  }

  const showPanel = focused || results.length > 0 || status;

  return (
    <div className="map-search">
      {/* panel and note stack under the box */}
      <form role="search" className="map-search-box" onSubmit={submit} aria-label={t('search.label')}>
        <Search size={20} aria-hidden="true" className="map-search-icon" />
        <input ref={inputRef} type="search" value={text} onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder={t('search.placeholder')} aria-label={t('search.placeholder')}
          autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"
          aria-controls={listId} aria-expanded={results.length > 0} />
        {text && (
          <button type="button" className="map-search-btn" aria-label={t('search.clear')} onClick={clear}><X size={20} aria-hidden="true" /></button>
        )}
        <button type="submit" className="map-search-btn map-search-go" aria-label={t('search.go')} disabled={!text.trim() || status === 'searching'}>
          {status === 'searching' ? <LoaderCircle size={20} className="spin" aria-hidden="true" /> : <Search size={20} aria-hidden="true" />}
        </button>
      </form>
      {showPanel && (
        <div className="map-search-panel" aria-live="polite">
          {results.length > 0 && (
            <ul id={listId} className="map-search-results">
              {results.map((r, i) => (
                <li key={`${r.kind}-${i}`}>
                  {/* onMouseDown: choose before the input's blur hides the list */}
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)}>
                    {r.kind === 'town' ? <Building2 size={18} aria-hidden="true" /> : <MapPin size={18} aria-hidden="true" />}
                    <span>{r.label}</span>
                    <small>{t(`search.kind.${r.kind}`)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {status === 'none' && <p className="map-search-msg">{t('search.none')}</p>}
          {status === 'error' && <p className="map-search-msg">{t('search.error')}</p>}
          {(!online || status === 'offline') && <p className="map-search-msg"><WifiOff size={14} aria-hidden="true" />{t('search.offline')}</p>}
        </div>
      )}
      {/* The only privacy text under the box, always visible. */}
      <p className="map-search-note"><Lock size={12} aria-hidden="true" />{t('search.privacy')}</p>
    </div>
  );
}
