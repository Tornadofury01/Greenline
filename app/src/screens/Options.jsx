// Screen 4 (v2): Options. Today's rotation first, then the top options against it.
// Data: ONE loader (data/loadV2.js) -> data/v2Options.js -> cards. The sample banner shows only when the sample is used.
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { useV2 } from '../state/useV2.js';
import { buildOptionCards } from '../data/v2Options.js';
import OptionSlice, { optionLabel, rotationText } from '../components/OptionSlice.jsx';
import { SampleBanner, PlaceholderNotice } from '../components/PlaceholderTag.jsx';
import { NeedField, PageHead } from '../components/Small.jsx';

// The page itself (props only, so a preview or test can feed it anything). Laid out like anduril.com/air-defense:
// a header slice (label, big title, a row of intro + index links, the field's satellite still), a side-by-side
// comparison row, then one open section per rotation. No cards anywhere.
export function OptionsView({ cards, sample = false, photo = '' }) {
  const { t, field } = useApp();
  const all = [cards.current, ...cards.options];
  // One dollar scale for every rotation, so the profit bars can be compared by eye.
  const pad = 10;
  const scale = {
    min: Math.max(0, Math.min(...all.map((c) => c.profit.low)) - pad),
    max: Math.max(...all.map((c) => c.profit.high)) + pad,
  };
  const jump = (id) => document.getElementById(`opt-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="ad-page">
      {sample && <SampleBanner />}
      {all.some((c) => c.placeholders.length > 0) && <PlaceholderNotice />}

      <header className="ad-hero">
        <p className="ad-label">{t('pick.fieldName', { id: field?.field?.id ?? '' })}</p>
        <h1 className="ad-title">{t('optionsScreen.title')}</h1>
        <div className="ad-hero-row">
          <p className="ad-label">{t('optionsScreen.indexLabel')}</p>
          <p className="ad-label ad-hero-intro">{t('optionsScreen.intro')}</p>
          <nav className="ad-index" aria-label={t('optionsScreen.indexLabel')}>
            {all.map((c) => (
              <button key={c.id} type="button" className="ad-label" onClick={() => jump(c.id)}>
                {c.kind === 'current' ? t('optionsScreen.current') : t('optionsScreen.option', { letter: c.letter })}
              </button>
            ))}
          </nav>
        </div>
        {photo && (
          <figure className="ad-media">
            <img src={photo} alt="" />
          </figure>
        )}
      </header>

      <section className="ad-compare" aria-labelledby="ad-compare-title">
        <div className="ad-row">
          <p className="ad-label ad-row-label" id="ad-compare-title">{t('optionsScreen.sideBySide')}</p>
          <div className="ad-row-body">
            {cards.goals.length > 0 && (
              <p className="ad-small ad-goals">{t('optionsScreen.weightedFor', { goals: cards.goals.map((k) => t(k)).join(', ') })}</p>
            )}
            <ol className="ad-compare-cols" style={{ '--n': all.length }}>
              {all.map((c) => (
                <li key={c.id} className={c.best ? 'is-best' : undefined}>
                  <button type="button" onClick={() => jump(c.id)}>
                    <span className="ad-label">{optionLabel(t, c)}{c.best && <span className="ad-tag"> [{t('optionsScreen.best')}]</span>}</span>
                    <span className="ad-big">{Math.round(c.total)}<span className="ad-grade">{c.grade}</span></span>
                    <span className="ad-small">{rotationText(t, c)}</span>
                    <span className="ad-discover">{t('optionsScreen.seeDetails')}<ArrowDown size={15} aria-hidden="true" /></span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {all.map((c) => <OptionSlice key={c.id} card={c} scale={scale} />)}

      <p className="ad-label ad-footnote">{t('optionsScreen.takeaway')}</p>
    </div>
  );
}

function useFieldStill(id) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!id) return undefined;
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}history/fields/${id}.json`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const frame = data?.frames?.at(-1);
        if (frame?.src && !controller.signal.aborted) setSrc(`${import.meta.env.BASE_URL}${frame.src}`);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id]);
  return src;
}

export default function Options() {
  const { t, field } = useApp();
  const v2 = useV2();
  const photo = useFieldStill(field?.field?.id);
  const cards = useMemo(() => (v2.status === 'ready' ? buildOptionCards(v2.data) : null), [v2.status, v2.data]);
  if (!field) return <div className="screen"><NeedField /></div>;
  if (v2.status === 'loading') return <div className="screen"><p className="muted" role="status">{t('optionsScreen.loading')}</p></div>;
  if (v2.status === 'error') {
    return (
      <div className="screen">
        <PageHead title={t('optionsScreen.title')} />
        <p className="sheet-note sheet-warn" role="alert">{t(`optionsScreen.error.${['invalid', 'missing'].includes(v2.error) ? v2.error : 'network'}`)}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>{t('pick.retry')}</button>
      </div>
    );
  }
  return <OptionsView cards={cards} sample={v2.usingSample} photo={photo} />;
}
