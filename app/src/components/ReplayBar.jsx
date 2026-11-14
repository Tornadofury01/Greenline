// Bad-year replay picker for the Compare screen. Presets come from the year-pattern model (si.replayPresets).
import { History } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { YEAR_COLORS } from '../screens/FieldStory.jsx';

export default function ReplayBar() {
  const { t, field, replayYear, setReplayYear } = useApp();
  const presets = field.si?.replayPresets
    || field.climateYearly.filter((y) => y.yearType === 'drought').slice(-3).map((y) => ({ year: y.year, yearType: y.yearType }));
  if (!presets.length) return null;
  return (
    <section className="card" aria-labelledby="replay-title">
      <h2 id="replay-title" className="section-title"><History size={20} aria-hidden="true" />{t('replayUi.title')}</h2>
      <p className="chart-caption">{t('replayUi.caption')}</p>
      <div className="chips" role="group" aria-label={t('replayUi.pickLabel')}>
        <button type="button" className="chip" aria-pressed={replayYear == null} onClick={() => setReplayYear(null)}>
          {t('replayUi.off')}
        </button>
        {presets.map((p) => (
          <button key={p.year} type="button" className="chip" aria-pressed={replayYear === p.year}
            onClick={() => setReplayYear(replayYear === p.year ? null : p.year)}>
            <span className="swatch" style={{ background: YEAR_COLORS[p.yearType] }} aria-hidden="true" />
            {p.year} · {t(`yearType.${p.yearType}`)}
          </button>
        ))}
      </div>
    </section>
  );
}
