// Scenario card for the Compare screen: replay a real bad year (presets: the drought years of the Model C placeholder,
// not a model result) or build a what-if year with the sliders. One scenario at a time.
import { History } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { YEAR_COLORS } from '../screens/FieldStory.jsx';
import { PlaceholderTag } from './PlaceholderTag.jsx';
import WhatIfSliders, { HypotheticalBanner } from './WhatIfSliders.jsx';

export default function ReplayBar({ embedded = false }) {
  const { t, field, replayYear, setReplayYear, whatIf, setWhatIf } = useApp();
  const presets = field.si?.replayPresets
    || field.climateYearly.filter((y) => y.yearType === 'drought').slice(-3).map((y) => ({ year: y.year, yearType: y.yearType }));
  return (
    <section className="card" aria-labelledby="replay-title">
      <h2 id="replay-title" className="section-title"><History size={20} aria-hidden="true" />{t('replayUi.title')}</h2>
      {embedded && whatIf && <HypotheticalBanner />}
      {presets.length > 0 && (
        <>
          <p className="chart-caption">{t('replayUi.caption')} {field.yearTypesPlaceholder && <PlaceholderTag />}</p>
          <div className="chips" role="group" aria-label={t('replayUi.pickLabel')}>
            {!embedded && (
              <button type="button" className="chip" aria-pressed={replayYear == null && !whatIf} onClick={() => { setReplayYear(null); setWhatIf(null); }}>
                {t('replayUi.off')}
              </button>
            )}
            {presets.map((p) => (
              <button key={p.year} type="button" className="chip" aria-pressed={replayYear === p.year}
                onClick={() => setReplayYear(replayYear === p.year && !embedded ? null : p.year)}>
                <span className="swatch" style={{ background: YEAR_COLORS[p.yearType] }} aria-hidden="true" />
                {p.year} · {t(`yearType.${p.yearType}`)}
              </button>
            ))}
          </div>
        </>
      )}
      <WhatIfSliders />
    </section>
  );
}
