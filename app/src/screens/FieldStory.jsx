// Field History: real satellite replay first, with crop, cover and weather details on demand.
import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { CloudRain, Thermometer, ArrowRight, TriangleAlert, Layers, Wheat } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { useWide } from '../state/useWide.js';
import { NeedField, PageHead, Source, Receipt, LowConfTag, MiniStat } from '../components/Small.jsx';
import { SoilGrid } from '../components/SoilFacts.jsx';
import {
  climateStats, mmToIn, typicalBareMonths, typicalGreenMonths, bareRowFor,
  coverRows as allCoverRows, SENSOR_YEAR,
} from '../display.js';
import { stressDriverText, modelClassFor } from '../si.js';
import { PlaceholderTag } from '../components/PlaceholderTag.jsx';
import SatelliteReplay from '../components/SatelliteReplay.jsx';
// import VulnerabilityZonesMap from '../components/future/VulnerabilityZonesMap.jsx'; // FUTURE

// Chart colors follow theme.css meaning: drought = dark orange, heat = amber, wet = water blue.
export const YEAR_COLORS = { drought: 'var(--chart-drought)', heat: 'var(--chart-heat)', wet: 'var(--chart-wet)', normal: 'var(--chart-normal)' };
const COVER = ['green', 'residue', 'bare'];
const FIRST_FULL_YEAR = SENSOR_YEAR + 1; // 2014: first full Landsat 8 year, where the main timeline starts
const FIRST_CROP_YEAR = 2008;            // USDA crop maps start here

const joinYears = (ys, t) => (ys.length > 1 ? `${ys.slice(0, -1).join(', ')} ${t('common.and')} ${ys.at(-1)}` : `${ys[0] ?? ''}`);
// Landsat 8 started imaging in April 2013: Jan-Mar 2013 have no image (not "cloudy").
const cellState = (row, i, st) => st || (!row.lowConfidence && row.year === SENSOR_YEAR && i < 3 ? 'noImage' : 'none');

// Small pill for a year's type (drought / hot / normal / wet): a dot plus the word, never color alone.
function YearTypePill({ type }) {
  const { t } = useApp();
  if (!type) return null;
  return <span className="pill pill-type"><span className="type-dot" style={{ background: YEAR_COLORS[type] }} aria-hidden="true" />{t(`yearType.${type}`)}</span>;
}

// Cover timeline: one thin stripe per month. `perRow` years share a row (4 on phones, 12 on wide screens).
// State = color plus shape: green / partly covered are full stripes, bare is a full hatched stripe, a month with no
// clear picture is a short stub. Low-confidence years (older satellites) are muted.
function StripeRows({ rows, perRow, yearType }) {
  const { t } = useApp();
  const monthsLong = t('story.monthsLong');
  const chunks = [];
  for (let i = 0; i < rows.length; i += perRow) chunks.push(rows.slice(i, i + perRow));
  return chunks.map((chunk) => (
    <div key={chunk[0].year} className="tl-block">
      <div className="tl-years" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
        {chunk.map((row) => (
          <span key={row.year} className={`tl-year${row.lowConfidence ? ' is-lowconf' : ''}`}>
            <strong>{row.year}</strong>
            <YearTypePill type={yearType[row.year]} />
          </span>
        ))}
      </div>
      <div className="tl-stripes" style={{ gridTemplateColumns: `repeat(${perRow * 12}, minmax(0, 1fr))` }}>
        {chunk.flatMap((row) => row.months.map((st, i) => {
          const c = cellState(row, i, st);
          return <span key={`${row.year}-${i}`} className={`tl-stripe cover-${c}${row.lowConfidence ? ' is-lowconf' : ''}`} title={`${monthsLong[i]} ${row.year}: ${t(`story.cover.${c}`)}`} />;
        }))}
      </div>
    </div>
  ));
}

// A typical year as a 12-dot grid: one column per month, one row for "bare" and one for "green".
// Size carries the meaning: small dot = rarely, big dot = some years, tall pill = most years.
const dotSize = (p) => (p >= 0.5 ? 'l' : p >= 0.2 ? 'm' : 's');
function MonthDots({ bare, green }) {
  const { t } = useApp();
  const letters = t('story.monthsShort');
  const long = t('story.monthsLong');
  const often = (ps) => ps.map((p, i) => (p >= 0.5 ? long[i] : null)).filter(Boolean).join(', ') || t('story.dotNone');
  const row = (key, ps) => (
    <div className="md-row" role="img" aria-label={t('story.dotRowAlt', { what: t(`story.dot.${key}`), months: often(ps) })}>
      <span className="md-label">{t(`story.dot.${key}`)}</span>
      {ps.map((p, i) => <span key={i} className="md-cell" title={`${long[i]}: ${t(`story.dotLegend.${dotSize(p)}`)}`}><span className={`md-dot md-${key} md-${dotSize(p)}`} /></span>)}
    </div>
  );
  return (
    <div className="month-dots">
      <div className="md-row md-head" aria-hidden="true">
        <span className="md-label" />
        {letters.map((m, i) => <span key={i} className="md-cell">{m}</span>)}
      </div>
      {row('bare', bare)}
      {row('green', green)}
      <div className="legend" aria-hidden="true">
        {['s', 'm', 'l'].map((s) => (
          <span key={s} className="legend-item"><span className="md-cell md-legend"><span className={`md-dot md-bare md-${s}`} /></span>{t(`story.dotLegend.${s}`)}</span>
        ))}
      </div>
    </div>
  );
}

