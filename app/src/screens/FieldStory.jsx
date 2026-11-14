// Screen 3: 20 years of climate, colored by year type, plus bare-ground months.
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import { useApp } from '../state/AppContext.jsx';
import { BARE_NDVI } from '../data/loadField.js';
import { StatCard, NeedField, JudgmentNote } from '../components/Small.jsx';
import GlossaryIcon from '../components/GlossaryIcon.jsx';
// import VulnerabilityZonesMap from '../components/future/VulnerabilityZonesMap.jsx'; // FUTURE

export const YEAR_COLORS = { drought: '#c2410c', heat: '#d97706', wet: '#2563eb', normal: '#6b8f71' };
const avg = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

export function climateStats(field) {
  const c = field.climateYearly;
  return {
    droughtYears: c.filter((y) => y.yearType === 'drought').map((y) => y.year),
    avgRain: avg(c.map((y) => y.precipMm)),
    avgHeat: avg(c.map((y) => y.heatStressDays)),
    avgBare: avg(field.bareDaysPerYear.map((b) => b.days)),
  };
}

export default function FieldStory() {
  const { t, field } = useApp();
  if (!field) return <div className="screen"><NeedField /></div>;

  const stats = climateStats(field);
  const months = t('story.monthsShort');
  const years = field.climateYearly.map((y) => y.year);
  const ndvi = Object.fromEntries(field.ndviMonthly.map((n) => [`${n.year}-${n.month}`, n.ndvi]));

  return (
    <div className="screen">
      <h1>{t('story.title')}</h1>

      <div className="stats">
        <StatCard label={t('story.statDrought')} value={stats.droughtYears.length} unit={`(${stats.droughtYears.join(', ')})`} />
        <StatCard label={t('story.statRain')} value={stats.avgRain} unit={t('story.mm')} />
        <StatCard label={t('story.statHeat')} value={stats.avgHeat} unit={t('story.days')} />
        <StatCard label={t('story.statBare')} value={stats.avgBare} unit={t('story.days')} term="bareDays" />
      </div>

      <section className="card">
        <h2>{t('story.chartTitle')}</h2>
        <div className="legend">
          {Object.keys(YEAR_COLORS).map((k) => (
            <span key={k}><i style={{ background: YEAR_COLORS[k] }} /> {t(`yearType.${k}`)}</span>
          ))}
        </div>
        <div className="chart">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={field.climateYearly} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
              <XAxis dataKey="year" tickFormatter={(y) => `'${String(y).slice(2)}`} tick={{ fontSize: 11 }} interval={1} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v) => [`${v} ${t('story.mm')}`, t('story.chartUnit')]}
                labelFormatter={(y) => {
                  const row = field.climateYearly.find((r) => r.year === y);
                  return `${y} · ${t(`yearType.${row?.yearType}`)}`;
                }}
              />
              <Bar dataKey="precipMm" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {field.climateYearly.map((row) => <Cell key={row.year} fill={YEAR_COLORS[row.yearType]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card">
        <h2>{t('story.bareTitle')} <GlossaryIcon term="ndvi" /></h2>
        <p className="hint">{t('story.bareHint')}</p>
        <div className="bare-grid" role="table">
          <div className="bare-row" role="row">
            <span className="bare-year" />
            {months.map((m, i) => <span key={i} className="bare-head" role="columnheader">{m}</span>)}
          </div>
          {years.map((y) => (
            <div key={y} className="bare-row" role="row">
              <span className="bare-year" role="rowheader">{y}</span>
              {months.map((_, i) => {
                const v = ndvi[`${y}-${i + 1}`];
                return <span key={i} role="cell" className={`bare-cell ${v < BARE_NDVI ? 'bare' : ''}`} title={`NDVI ${v}`} />;
              })}
            </div>
          ))}
        </div>
      </section>

      <JudgmentNote />
    </div>
  );
}
