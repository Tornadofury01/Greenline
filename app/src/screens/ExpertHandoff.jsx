// Screen 5: a printable one-page summary for a county extension agent.
import { Printer } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { useScores } from '../state/useScores.js';
import { formatReason } from '../i18n.js';
import { NeedField, JudgmentNote, PageHead, ModelCard } from '../components/Small.jsx';
import { FieldFacts } from './PickField.jsx';
import { climateStats } from '../display.js';

function Table({ rows }) {
  return (
    <table className="doc-table">
      <tbody>
        {rows.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>)}
      </tbody>
    </table>
  );
}

export default function ExpertHandoff() {
  const { t, lang, field, farm } = useApp();
  const scores = useScores();
  if (!field) return <div className="screen"><NeedField /></div>;

  const s = climateStats(field);
  const rotations = [
    scores.current && { label: t('compare.current'), r: scores.current },
    ...scores.suggested.map((r, i) => ({ label: `${t('compare.option', { letter: t(`compare.letters.${i}`) })}: ${t(`rotations.${r.rotationId}`)}`, r })),
  ].filter(Boolean);
  const list = (group, ids) => ids.map((id) => t(`${group}.${id}`)).join(', ') || '—';

  return (
    <div className="screen">
      <PageHead title={t('handoff.title')} intro={t('handoff.intro')} />
      <button type="button" className="btn btn-primary btn-block btn-start no-print" onClick={() => window.print()}>
        <Printer size={20} aria-hidden="true" />{t('handoff.print')}
      </button>

      <div className="doc-grid">
      <section className="card doc-section">
        <h2>{t('handoff.fieldSection')}</h2>
        <FieldFacts field={field} />
      </section>

      <section className="card doc-section">
        <h2>{t('handoff.climateSection', { from: field.climateYearly[0]?.year, to: field.climateYearly.at(-1)?.year })}</h2>
        <Table rows={[
          [t('story.statDrought'), `${s.droughtYears.length} (${s.droughtYears.join(', ')})`],
          [t('story.statRain'), `${s.avgRainIn} ${t('units.in')} (${s.avgRainMm} mm)`],
          [t('story.statHeat'), `${s.avgHeatDays}`],
          [t('story.statBare'), `${s.avgBareDays}`],
        ]} />
      </section>

      <ModelCard />

      <section className="card doc-section">
        <h2>{t('handoff.farmSection')}</h2>
        <Table rows={[
          [t('handoff.growNow'), list('crops', farm.currentRotation)],
          [t('handoff.goals'), list('priorities', farm.priorities)],
          [t('handoff.water'), `${t(`options.waterMode.${farm.waterMode}`)} · ${t(`options.waterSource.${farm.waterSource}`)}`],
          [t('farm.equipment'), list('options.equipment', farm.equipment)],
          [t('farm.budget'), t(`options.budget.${farm.budget}`)],
          [t('handoff.sells'), t(`options.market.${farm.market}`)],
        ]} />
      </section>

      <section className="card doc-section span-all">
        <h2>{t('handoff.resultsSection')}</h2>
        {rotations.map(({ label, r }) => (
          <div key={label} className="doc-rot">
            <div className="doc-rot-head">
              <h3>{label}</h3>
              <strong className="nowrap">{r.total}/100</strong>
            </div>
            <p className="muted">
              {r.crops.map((id) => t(`crops.${id}`)).join(' → ')} · {t('compare.confidenceBadge', { level: t(`confidenceLevel.${r.confidence.level}`) })}
            </p>
            <ul>{[...r.reasons, ...r.gaps, ...r.risks].map((x, i) => <li key={i}>{formatReason(t, x)}</li>)}</ul>
          </div>
        ))}
      </section>

      <section className="card doc-section">
        <h2>{t('handoff.questionsSection')}</h2>
        <ol>{t('handoff.questions').map((q) => <li key={q}>{q}</li>)}</ol>
        <h2>{t('handoff.notesSection')}</h2>
        <div className="notes-box" />
      </section>

      <section className="card doc-section">
        <h2>{t('handoff.sources')}</h2>
        {field.isSampleData && <p className="muted">{t('handoff.sampleNote')}</p>}
        <Table rows={field.sources.map((src) => [src.dataset, `${src.variable} · ${src.resolution} · ${src.dateRange.replace('-', '–')}`])} />
      </section>
      </div>

      <JudgmentNote />
      <p className="source">{t('handoff.generated', { date: new Date().toLocaleDateString(lang) })}</p>
    </div>
  );
}