// What happened on this field in one past year (a "bad-year replay").
function Replay({ year }) {
  const { t, field, setScreen, setReplayYear } = useApp();
  const c = field.climateYearly.find((y) => y.year === year);
  const cover = allCoverRows(field).find((y) => y.year === year);
  const bare = bareRowFor(field, year);
  const si = field.si?.years.find((y) => y.year === year);
  const crop = field.cropHistory.find((h) => h.year === year);
  const s = climateStats(field);
  const months = t('story.monthsLong');
  if (!c) return null;
  const rainDiff = Math.round(((c.precipMm - s.avgRainMm) / s.avgRainMm) * 100);
  const signalOk = si && (field.si.models.vegStress.showSignalFor || []).includes(si.cdlClass);
  return (
    <div className="replay">
      <h3>{t('story.replayHeading', { year, type: t(`yearTypeYear.${c.yearType}`) })}</h3>
      <ul className="replay-facts">
        <li><Receipt src={['NASA POWER']}>{t('story.replayRain', { inches: mmToIn(c.precipMm), pct: rainDiff > 0 ? `+${rainDiff}` : rainDiff })}</Receipt></li>
        <li><Receipt src={['NASA POWER']}>{t('story.replayHeat', { n: c.heatStressDays, avg: s.avgHeatDays })}</Receipt></li>
        {c.heavyStormDays != null && <li><Receipt src={['GPM IMERG']}>{t('story.replayStorms', { n: c.heavyStormDays })}</Receipt></li>}
        {c.soilMoistureAnomaly != null && (
          <li><Receipt src={['SMAP L4']}>{t('story.replaySoil', { pct: Math.round(c.soilMoistureAnomaly * 100) })}</Receipt></li>
        )}
        {crop && <li><Receipt src={['USDA Cropland Data Layer']}>{t('story.replayCrop', { crop: crop.crop === 'other' ? t(`si.cls.${crop.cdlClass || 'other'}`) : t(`crops.${crop.crop}`) })}</Receipt></li>}
        {bare ? (
          <li>
            <Receipt src={[bare.lowConfidence ? 'Landsat 5/7/8/9' : 'Landsat 8/9']}>{t('story.replayBare', { days: bare.days, score: bare.score })}</Receipt>
            {bare.lowConfidence && <> <LowConfTag /></>}
          </li>
        ) : year > SENSOR_YEAR && <li className="muted">{t('story.noBareNumber')}</li>}
        {si?.stressMonths && (
          <li>
            <Receipt src={['Landsat 5/7/8/9']}>
              {si.stressMonths.length
                ? t('story.replayStress', { months: si.stressMonths.map((m) => months[m - 1]).join(', ') })
                : t('story.replayNoStress')}
            </Receipt>
            {signalOk && si.stressDriver && <span className="si-why">{stressDriverText(t, si.stressDriver)} · {t('si.lowConfidence')}</span>}
            {!signalOk && si.cdlClass && modelClassFor(crop?.crop) && <span className="si-why">{t('si.riskNotForCrop')}</span>}
          </li>
        )}
      </ul>
      {cover && (
        <div className="cover-timeline">
          <StripeRows rows={[cover]} perRow={1} yearType={{}} />
        </div>
      )}
      <button type="button" className="btn btn-block" onClick={() => { setReplayYear(year); setScreen('plans'); }}>
        {t('replayUi.see', { year })}<ArrowRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function FieldStory() {
  const { t, field, setScreen } = useApp();
  const wide = useWide('(min-width: 768px)');
  const [detail, setDetail] = useState(null);
  const [older, setOlder] = useState(false);
  const [replayYear, setReplayYear] = useState(null);
  if (!field) return <div className="screen"><NeedField /></div>;
  const cover = allCoverRows(field);
  const main = cover.filter((r) => r.year >= FIRST_FULL_YEAR);
  const previous = cover.filter((r) => r.year < FIRST_FULL_YEAR);
  const yearType = Object.fromEntries(field.climateYearly.map((r) => [r.year, r.yearType]));
  const crops = field.cropHistory.filter((r) => r.year >= FIRST_CROP_YEAR).slice().reverse();
  const stats = climateStats(field);
  const rain = field.climateYearly.map((r) => ({ ...r, rainIn: mmToIn(r.precipMm) }));
  const first = rain[0]?.year;
  const last = rain.at(-1)?.year;
  const presets = field.climateYearly.filter((r) => r.yearType === 'drought').slice(-3);

  return (
    <div className="screen screen-story history-replay-page" key={field.field.id}>
      <PageHead title={t('story.title')} />
      <SatelliteReplay key={field.field.id} field={field} />
      <div className="history-explore" aria-label={t('story.explore')}>
        {['crops', 'cover', 'weather'].map((id) => (
          <button key={id} type="button" className="history-detail-toggle" aria-expanded={detail === id}
            aria-controls="history-details" onClick={() => setDetail(detail === id ? null : id)}>
            {id === 'crops' ? <Wheat size={20} aria-hidden="true" /> : id === 'cover' ? <Layers size={20} aria-hidden="true" /> : <CloudRain size={20} aria-hidden="true" />}
            {t(`story.explore${id}`)}<span aria-hidden="true">{detail === id ? '?' : '+'}</span>
          </button>
        ))}
      </div>
      <div id="history-details" className="history-details">
        {detail === 'crops' && <section className="card" aria-labelledby="crop-title">
          <h2 id="crop-title">{t('story.explorecrops')}</h2>
          <p className="muted small">{t('story.cropLegend')}</p>
          <ul className="crop-pills">{crops.map((c) => <li key={c.year} className="pill pill-crop">
            <strong>{c.year}</strong>{t(c.crop === 'other' ? `si.cls.${c.cdlClass || 'other'}` : `crops.${c.crop}`)}
          </li>)}</ul>
          <p className="gap-note"><TriangleAlert size={16} aria-hidden="true" />{t('gaps.cdlNoise')}</p>
          <Source datasets={['USDA Cropland Data Layer']} />
        </section>}
        {detail === 'cover' && <>
          <section className="card">
            <h2>{t('story.explorecover')}</h2>
            <p><strong className="history-bare-number">{stats.avgBareDays}</strong> {t('story.heroUnit', { from: main[0]?.year, to: main.at(-1)?.year })}</p>
            <p className="gap-note"><TriangleAlert size={16} aria-hidden="true" />{t('story.undercount')}</p>
            <div className="cover-timeline" role="img" aria-label={t('story.explorecover')}>
              <StripeRows rows={main} perRow={wide ? 6 : 3} yearType={{}} />
            </div>
            <div className="legend">{[...COVER, 'none'].map((c) => <span key={c} className="legend-item"><span className={`swatch cover-${c}`} />{t(`story.cover.${c}`)}</span>)}</div>
            <p className="hint small">{t('story.partlyNote')}</p>
            {previous.length > 0 && <button type="button" className="btn" aria-expanded={older} onClick={() => setOlder(!older)}>{t(older ? 'story.hideOlder' : 'story.showOlder')}</button>}
            {older && <><p className="gap-note">{t('story.sensorNote')} <LowConfTag /></p><StripeRows rows={previous} perRow={wide ? 6 : 3} yearType={{}} /></>}
            <Source datasets={['Landsat 8/9']} />
          </section>
          <section className="card"><h2>{t('story.typicalTitle')}</h2><MonthDots bare={typicalBareMonths(field)} green={typicalGreenMonths(field)} /></section>
        </>}
        {detail === 'weather' && <>
          <section className="card">
            <h2>{t('story.chartTitle', { from: first })}</h2>
            <div className="mini-stats">
              <MiniStat icon={CloudRain} label={t('story.statRain')} value={stats.avgRainIn} unit={t('units.in')} src={['NASA POWER']} />
              <MiniStat icon={Thermometer} label={t('story.statHeat')} value={stats.avgHeatDays} detail={t('story.heatDetail')} src={['NASA POWER']} />
            </div>
            <div role="img" aria-label={t('story.chartAlt', { from: first, to: last, years: joinYears(stats.droughtYears, t), avg: stats.avgRainIn })}>
              <ResponsiveContainer width="100%" height={220}><BarChart data={rain} margin={{ left: -20, right: 4 }}>
                <XAxis dataKey="year" tickFormatter={(y) => String(y)} minTickGap={24} tick={{ fontSize: 12 }} />
                <YAxis width={76} unit={` ${t('units.in')}`} tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ background: 'var(--color-surface)', border: 'var(--border)', color: 'var(--color-text)' }} formatter={(v) => [`${v} ${t('units.in')}`, t('story.tooltipRain')]} />
                <Bar dataKey="rainIn" fill="var(--chart-normal)" isAnimationActive={false} />
              </BarChart></ResponsiveContainer>
            </div>
            <Source datasets={['NASA POWER']} />
          </section>
          <section className="card">
            <h2>{t('story.replayTitle')}</h2><p className="small muted">{t('story.replayCaption')} {field.yearTypesPlaceholder && <PlaceholderTag />}</p>
            <div className="chips">{presets.map((r) => <button type="button" className="chip" key={r.year} aria-pressed={replayYear === r.year} onClick={() => setReplayYear(replayYear === r.year ? null : r.year)}>{r.year}</button>)}</div>
            {replayYear && <Replay year={replayYear} />}
          </section>
          <SoilGrid field={field} />
        </>}
      </div>
      <button type="button" className="btn btn-primary btn-block history-simulate" onClick={() => setScreen('sim')}>
        {t('story.satellite.simulate')}<ArrowRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
