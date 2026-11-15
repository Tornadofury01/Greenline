// Screen 4 (v2): Options. Today's rotation first, then the top options against it.
// Props only for now: `current` and `options` use the layout-time shape documented in components/OptionCard.jsx.
// The loader (one place for all v2 data) will map the data contract into these props.
import { Lightbulb } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import OptionCard from '../components/OptionCard.jsx';
import { SampleBanner } from '../components/PlaceholderTag.jsx';
import { PageHead } from '../components/Small.jsx';

export default function Options({ current, options, sample = false }) {
  const { t } = useApp();
  const all = [current, ...options].filter(Boolean);
  // One dollar scale for every card, so the profit bars can be compared by eye.
  const lows = all.map((o) => o.profit.low);
  const highs = all.map((o) => o.profit.high);
  const pad = 10;
  const scale = { min: Math.max(0, Math.min(...lows) - pad), max: Math.max(...highs) + pad };
  return (
    <div className="screen screen-options">
      {sample && <SampleBanner />}
      <PageHead title={t('optionsScreen.title')} intro={t('optionsScreen.intro')} />
      {all.map((o) => <OptionCard key={o.id} option={o} scale={scale} />)}
      <p className="takeaway small"><Lightbulb size={18} aria-hidden="true" /><span>{t('optionsScreen.takeaway')}</span></p>
    </div>
  );
}
