// Screen 5: a printable one-page summary for a county extension agent.
import { useApp } from '../state/AppContext.jsx';
import { useScores } from '../state/useScores.js';
import { formatReason } from '../i18n.js';
import { NeedField, JudgmentNote } from '../components/Small.jsx';
import { FieldSummary } from './PickField.jsx';
import { climateStats } from './FieldStory.jsx';

export default function ExpertHandoff() {
  const { t, lang, field, farm } = useApp();
  const scores = useScores();
  if (!field) return <div className="screen"><NeedField /></div>;

  const stats = climateStats(field);
  const rows = [
    scores.current && { label: t('compare.current'), r: scores.current },
    ...scores.suggested.map((r) => ({ label: t(`rotations.${r.rotationId}`), r })),
  ].filter(Boolean);
  const list = (group, ids) => ids.map((id) => t(`${group}.${id}`)).join(', ');

  return (
    <div className="screen handoff">
      <div className="no-print">
        <button className="btn primary wide" onClick={() => window.print()}>{t('handoff.print')}</button>
      </div>

      <h1>{t('handoff.title')}</h1>
      <p>{t('handoff.intro')}</p>

      <section className="card">
        <h2>{t('handoff.fieldSection')}</h2>
        <FieldSummary field={field} />
      </section>

      <section className="card">
        <h2>{t('handoff.climateSection')}</h2>
        <ul>
          <li>{t('story.statDrought')}: {stats.droughtYears.join(', ')}</li>
          <li>{t('story.statRain')}: {stats.avgRain} {t('story.mm')}</li>
          <li>{t('story.statHeat')}: {stats.avgHeat} {t('story.days')}</li>
          <li>{t('story.statBare')}: {stats.avgBare} {t('story.days')}</li>
        </ul>
      </section>

      <section className="card">
        <h2>{t('handoff.farmSection')}</h2>
        <ul>
          <li>{t('farm.yourList')}: {list('crops', farm.currentRotation) || '—'}</li>
          <li>{t('farm.priorities')} {list('priorities', farm.priorities) || '—'}</li>
          <li>{t('farm.waterMode')} {t(`options.waterMode.${farm.waterMode}`)} · {t(`options.waterSource.${farm.waterSource}`)}</li>
          <li>{t('farm.equipment')}: {list('options.equipment', farm.equipment) || '—'}</li>
          <li>{t('farm.budget')}: {t(`options.budget.${farm.budget}`)}</li>
          <li>{t('farm.market')} {t(`options.market.${farm.market}`)}</li>
        </ul>
      </section>

      <section className="card">
        <h2>{t('handoff.resultsSection')}</h2>
        {rows.map(({ label, r }) => (
          <div key={label} className="handoff-rot">
            <h3>{label}: {r.total}/100 · {t('compare.confidence')} {t(`confidenceLevel.${r.confidence.level}`)}</h3>
            <p>{r.crops.map((id) => t(`crops.${id}`)).join(' → ')}</p>
            <ul>
              {[...r.reasons, ...r.gaps, ...r.risks].map((x, i) => <li key={i}>{formatReason(t, x)}</li>)}
            </ul>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>{t('handoff.questionsSection')}</h2>
        <ol>{t('handoff.questions').map((q) => <li key={q}>{q}</li>)}</ol>
        <h2>{t('handoff.notesSection')}</h2>
        <div className="notes-box" />
      </section>

      <section className="card">
        <h2>{t('handoff.sources')}</h2>
        <ul className="small">
          {field.sources.map((s) => <li key={s.dataset}>{s.dataset}: {s.variable} ({s.resolution}, {s.dateRange})</li>)}
        </ul>
      </section>

      <JudgmentNote />
      <p className="muted small">{t('handoff.generated', { date: new Date().toLocaleDateString(lang) })}</p>
    </div>
  );
}
