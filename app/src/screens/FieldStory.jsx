// Screen 3: the field's history. One big number first (bare days a year), then the cover timeline (one stripe per
// month), a typical year, the crop each year, soil facts, bad-year replay and 40 years of rain.
import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Sun, CloudRain, Thermometer, CalendarX, ArrowRight, ArrowDown, ArrowUp, Minus, History, Gauge, TriangleAlert, Layers, CalendarDays, Wheat, Lightbulb } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { useScores } from '../state/useScores.js';
import { useWide } from '../state/useWide.js';
import { NeedField, JudgmentNote, PageHead, Source, ModelCard, Receipt, LowConfTag, MiniStat } from '../components/Small.jsx';
import GlossaryIcon from '../components/GlossaryIcon.jsx';
import { SoilGrid } from '../components/SoilFacts.jsx';
import {
  climateStats, usuallyBareMonths, mmToIn, typicalBareMonths, typicalGreenMonths, bareRows, bareRowFor,
  coverRows as allCoverRows, SENSOR_YEAR,
} from '../display.js';
import { stressDriverText, modelClassFor, cropForYear } from '../si.js';
// import VulnerabilityZonesMap from '../components/future/VulnerabilityZonesMap.jsx'; // FUTURE

// Chart colors follow theme.css meaning: drought = dark orange, heat = amber, wet = water blue.
export const YEAR_COLORS = { drought: 'var(--chart-drought)', heat: 'var(--chart-heat)', wet: 'var(--chart-wet)', normal: 'var(--chart-normal)' };
const COVER = ['green', 'residue', 'bare'];
const FIRST_FULL_YEAR = SENSOR_YEAR + 1; // 2014: first full Landsat 8 year, where the main timeline starts
const FIRST_CROP_YEAR = 2008;            // USDA crop maps start here

const joinYears = (ys, t) => (ys.length > 1 ? `${ys.slice(0, -1).join(', ')} ${t('common.and')} ${ys.at(-1)}` : `${ys[0] ?? ''}`);
// Landsat 8 started imaging in April 2013: Jan-Mar 2013 have no image (not "cloudy").
const cellState = (row, i, st) => st || (!row.lowConfidence && row.year === SENSOR_YEAR && i < 3 ? 'noImage' : 'none');

