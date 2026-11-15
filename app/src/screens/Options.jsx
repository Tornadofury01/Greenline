// Screen 4 (v2): Options. Today's rotation first, then the top options against it.
// Data: ONE loader (data/loadV2.js) -> data/v2Options.js -> cards. The sample banner shows only when the sample is used.
import { useMemo } from 'react';
import { Lightbulb, Target } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { useV2 } from '../state/useV2.js';
import { buildOptionCards } from '../data/v2Options.js';
import OptionCard from '../components/OptionCard.jsx';
import { SampleBanner, PlaceholderNotice } from '../components/PlaceholderTag.jsx';
import { NeedField, PageHead } from '../components/Small.jsx';

// The cards themselves (props only, so a preview or test can feed them anything).
export function OptionsView({ cards, sample = false }) {
  const { t } = useApp();
  const all = [cards.current, ...cards.options];
  // One dollar scale for every card, so the profit bars can be compared by eye.
  const pad = 10;
  const scale = {
    min: Math.max(0, Math.min(...all.map((c) => c.profit.low)) - pad),
    max: Math.max(...all.map((c) => c.profit.high)) + pad,
  };
  return (
    <div className="screen screen-options">
      {sample && <SampleBanner />}
      {all.some((c) => c.placeholders.length > 0) && <PlaceholderNotice />}
      <PageHead title={t('optionsScreen.title')} intro={t('optionsScreen.intro')} />
      {cards.goals.length > 0 && (
        <p className="takeaway small"><Target size={18} aria-hidden="true" /><span>{t('optionsScreen.weightedFor', { goals: cards.goals.map((k) => t(k)).join(', ') })}</span></p>
      )}
      {all.map((c) => <OptionCard key={c.id} card={c} scale={scale} />)}
      <p className="takeaway small"><Lightbulb size={18} aria-hidden="true" /><span>{t('optionsScreen.takeaway')}</span></p>
    </div>
  );
}

export default function Options() {
  const { t, field } = useApp();
  const v2 = useV2();
  const cards = useMemo(() => (v2.status === 'ready' ? buildOptionCards(v2.data) : null), [v2.status, v2.data]);
  if (!field) return <div className="screen"><NeedField /></div>;
  if (v2.status === 'loading') return <div className="screen"><p className="muted" role="status">{t('optionsScreen.loading')}</p></div>;
  if (v2.status === 'error') {
    return (
      <div className="screen">
        <PageHead title={t('optionsScreen.title')} />
        <p className="sheet-note sheet-warn" role="alert">{t(`optionsScreen.error.${v2.error === 'invalid' ? 'invalid' : 'network'}`)}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>{t('pick.retry')}</button>
      </div>
    );
  }
  return <OptionsView cards={cards} sample={v2.usingSample} />;
}
