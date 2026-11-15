// Search box at the top of the map: towns (bundled, offline) and addresses or roads (US Census Geocoder, online).
// The text and results live only in this component while the farmer searches, and are cleared after a choice.
// Nothing is saved, put in the URL or logged (see data/geocode.js).
import { useEffect, useId, useRef, useState } from 'react';
import { Search, X, MapPin, Building2, LoaderCircle, Lock, WifiOff } from 'lucide-react';

// The only privacy text under the box, always visible (PickField puts it next to the Dallas pointer).
export function SearchPrivacy() {
  const { t } = useApp();
  return <p className="mt-1.5 inline-flex items-center gap-1.5 bg-paper/90 px-2 py-1 text-[12px] font-medium text-ink"><Lock size={12} aria-hidden="true" />{t('search.privacy')}</p>;
}
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
    <div className="relative">
      {/* panel and note stack under the box */}
      <form role="search" onSubmit={submit} aria-label={t('search.label')}
        className="flex h-12 items-center gap-2 border border-ink bg-paper-raised pl-3 pr-1 shadow-[0_6px_18px_-10px_rgb(30_26_18/0.4)] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-forest">
        <Search size={18} aria-hidden="true" className="flex-none text-ink-soft" />
        <input ref={inputRef} type="search" value={text} onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder={t('search.placeholder')} aria-label={t('search.placeholder')}
          autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-soft [&::-webkit-search-cancel-button]:hidden"
          aria-controls={listId} aria-expanded={results.length > 0} />
        {text && (
          <button type="button" className="plat-tool bg-transparent" aria-label={t('search.clear')} onClick={clear}><X size={20} aria-hidden="true" /></button>
        )}
        <button type="submit" className="plat-tool bg-paper-deep disabled:bg-transparent" aria-label={t('search.go')} disabled={!text.trim() || status === 'searching'}>
          {status === 'searching' ? <LoaderCircle size={20} className="plat-spin" aria-hidden="true" /> : <Search size={20} aria-hidden="true" />}
        </button>
      </form>
      {showPanel && (
        <div aria-live="polite" className="absolute inset-x-0 top-[calc(100%-1px)] z-10 border border-ink bg-paper-raised">
          {results.length > 0 && (
            <ul id={listId} className="m-0 list-none p-0">
              {results.map((r, i) => (
                <li key={`${r.kind}-${i}`} className="border-b border-rule last:border-b-0">
                  {/* onMouseDown: choose before the input's blur hides the list */}
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)}
                    className="flex min-h-12 w-full items-center gap-3 border-0 bg-transparent px-3 text-left text-[15px] text-ink hover:bg-paper-deep focus-visible:bg-paper-deep">
                    {r.kind === 'town' ? <Building2 size={18} aria-hidden="true" className="flex-none text-ink-soft" /> : <MapPin size={18} aria-hidden="true" className="flex-none text-ink-soft" />}
                    <span className="min-w-0 flex-1 leading-snug">{r.label}</span>
                    <small className="plat-label flex-none text-[12px] text-ink-soft">{t(`search.kind.${r.kind}`)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {status === 'none' && <p className="flex items-start gap-1.5 px-3 py-2.5 text-[14px] leading-snug text-ink">{t('search.none')}</p>}
          {status === 'error' && <p className="flex items-start gap-1.5 px-3 py-2.5 text-[14px] leading-snug text-ink">{t('search.error')}</p>}
          {(!online || status === 'offline') && <p className="flex items-start gap-1.5 px-3 py-2.5 text-[14px] leading-snug text-ink"><WifiOff size={14} aria-hidden="true" />{t('search.offline')}</p>}
        </div>
      )}
    </div>
  );
}