// One plain sentence under a chart.
function Takeaway({ children }) {
  return <p className="takeaway"><Lightbulb size={18} aria-hidden="true" /><span>{children}</span></p>;
}

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
      {cover && (
        <div className="cover-timeline">
          <StripeRows rows={[cover]} perRow={1} yearType={{}} />
        </div>
      )}
      <button type="button" className="btn btn-block" onClick={() => { setReplayYear(year); setScreen('compare'); }}>
        {t('replayUi.see', { year })}<ArrowRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function FieldStory() {
  const { t, field, setScreen } = useApp();
  const scores = useScores();
  const wide = useWide('(min-width: 768px)');
  const [replayYear, setReplayYear] = useState(null);
  const [older, setOlder] = useState(false);
  if (!field) return <div className="screen"><NeedField /></div>;

  const s = climateStats(field);
  const monthsLong = t('story.monthsLong');
  const bareMonths = usuallyBareMonths(field);
  const yearType = Object.fromEntries(field.climateYearly.map((y) => [y.year, y.yearType]));
  const chartData = field.climateYearly.map((y) => ({ ...y, rainIn: mmToIn(y.precipMm) }));
  const first = chartData[0]?.year;
  const last = chartData.at(-1)?.year;
  const presets = field.si?.replayPresets || field.climateYearly.filter((y) => y.yearType === 'drought').slice(-3)
    .map((y) => ({ year: y.year, yearType: y.yearType }));
  const climateSrc = ['NASA POWER', 'Greenline SI models'];

  // Header card: the field's measured bare days a year (Landsat 8/9), one mini bar per year.
  const yearly = bareRows(field);
  const worst = yearly.reduce((a, b) => (b.days > a.days ? b : a), yearly[0]);
  const least = yearly.reduce((a, b) => (b.days < a.days ? b : a), yearly[0]);
  const peak = Math.max(1, worst?.days ?? 1);
  const recent = yearly.slice(-10);
  const recentScore = Math.round(recent.reduce((a, b) => a + b.score, 0) / Math.max(1, recent.length));
  // Change chip: the top option's estimated bare days against the current rotation's (same method for both).
  const top = scores?.suggested[0];
  const cur = scores?.current;
  const change = top && cur && top.total > cur.total ? top.bareDays.bareDays - cur.bareDays.bareDays : null;
  const changeDir = change == null ? null : change < 0 ? 'fewer' : change > 0 ? 'more' : 'same';
  const ChangeIcon = { fewer: ArrowDown, more: ArrowUp, same: Minus }[changeDir];
  const topName = t('compare.option', { letter: t('compare.letters.0') });

  // Cover timeline: Landsat 8/9 rows from 2014 on; everything earlier sits behind the "older years" button.
  const cover = allCoverRows(field);
  const mainRows = cover.filter((r) => r.year >= FIRST_FULL_YEAR);
  const olderRows = cover.filter((r) => r.year < FIRST_FULL_YEAR);
  const shownMain = mainRows.length ? mainRows : cover; // files without a 2014+ record (the fake sample)
  const all = shownMain.flatMap((r) => r.months);
  const clear = all.filter(Boolean);
  const count = (st) => clear.filter((m) => m === st).length;
  const pct = (st) => (clear.length ? Math.round((100 * count(st)) / clear.length) : 0);
  const from = shownMain[0]?.year;
  const to = shownMain.at(-1)?.year;

  const typicalBare = typicalBareMonths(field);
  const typicalGreen = typicalGreenMonths(field);
  const usuallyBare = typicalBare.map((p, i) => (p >= 0.5 ? monthsLong[i] : null)).filter(Boolean);

  const cropYears = field.cropHistory.filter((h) => h.year >= FIRST_CROP_YEAR).map((h) => cropForYear(field, h.year)).filter(Boolean).reverse();

  return (
    <div className="screen screen-story">
      <PageHead title={t('story.title')} />

      <section className="card stat-hero" aria-labelledby="hero-title">
        <h2 id="hero-title" className="card-kicker"><Sun size={18} aria-hidden="true" />{t('story.heroTitle')} <GlossaryIcon term="bareDays" /></h2>
        <div className="hero-row">
          <div className="hero-num-row">
            <span className="hero-num">{s.avgBareDays}</span>
            {changeDir && (
              <span className={`chip-change is-${changeDir}`} role="img" aria-label={t(`story.chipAlt.${changeDir}`, { n: Math.abs(change), name: topName })}>
                <ChangeIcon size={14} strokeWidth={2.5} aria-hidden="true" />{Math.abs(change)}
              </span>
            )}
          </div>
          {yearly.length > 1 && (
            <div className="mini-bars" role="img" aria-label={t('story.heroBarsAlt', { from: yearly[0].year, to: yearly.at(-1).year, year: worst.year, days: worst.days })}>
              {yearly.map((b) => <span key={b.year} className={b === worst ? 'worst' : ''} style={{ height: `${Math.round((100 * b.days) / peak)}%` }} title={`${b.year}: ${b.days}`} />)}
            </div>
          )}
        </div>
        <span className="hero-unit"><Receipt src={['Landsat 8/9']}>{t('story.heroUnit', { from: yearly[0]?.year, to: yearly.at(-1)?.year })}</Receipt></span>
        <p className="hero-note"><TriangleAlert size={16} aria-hidden="true" /><span>{t('story.undercount')}</span></p>
        {changeDir && (
          <p className="muted small chip-note">
            <span className={`chip-change is-${changeDir}`} aria-hidden="true"><ChangeIcon size={14} strokeWidth={2.5} />{Math.abs(change)}</span>
            {t(`story.chipWhy.${changeDir}`, { n: Math.abs(change), name: topName })}
          </p>
        )}
        <Takeaway>
          {yearly.length > 1 && t('story.heroTakeaway', { year: worst.year, days: worst.days, year2: least.year, days2: least.days })}
          {bareMonths.length > 0 && <> {t('story.headlineDetail', { months: bareMonths.map((m) => monthsLong[m - 1]).join(', ') })}</>}
        </Takeaway>
        <div className="mini-stats">
          <MiniStat icon={CalendarX} label={t('story.statDrought')} value={s.droughtYears.length} src={climateSrc} detail={t('story.droughtDetail', { from: first, to: last })} />
          <MiniStat icon={CloudRain} label={t('story.statRain')} value={s.avgRainIn} unit={t('units.in')} src={['NASA POWER']} detail={t('story.rainDetail', { mm: s.avgRainMm })} />
          <MiniStat icon={Thermometer} label={t('story.statHeat')} value={s.avgHeatDays} src={['NASA POWER']} detail={t('story.heatDetail')} />
          <MiniStat icon={Gauge} label={t('story.statScore')} value={recentScore} unit="/100" term="bareScore" src={['Landsat 8/9']} detail={t('story.scoreDetail')} />
        </div>
      </section>

      <section className="card" aria-labelledby="tl-title">
        <div className="card-head">
          <h2 id="tl-title" className="card-kicker"><Layers size={18} aria-hidden="true" />{t('story.tlTitle')} <GlossaryIcon term="ndvi" /></h2>
          <span className="card-meta">{from}–{to}</span>
        </div>
        <div className="cover-timeline" role="img" aria-label={t('story.tlAlt', { from, to, green: pct('green'), partly: pct('residue'), bare: pct('bare') })}>
          <StripeRows rows={shownMain} perRow={wide ? 12 : 4} yearType={yearType} />
        </div>
        <div className="tl-totals">
          {COVER.map((c) => (
            <div key={c} className="tl-total">
              <span className={`tl-tick cover-${c}`} aria-hidden="true" />
              <span className="tl-total-label">{t(`story.cover.${c}`)}</span>
              <span className="tl-total-num"><strong>{t('story.tlMonths', { n: count(c) })}</strong> {pct(c)}%</span>
            </div>
          ))}
        </div>
        <Takeaway>
          {t('story.tlTakeaway', { bare: pct('bare'), green: pct('green'), since: from })}
          {all.length > clear.length && <> {t('story.tlCloudy', { cloudy: all.length - clear.length })}</>}
        </Takeaway>
        <p className="hint small">{t('story.partlyNote')}</p>
        {olderRows.length > 0 && (
          <>
            <button type="button" className="btn btn-block" aria-expanded={older} onClick={() => setOlder(!older)}>
              {older ? t('story.hideOlder') : t('story.showOlder')}
            </button>
            {older && (
              <div className="tl-older">
                <p className="gap-note"><TriangleAlert size={16} aria-hidden="true" /><span>{t('story.sensorNote')} <LowConfTag /></span></p>
                <div className="cover-timeline" role="img" aria-label={t('story.olderAlt', { from: olderRows[0].year, to: olderRows.at(-1).year })}>
                  <StripeRows rows={olderRows} perRow={wide ? 12 : 4} yearType={yearType} />
                </div>
                <div className="legend">
                  <span className="legend-item"><span className="swatch cover-none" />{t('story.cover.none')}</span>
                  <span className="legend-item"><span className="swatch cover-noImage" />{t('story.cover.noImage')}</span>
                </div>
              </div>
            )}
          </>
        )}
        <Source datasets={['Landsat 8/9', 'Landsat 5/7/8/9', 'Greenline SI models']} />
      </section>

      <section className="card" aria-labelledby="typ-title">
        <div className="card-head">
          <h2 id="typ-title" className="card-kicker"><CalendarDays size={18} aria-hidden="true" />{t('story.typicalTitle')}</h2>
          <span className="card-meta">{from}–{to}</span>
        </div>
        <MonthDots bare={typicalBare} green={typicalGreen} />
        <Takeaway>{usuallyBare.length ? t('story.typicalBare', { months: usuallyBare.join(', ') }) : t('story.typicalNone')}</Takeaway>
        <Source datasets={['Landsat 8/9']} />
      </section>

      <section className="card" aria-labelledby="crop-title">
        <div className="card-head">
          <h2 id="crop-title" className="card-kicker"><Wheat size={18} aria-hidden="true" />{t('story.cropTitle')}</h2>
          <span className="card-meta">{cropYears.at(-1)?.year}–{cropYears[0]?.year}</span>
        </div>
        <ul className="crop-pills">
          {cropYears.map((c) => (
            <li key={c.year} className={`pill pill-crop${c.notSure ? ' pill-unsure' : ''}`}>
              <strong>{c.year}</strong>
              {c.cropId ? t(`crops.${c.cropId}`) : t(`si.cls.${c.cls}`)}
              {c.notSure && <em>{t('story.cropNotSure', { pct: c.pct })}</em>}
              {!c.notSure && c.source === 'model' && <em>{t('story.cropModel')}</em>}
            </li>
          ))}
        </ul>
        <p className="hint small">{t('story.cropLegend')}</p>
        <p className="gap-note"><TriangleAlert size={16} aria-hidden="true" /><Receipt src={['USDA Cropland Data Layer']}>{t('gaps.cdlNoise')}</Receipt></p>
        <Source datasets={['USDA Cropland Data Layer', 'Greenline SI models']} />
      </section>

      <SoilGrid field={field} />

      <section className="card">
        <h2 className="card-kicker"><History size={18} aria-hidden="true" />{t('story.replayTitle')}</h2>
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

      <section className="card">
        <div className="card-head">
          <h2 className="card-kicker"><CloudRain size={18} aria-hidden="true" />{t('story.chartTitle', { from: first })}</h2>
        </div>
        <div className="legend" aria-hidden="true">
          {Object.keys(YEAR_COLORS).map((k) => (
            <span key={k} className="legend-item"><span className="swatch" style={{ background: YEAR_COLORS[k] }} />{t(`yearType.${k}`)}</span>
          ))}
        </div>
        <div role="img" aria-label={t('story.chartAlt', { from: first, to: last, years: joinYears(s.droughtYears, t), avg: s.avgRainIn })}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="year" tickFormatter={(y) => `'${String(y).slice(2)}`} tick={{ fontSize: 12 }} interval="preserveStartEnd" minTickGap={16} tickLine={false} axisLine={{ stroke: 'var(--color-border-strong)' }} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} unit={` ${t('units.in')}`} width={78} />
              <Tooltip
                cursor={{ fill: 'var(--color-surface-sunken)' }}
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text)' }}
                formatter={(v, _n, item) => [`${v} ${t('units.in')} (${item.payload.precipMm} mm)`, t('story.tooltipRain')]}
                labelFormatter={(y) => `${y} · ${t(`yearType.${yearType[y]}`)}`}
              />
              <Bar dataKey="rainIn" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {chartData.map((row) => <Cell key={row.year} fill={YEAR_COLORS[row.yearType] || YEAR_COLORS.normal} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Takeaway>{t('story.chartCaption', { years: joinYears(s.droughtYears.slice(-4), t) })}</Takeaway>
        <Source datasets={['NASA POWER', 'Greenline SI models']} />
      </section>

      <ModelCard />

      <JudgmentNote />

      <button type="button" className="btn btn-primary btn-block btn-cta" onClick={() => setScreen('compare')}>
        {t('story.next')}<ArrowRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
