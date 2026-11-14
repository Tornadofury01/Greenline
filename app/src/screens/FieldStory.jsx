// Screen 3: lead with the answer, then 20 years of rain and bare-ground history.
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Sun, CloudRain, Thermometer, CalendarX, ArrowRight } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { BARE_NDVI } from '../data/loadField.js';
import { StatCard, NeedField, JudgmentNote, PageHead, Source } from '../components/Small.jsx';
import GlossaryIcon from '../components/GlossaryIcon.jsx';
import { climateStats, usuallyBareMonths, mmToIn } from '../display.js';
// import VulnerabilityZonesMap from '../components/future/VulnerabilityZonesMap.jsx'; // FUTURE

// Chart colors follow theme.css meaning: drought = risk red, heat = amber, wet = water blue.
export const YEAR_COLORS = { drought: '#a3362a', heat: '#c98a1b', wet: '#2f75a8', normal: '#8e9c90' };

const joinYears = (ys, t) => (ys.length > 1 ? `${ys.slice(0, -1).join(', ')} ${t('common.and')} ${ys.at(-1)}` : `${ys[0] ?? ''}`);

export default function FieldStory() {
  const { t, field, setScreen } = useApp();
  if (!field) return <div className="screen"><NeedField /></div>;

  const s = climateStats(field);
  const monthsShort = t('story.monthsShort');
  const monthsLong = t('story.monthsLong');
  const bareMonths = usuallyBareMonths(field);
  const years = field.climateYearly.map((y) => y.year);
  const ndvi = Object.fromEntries(field.ndviMonthly.map((n) => [`${n.year}-${n.month}`, n.ndvi]));
  const chartData = field.climateYearly.map((y) => ({ ...y, rainIn: mmToIn(y.precipMm) }));

  return (
    <div className="screen">
      <PageHead title={t('story.title')} />

      <section className="headline">
        <span className="headline-kicker"><Sun size={16} aria-hidden="true" />{t('story.kicker')}</span>
        <p className="headline-text">{t('story.headline', { months: s.avgBareMonths })}</p>
        {bareMonths.length > 0 && (
          <p className="muted">{t('story.headlineDetail', { months: bareMonths.map((m) => monthsLong[m - 1]).join(', ') })}</p>
        )}
      </section>

      <div className="stats">
        <StatCard icon={CalendarX} label={t('story.statDrought')} value={s.droughtYears.length} detail={s.droughtYears.join(', ')} />
        <StatCard icon={CloudRain} label={t('story.statRain')} value={s.avgRainIn} unit={t('units.in')} detail={t('story.rainDetail', { mm: s.avgRainMm })} />
        <StatCard icon={Thermometer} label={t('story.statHeat')} value={s.avgHeatDays} detail={t('story.heatDetail')} />
        <StatCard icon={Sun} label={t('story.statBare')} value={s.avgBareDays} term="bareDays" detail={t('story.bareDetail')} />
      </div>

      <div className="split split-wide">
      <section className="card">
        <div className="field-group">
          <h2>{t('story.chartTitle')}</h2>
          <p className="chart-caption">{t('story.chartCaption', { years: joinYears(s.droughtYears, t) })}</p>
        </div>
        <div className="legend" aria-hidden="true">
          {Object.keys(YEAR_COLORS).map((k) => (
            <span key={k} className="legend-item"><span className="swatch" style={{ background: YEAR_COLORS[k] }} />{t(`yearType.${k}`)}</span>
          ))}
        </div>
        <div role="img" aria-label={t('story.chartAlt', { years: joinYears(s.droughtYears, t), avg: s.avgRainIn })}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e4e1d8" />
              <XAxis dataKey="year" tickFormatter={(y) => `'${String(y).slice(2)}`} tick={{ fontSize: 12 }} interval="preserveStartEnd" minTickGap={12} tickLine={false} axisLine={{ stroke: '#8f8b7e' }} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} unit={` ${t('units.in')}`} width={64} />
              <Tooltip
                cursor={{ fill: 'rgb(31 81 48 / 0.08)' }}
                formatter={(v, _n, item) => [`${v} ${t('units.in')} (${item.payload.precipMm} mm)`, t('story.tooltipRain')]}
                labelFormatter={(y) => {
                  const row = field.climateYearly.find((r) => r.year === y);
                  return `${y} · ${t(`yearType.${row?.yearType}`)}`;
                }}
              />
              <Bar dataKey="rainIn" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                {chartData.map((row) => <Cell key={row.year} fill={YEAR_COLORS[row.yearType]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Source datasets={['GPM IMERG', 'NASA POWER']} />
      </section>

      <section className="card">
        <div className="field-group">
          <h2 className="section-title">{t('story.bareTitle')} <GlossaryIcon term="ndvi" /></h2>
          <p className="chart-caption">{t('story.bareCaption')}</p>
        </div>
        <div className="legend">
          <span className="legend-item"><span className="swatch hatch" style={{ backgroundColor: 'var(--chart-bare)' }} />{t('story.legendBare')}</span>
          <span className="legend-item"><span className="swatch" style={{ background: 'var(--chart-covered)' }} />{t('story.legendCovered')}</span>
        </div>
        <div className="bare-grid" role="table" aria-label={t('story.bareTitle')}>
          <div className="bare-row" role="row">
            <span className="bare-year" role="columnheader"><span className="sr-only">{t('story.year')}</span></span>
            {monthsShort.map((m, i) => <span key={i} className="bare-head" role="columnheader" aria-label={monthsLong[i]}>{m}</span>)}
          </div>
          {years.map((y) => (
            <div key={y} className="bare-row" role="row">
              <span className="bare-year" role="rowheader">{y}</span>
              {monthsShort.map((_, i) => {
                const v = ndvi[`${y}-${i + 1}`];
                const bare = v < BARE_NDVI;
                return (
                  <span key={i} role="cell" className={`bare-cell ${bare ? 'bare' : ''}`}
                    title={`${monthsLong[i]} ${y}: ${bare ? t('story.legendBare') : t('story.legendCovered')}`}>
                    <span className="sr-only">{bare ? t('story.legendBare') : t('story.legendCovered')}</span>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
        <Source datasets={['Landsat 8/9 (HLS)']} />
      </section>
      </div>

      <button type="button" className="btn btn-primary btn-block btn-end" onClick={() => setScreen('compare')}>
        {t('story.next')}<ArrowRight size={20} aria-hidden="true" />
      </button>
      <JudgmentNote />
    </div>
  );
}
