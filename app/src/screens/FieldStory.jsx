// Screen 3: lead with the answer, then 40 years of rain, year types and ground cover, and bad-year replay.
import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import CoverStrip from '../components/CoverStrip.jsx';
import { Sun, CloudRain, Thermometer, CalendarX, ArrowRight, History, Gauge, TriangleAlert } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { StatCard, NeedField, JudgmentNote, PageHead, Source, ModelCard, Receipt } from '../components/Small.jsx';
import GlossaryIcon from '../components/GlossaryIcon.jsx';
import SoilAndFrost from '../components/SoilFacts.jsx';
import { climateStats, usuallyBareMonths, mmToIn, coverShares, typicalBareMonths, SENSOR_YEAR } from '../display.js';
import { stressDriverText, modelClassFor } from '../si.js';
// import VulnerabilityZonesMap from '../components/future/VulnerabilityZonesMap.jsx'; // FUTURE

// Chart colors follow theme.css meaning: drought = risk red, heat = amber, wet = water blue.
export const YEAR_COLORS = { drought: '#a3362a', heat: '#c98a1b', wet: '#2f75a8', normal: '#8e9c90' };
const COVER = ['green', 'residue', 'bare'];

const joinYears = (ys, t) => (ys.length > 1 ? `${ys.slice(0, -1).join(', ')} ${t('common.and')} ${ys.at(-1)}` : `${ys[0] ?? ''}`);

