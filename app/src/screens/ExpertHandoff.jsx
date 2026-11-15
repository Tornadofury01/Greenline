// Screen 5: a printable one-page summary for a county extension agent. Always prints light (theme.css @media print).
import { Printer, MapPin, CloudRain, CalendarX, Thermometer, Sun, Tractor, Scale, HelpCircle, NotebookPen, Database } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { useScores } from '../state/useScores.js';
import { formatReason, sourceText } from '../i18n.js';
import { NeedField, JudgmentNote, PageHead, ModelCard, MiniStat } from '../components/Small.jsx';
import { FieldFacts } from './PickField.jsx';
import { SoilFacts, FrostFacts } from '../components/SoilFacts.jsx';
import { climateStats } from '../display.js';
import { outlineFor } from '../data/loadField.js';

function Table({ rows }) {
  return (
    <table className="doc-table">
      <tbody>
        {rows.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>)}
      </tbody>
    </table>
  );
}

function Kicker({ icon: Icon, children }) {
  return <h2 className="card-kicker"><Icon size={18} aria-hidden="true" />{children}</h2>;
}

export default function ExpertHandoff() {
  const { t, lang, field, farm } = useApp();
  const scores = useScores();
  if (!field) return <div className="screen"><NeedField /></div>;

  const s = climateStats(field);
  const outline = outlineFor(field.field.id);
  const rotations = [
    scores.current && { key: 'current', label: t('compare.current'), r: scores.current },
    ...scores.suggested.map((r, i) => ({ key: r.rotationId, label: `${t('compare.option', { letter: t(`compare.letters.${i}`) })}: ${t(`rotations.${r.rotationId}`)}`, r })),
  ].filter(Boolean);
  const list = (group, ids) => ids.map((id) => t(`${group}.${id}`)).join(', ') || '—';
  const from = field.climateYearly[0]?.year;
  const to = field.climateYearly.at(-1)?.year;

  return (
    <div className="screen screen-doc">
      <PageHead title={t('handoff.title')} intro={t('handoff.intro')} />

      <section className="card doc-section">
        <div className="card-head">
          <Kicker icon={MapPin}>{t('handoff.fieldSection')}</Kicker>
          <span className="card-meta">
            {outline ? t('handoff.fieldMeta', { id: field.field.id, acres: Math.round(outline.acres) }) : field.field.id}
          </span>
        </div>
        <FieldFacts field={field} />
        <SoilFacts field={field} />
        <FrostFacts field={field} />
      </section>

      <section className="card doc-section">
        <div className="card-head">
          <Kicker icon={CloudRain}>{t('handoff.climateTitle')}</Kicker>
          <span className="card-meta">{from}–{to}</span>
        </div>
        <div className="mini-stats">
          <MiniStat icon={CalendarX} label={t('story.statDrought')} value={s.droughtYears.length} detail={s.droughtYears.join(', ')} src={['NASA POWER', 'Greenline SI models']} />
          <MiniStat icon={CloudRain} label={t('story.statRain')} value={s.avgRainIn} unit={t('units.in')} detail={t('story.rainDetail', { mm: s.avgRainMm })} src={['NASA POWER']} />
          <MiniStat icon={Thermometer} label={t('story.statHeat')} value={s.avgHeatDays} detail={t('story.heatDetail')} src={['NASA POWER']} />
          <MiniStat icon={Sun} label={t('handoff.bareLabel')} value={s.avgBareDays} detail={t('handoff.bareDetail')} src={['Landsat 8/9']} />
        </div>
        <p className="hero-note">{t('story.undercount')}</p>
      </section>

      <section className="card doc-section">
        <Kicker icon={Tractor}>{t('handoff.farmSection')}</Kicker>
        <Table rows={[
          [t('handoff.growNow'), list('crops', farm.currentRotation)],
          [t('handoff.goals'), list('priorities', farm.priorities)],
          [t('handoff.water'), `${t(`options.waterMode.${farm.waterMode}`)} · ${t(`options.waterSource.${farm.waterSource}`)}`],
          [t('farm.equipment'), list('options.equipment', farm.equipment)],
          [t('farm.budget'), t(`options.budget.${farm.budget}`)],
          [t('handoff.sells'), t(`options.market.${farm.market}`)],
        ]} />
      </section>

      <section className="card doc-section">
        <Kicker icon={Scale}>{t('handoff.resultsSection')}</Kicker>
        {rotations.map(({ key, label, r }) => (
          <div key={key} className="doc-rot">
            <div className="doc-rot-head">
              <h3>{label}</h3>
              <span className="doc-score">{r.total}<small>/100</small></span>
            </div>
            <p className="muted">{r.crops.map((id) => t(`crops.${id}`)).join(' → ')}</p>
            <div className="pills">
              <span className="pill">{t('compare.confidenceBadge', { level: t(`confidenceLevel.${r.confidence.level}`) })}</span>
              <span className="pill">{t('handoff.barePill', { n: r.bareDays.bareDays })}</span>
            </div>
            <ul>{[...r.reasons, ...r.gaps, ...r.risks].map((x, i) => <li key={i}>{formatReason(t, x)}</li>)}</ul>
          </div>
        ))}
        <p className="muted small">{t('handoff.bareNote')}</p>
      </section>

      <ModelCard />

      <section className="card doc-section">
        <Kicker icon={HelpCircle}>{t('handoff.questionsSection')}</Kicker>
        <ol>{t('handoff.questions').map((q) => <li key={q}>{q}</li>)}</ol>
      </section>

      <section className="card doc-section">
        <Kicker icon={NotebookPen}>{t('handoff.notesSection')}</Kicker>
        <div className="notes-box" />
      </section>

      <section className="card doc-section">
        <Kicker icon={Database}>{t('handoff.sources')}</Kicker>
        {field.isSampleData && <p className="muted">{t('handoff.sampleNote')}</p>}
        <Table rows={field.sources.map((src) => { const x = sourceText(t, src); return [src.dataset, [x.variable, x.resolution, x.dates, src.scale && t(`common.scale.${src.scale}`)].filter(Boolean).join(' · ')]; })} />
      </section>

      <JudgmentNote />
      <p className="source">{t('handoff.generated', { date: new Date().toLocaleDateString(lang) })}</p>

      <button type="button" className="btn btn-primary btn-block btn-cta no-print" onClick={() => window.print()}>
        <Printer size={20} aria-hidden="true" />{t('handoff.print')}
      </button>
      <p className="hint small no-print">{t('handoff.printNote')}</p>
    </div>
  );
}