// What happened on this field in one past year (a "bad-year replay").
function Replay({ year }) {
  const { t, field, setScreen, setReplayYear } = useApp();
  const c = field.climateYearly.find((y) => y.year === year);
  const cover = field.coverYearly.find((y) => y.year === year);
  const bare = field.bareDaysPerYear.find((y) => y.year === year);
  const si = field.si?.years.find((y) => y.year === year);
  const crop = field.cropHistory.find((h) => h.year === year);
  const s = climateStats(field);
  const months = t('story.monthsLong');
  if (!c) return null;
  const rainDiff = Math.round(((c.precipMm - s.avgRainMm) / s.avgRainMm) * 100);
  const signalOk = si && (field.si.models.vegStress.showSignalFor || []).includes(si.cdlClass);
  return (
    <div className="replay">
      <h3>{t('story.replayHeading', { year, type: t(`yearType.${c.yearType}`) })}</h3>
      <ul className="replay-facts">
        <li><Receipt src={['NASA POWER']}>{t('story.replayRain', { inches: mmToIn(c.precipMm), pct: rainDiff > 0 ? `+${rainDiff}` : rainDiff })}</Receipt></li>
        <li><Receipt src={['NASA POWER']}>{t('story.replayHeat', { n: c.heatStressDays, avg: s.avgHeatDays })}</Receipt></li>
        {c.heavyStormDays != null && <li><Receipt src={['GPM IMERG']}>{t('story.replayStorms', { n: c.heavyStormDays })}</Receipt></li>}
        {c.soilMoistureAnomaly != null && (
          <li><Receipt src={['SMAP L4']}>{t('story.replaySoil', { pct: Math.round(c.soilMoistureAnomaly * 100) })}</Receipt></li>
        )}
        {crop && <li><Receipt src={['USDA Cropland Data Layer']}>{t('story.replayCrop', { crop: crop.crop === 'other' ? t(`si.cls.${crop.cdlClass || 'other'}`) : t(`crops.${crop.crop}`) })}</Receipt></li>}
        {bare && <li><Receipt src={['Landsat 5/7/8/9']}>{t('story.replayBare', { days: bare.days, score: bare.score })}</Receipt></li>}
        {si?.stressMonths && (
          <li>
            <Receipt src={['Landsat 5/7/8/9', 'Greenline SI models']}>
              {si.stressMonths.length
                ? t('story.replayStress', { months: si.stressMonths.map((m) => months[m - 1]).join(', ') })
                : t('story.replayNoStress')}
            </Receipt>
            {signalOk && si.stressDriver && <span className="si-why">{stressDriverText(t, si.stressDriver)} · {t('si.lowConfidence')}</span>}
            {!signalOk && si.cdlClass && modelClassFor(crop?.crop) && <span className="si-why">{t('si.riskNotForCrop')}</span>}
          </li>
        )}
      </ul>
      {cover && <CoverRow row={cover} label={String(year)} />}
      <button type="button" className="btn btn-block" onClick={() => { setReplayYear(year); setScreen('compare'); }}>
        {t('replayUi.see', { year })}<ArrowRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

function CoverRow({ row, label, extra }) {
  const { t } = useApp();
  const monthsLong = t('story.monthsLong');
  return (
    <div className="bare-row" role="row">
      <span className="bare-year" role="rowheader">{label}</span>
      {row.months.map((st, i) => (
        <span key={i} role="cell" className={`bare-cell cover-${st || 'none'}`}
          title={`${monthsLong[i]} ${row.year}: ${t(`story.cover.${st || 'none'}`)}`}>
          <span className="sr-only">{t(`story.cover.${st || 'none'}`)}</span>
        </span>
      ))}
      {extra}
    </div>
  );
}

export default function FieldStory() {
  const { t, field, setScreen } = useApp();
  const [replayYear, setReplayYear] = useState(null);
  const [allYears, setAllYears] = useState(false);
  if (!field) return <div className="screen"><NeedField /></div>;

  const s = climateStats(field);
  const monthsShort = t('story.monthsShort');
  const monthsLong = t('story.monthsLong');
  const bareMonths = usuallyBareMonths(field);
  const yearType = Object.fromEntries(field.climateYearly.map((y) => [y.year, y.yearType]));
  const bareBy = Object.fromEntries(field.bareDaysPerYear.map((b) => [b.year, b]));
  const cropBy = Object.fromEntries(field.cropHistory.map((h) => [h.year, h]));
  const siBy = Object.fromEntries((field.si?.years || []).map((y) => [y.year, y]));
  const chartData = field.climateYearly.map((y) => ({ ...y, rainIn: mmToIn(y.precipMm) }));
  const first = chartData[0]?.year;
  const last = chartData.at(-1)?.year;
  const presets = field.si?.replayPresets || field.climateYearly.filter((y) => y.yearType === 'drought').slice(-3)
    .map((y) => ({ year: y.year, yearType: y.yearType }));
  const recentScore = Math.round(field.bareDaysPerYear.slice(-10).reduce((a, b) => a + b.score, 0) / Math.max(1, Math.min(10, field.bareDaysPerYear.length)));
  const cropLabel = (h) => (h.crop === 'other' ? t(`si.cls.${h.cdlClass || 'other'}`) : t(`crops.${h.crop}`));
  const climateSrc = ['NASA POWER', 'Greenline SI models'];
  const shares = coverShares(field);
  const typical = typicalBareMonths(field);
  const modernShares = shares.filter((x) => x.year >= SENSOR_YEAR);
  const sinceShares = modernShares.length ? modernShares : shares;
  const avgBarePct = sinceShares.length ? Math.round(sinceShares.reduce((a, b) => a + b.bare, 0) / sinceShares.length) : 0;
  const typicalBare = typical.map((p, i) => (p >= 0.5 ? monthsLong[i] : null)).filter(Boolean);
  const coverRows = [...field.coverYearly].reverse();
  const shownRows = allYears ? coverRows : coverRows.slice(0, 10);

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
        <StatCard icon={CalendarX} label={t('story.statDrought')} value={s.droughtYears.length} src={climateSrc}
          detail={t('story.droughtDetail', { from: first, to: last })} />
        <StatCard icon={CloudRain} label={t('story.statRain')} value={s.avgRainIn} unit={t('units.in')} src={['NASA POWER']} detail={t('story.rainDetail', { mm: s.avgRainMm })} />
        <StatCard icon={Thermometer} label={t('story.statHeat')} value={s.avgHeatDays} src={['NASA POWER']} detail={t('story.heatDetail')} />
        <StatCard icon={Sun} label={t('story.statBare')} value={s.avgBareDays} term="bareDays" src={['Landsat 5/7/8/9']} detail={t('story.bareDetail')} />
        <StatCard icon={Gauge} label={t('story.statScore')} value={recentScore} unit="/100" term="bareScore" src={['Landsat 5/7/8/9', 'Greenline SI models']} detail={t('story.scoreDetail')} />
      </div>

      <SoilAndFrost field={field} />

      <ModelCard />

      <section className="card">
        <div className="field-group">
          <h2 className="section-title">{t('story.coverChartTitle')} <GlossaryIcon term="ndvi" /></h2>
          <p className="chart-caption">{t('story.coverChartCaption')}</p>
        </div>
        <div className="legend">
          <span className="legend-item"><span className="swatch cover-green" />{t('story.cover.green')}</span>
          <span className="legend-item"><span className="swatch cover-residue" />{t('story.cover.residue')}</span>
          <span className="legend-item"><span className="swatch cover-bare" />{t('story.cover.bare')}</span>
        </div>
        <div role="img" aria-label={t('story.coverChartAlt', { from: shares[0]?.year, to: shares.at(-1)?.year, bare: avgBarePct, since: sinceShares[0]?.year })}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={shares} margin={{ top: 16, right: 4, left: 0, bottom: 0 }} barCategoryGap={1}>
              <defs>
                <pattern id="bareHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="var(--chart-bare)" />
                  <rect width="2" height="6" fill="#ffffff" fillOpacity="0.35" />
                </pattern>
              </defs>
              <XAxis dataKey="year" tickFormatter={(y) => `'${String(y).slice(2)}`} tick={{ fontSize: 12 }} interval="preserveStartEnd" minTickGap={16} tickLine={false} axisLine={{ stroke: '#8f8b7e' }} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} unit="%" width={40} domain={[0, 100]} ticks={[0, 50, 100]} />
              <Tooltip
                cursor={{ fill: 'rgb(31 81 48 / 0.08)' }}
                formatter={(v, name) => [`${v}%`, t(`story.cover.${name === 'partly' ? 'residue' : name}`)]}
                labelFormatter={(y) => `${y}${yearType[y] ? ` · ${t(`yearType.${yearType[y]}`)}` : ''}`}
              />
              <ReferenceLine x={SENSOR_YEAR} stroke="#4b544d" strokeDasharray="3 3" label={{ value: t('story.sensorChange'), position: 'top', fontSize: 12, fill: '#4b544d' }} />
              <Bar dataKey="green" stackId="c" fill="var(--chart-green)" isAnimationActive={false} />
              <Bar dataKey="partly" stackId="c" fill="var(--chart-residue)" isAnimationActive={false} />
              <Bar dataKey="bare" stackId="c" fill="url(#bareHatch)" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="hint">{t('story.partlyNote')}</p>
        <p className="gap-note"><TriangleAlert size={16} aria-hidden="true" />{t('story.sensorNote')}</p>
        <Source datasets={['Landsat 5/7/8/9', 'Greenline SI models']} />
      </section>

      <section className="card">
        <div className="field-group">
          <h2>{t('story.typicalTitle')}</h2>
          <p className="chart-caption">{t('story.typicalCaption', { since: sinceShares[0]?.year ?? SENSOR_YEAR })}</p>
        </div>
        <CoverStrip months={typical} />
        <p className="muted">{typicalBare.length ? t('story.typicalBare', { months: typicalBare.join(', ') }) : t('story.typicalNone')}</p>
        <Source datasets={['Landsat 5/7/8/9']} />
      </section>

      <section className="card">
        <h2 className="section-title"><History size={20} aria-hidden="true" />{t('story.replayTitle')}</h2>
        <p className="chart-caption">{t('story.replayCaption')}</p>
        <div className="chips" role="group" aria-label={t('story.replayTitle')}>
          {presets.map((p) => (
            <button key={p.year} type="button" className="chip" aria-pressed={replayYear === p.year}
              onClick={() => setReplayYear(replayYear === p.year ? null : p.year)}>
              <span className="swatch" style={{ background: YEAR_COLORS[p.yearType] }} aria-hidden="true" />
              {p.year} · {t(`yearType.${p.yearType}`)}
            </button>
          ))}
        </div>
        {replayYear && <Replay year={replayYear} />}
      </section>

      <div className="split split-wide">
      <section className="card">
        <div className="field-group">
          <h2>{t('story.chartTitle', { from: first })}</h2>
          <p className="chart-caption">{t('story.chartCaption', { years: joinYears(s.droughtYears.slice(-4), t) })}</p>
        </div>
        <div className="legend" aria-hidden="true">
          {Object.keys(YEAR_COLORS).map((k) => (
            <span key={k} className="legend-item"><span className="swatch" style={{ background: YEAR_COLORS[k] }} />{t(`yearType.${k}`)}</span>
          ))}
        </div>
        <div role="img" aria-label={t('story.chartAlt', { from: first, to: last, years: joinYears(s.droughtYears, t), avg: s.avgRainIn })}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e4e1d8" />
              <XAxis dataKey="year" tickFormatter={(y) => `'${String(y).slice(2)}`} tick={{ fontSize: 12 }} interval="preserveStartEnd" minTickGap={16} tickLine={false} axisLine={{ stroke: '#8f8b7e' }} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} unit={` ${t('units.in')}`} width={64} />
              <Tooltip
                cursor={{ fill: 'rgb(31 81 48 / 0.08)' }}
                formatter={(v, _n, item) => [`${v} ${t('units.in')} (${item.payload.precipMm} mm)`, t('story.tooltipRain')]}
                labelFormatter={(y) => `${y} · ${t(`yearType.${yearType[y]}`)}`}
              />
              <Bar dataKey="rainIn" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                {chartData.map((row) => <Cell key={row.year} fill={YEAR_COLORS[row.yearType] || YEAR_COLORS.normal} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Source datasets={['NASA POWER', 'Greenline SI models']} />
      </section>

      <section className="card">
        <div className="field-group">
          <h2 className="section-title">{t('story.bareTitle')} <GlossaryIcon term="ndvi" /></h2>
          <p className="chart-caption">{t('story.bareCaption')}</p>
        </div>
        <div className="legend">
          {COVER.map((c) => <span key={c} className="legend-item"><span className={`swatch cover-${c}`} />{t(`story.cover.${c}`)}</span>)}
          <span className="legend-item"><span className="swatch cover-none" />{t('story.cover.none')}</span>
        </div>
        <div className="bare-grid timeline" role="table" aria-label={t('story.bareTitle')}>
          <div className="bare-row" role="row">
            <span className="bare-year" role="columnheader">{t('story.year')}</span>
            {monthsShort.map((m, i) => <span key={i} className="bare-head" role="columnheader" aria-label={monthsLong[i]}>{m}</span>)}
            <span className="bare-score bare-head" role="columnheader">{t('story.scoreCol')}</span>
            <span className="bare-crop bare-head" role="columnheader">{t('story.cropCol')}</span>
          </div>
          {shownRows.map((row) => {
            const ty = yearType[row.year];
            const h = cropBy[row.year];
            const si = siBy[row.year];
            return (
              <CoverRow key={row.year} row={row}
                label={<><span className="type-dot" style={{ background: YEAR_COLORS[ty] || 'transparent' }} title={ty ? t(`yearType.${ty}`) : ''} aria-label={ty ? t(`yearType.${ty}`) : undefined} />{row.year}</>}
                extra={(
                  <>
                    <span className="bare-score" role="cell">{bareBy[row.year]?.score ?? '–'}</span>
                    <span className="bare-crop" role="cell">
                      {h ? cropLabel(h) : ''}
                      {si?.doubleCropCdl && <span className="mini-badge" title={t('story.doubleCropNote')}>{t('story.doubleCrop')}</span>}
                    </span>
                  </>
                )} />
            );
          })}
        </div>
        {coverRows.length > 10 && (
          <button type="button" className="btn btn-block" aria-expanded={allYears} onClick={() => setAllYears(!allYears)}>
            {allYears ? t('story.showRecent') : t('story.showAll', { n: coverRows.length })}
          </button>
        )}
        <p className="hint">{t('story.timelineNote')}</p>
        <p className="gap-note"><TriangleAlert size={16} aria-hidden="true" /><Receipt src={['USDA Cropland Data Layer']}>{t('gaps.cdlNoise')}</Receipt></p>
        <Source datasets={['Landsat 5/7/8/9', 'USDA Cropland Data Layer']} />
      </section>
      </div>

      <button type="button" className="btn btn-primary btn-block btn-end" onClick={() => setScreen('compare')}>
        {t('story.next')}<ArrowRight size={20} aria-hidden="true" />
      </button>
      <JudgmentNote />
    </div>
  );
}
