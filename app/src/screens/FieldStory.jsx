// Field History, built like the Options page: daisyUI, square cards with a light border and soft shadow, Lenis smooth
// scroll, GSAP scroll reveals, React Bits text and number animations and a Vanta contour-line hero. The satellite replay
// stays as it was. The core is "Year by year": every year 1985-2025 as a rain bar; tap one to see that year's water,
// heat and frost, crop, ground cover and month-by-month record. Bare-day numbers follow the Landsat 8/9 rule
// (display.js): years before 2013 are shown with the low-confidence tag and are never averaged.
import { useMemo, useState } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, ComposedChart, Line } from 'recharts';
import { ArrowDown, ArrowRight, ArrowUp, CloudRain, Droplets, Thermometer, Snowflake, Sprout, Wheat, Layers } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useApp } from '../state/AppContext.jsx';
import { NeedField, Receipt, LowConfTag } from '../components/Small.jsx';
import { SoilGrid } from '../components/SoilFacts.jsx';
import { climateStats, mmToIn, typicalBareMonths, typicalGreenMonths, bareRowFor, coverRows as allCoverRows, SENSOR_YEAR } from '../display.js';
import { PlaceholderTag } from '../components/PlaceholderTag.jsx';
import SatelliteReplay from '../components/SatelliteReplay.jsx';
import VantaTopology from '../components/VantaTopology.jsx';
import SplitText from '../components/bits/SplitText.jsx';
import CountUp from '../components/bits/CountUp.jsx';
import AnimatedContent from '../components/bits/AnimatedContent.jsx';
import { useSmoothScroll, scrollToId } from '../state/useSmoothScroll.js';

// Year-type colors as CSS variables (theme.css), used by other screens (ReplayBar).
export const YEAR_COLORS = { drought: 'var(--chart-drought)', heat: 'var(--chart-heat)', wet: 'var(--chart-wet)', normal: 'var(--chart-normal)' };
// The same meanings on the cream daisyUI page: drought = rust, heat = amber, wet = blue, normal = sage.
const TYPE_HEX = { drought: '#b0452b', heat: '#c48a1c', wet: '#2f6f9f', normal: '#a9c79a' };
const COVER_CLASS = { green: 'bg-success', residue: 'bg-accent', bare: 'bg-[#8a5a35] bg-[repeating-linear-gradient(45deg,transparent_0_3px,rgb(255_255_255/0.28)_3px_5px)]', none: 'bg-base-300', noImage: 'bg-base-300' };
const FIRST_CROP_YEAR = 2008;
const cToF = (c) => Math.round(c * 9 / 5 + 32);
const signedPct = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

// A card heading with an icon: one size everywhere.
function CardHead({ icon: Icon, children, extra }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <span className="grid h-10 w-10 place-items-center bg-primary/10 text-primary"><Icon size={20} aria-hidden="true" /></span>
      <h3 className="m-0 text-xl font-semibold tracking-tight sm:text-2xl">{children}</h3>
      {extra}
    </div>
  );
}

// One number with its label and a small line under it.
function Figure({ label, value, unit, sub, tone = '' }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium uppercase tracking-wider text-base-content/60">{label}</span>
      <span className={`text-4xl font-bold tabular-nums tracking-tight ${tone}`}>{value}{unit && <span className="ml-1.5 text-lg font-medium text-base-content/60">{unit}</span>}</span>
      {sub && <span className="text-base leading-snug text-base-content/75">{sub}</span>}
    </div>
  );
}

function TypeBadge({ type }) {
  const { t, field } = useApp();
  if (!type) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="badge badge-lg gap-2 border-base-300 bg-base-100">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_HEX[type] }} aria-hidden="true" />{t(`yearType.${type}`)}
      </span>
      {field.yearTypesPlaceholder && <PlaceholderTag />}
    </span>
  );
}

// Everything recorded for one year, as a row of cards.
function YearDetail({ year }) {
  const { t, lang, field, setScreen, setReplayYear } = useApp();
  const months = t('story.monthsShort');
  const monthsLong = t('story.monthsLong');
  const s = climateStats(field);
  const c = field.climateYearly.find((y) => y.year === year);
  const crop = field.cropHistory.find((h) => h.year === year);
  const bare = bareRowFor(field, year);
  const cover = allCoverRows(field).find((y) => y.year === year);
  const monthly = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const r = field.climateMonthly?.find((m) => m.year === year && m.month === i + 1);
    const n = field.ndviMonthly?.find((m) => m.year === year && m.month === i + 1);
    return { m: months[i], long: monthsLong[i], rainIn: r ? +(r.precipMm / 25.4).toFixed(2) : null, ndvi: n ? +n.ndvi.toFixed(2) : null, hi: r ? cToF(r.tMaxC) : null };
  }), [field, year, months, monthsLong]);
  if (!c) return null;
  const rainPct = Math.round(((c.precipMm - s.avgRainMm) / s.avgRainMm) * 100);
  const hasMonthlyRain = monthly.some((m) => m.rainIn != null);
  const cropName = crop ? (crop.crop === 'other' ? t(`si.cls.${crop.cdlClass || 'other'}`) : t(`crops.${crop.crop}`)) : null;
  const fmtDate = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(lang, { month: 'long', day: 'numeric' }) : null);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* The year at a glance */}
      <section className="gl-card flex flex-col gap-5 lg:col-span-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-6xl font-bold leading-none tracking-tighter sm:text-7xl">{year}</span>
          <TypeBadge type={c.yearType} />
          {bare?.lowConfidence && <LowConfTag />}
        </div>
        <div className="flex flex-col gap-1 lg:items-end">
          <span className="text-sm font-medium uppercase tracking-wider text-base-content/60">{t('story.cropLabel')}</span>
          {cropName
            ? <span className="flex items-center gap-2 text-2xl font-semibold"><Wheat size={22} className="text-primary" aria-hidden="true" /><Receipt src={['USDA Cropland Data Layer']}>{cropName}</Receipt></span>
            : <span className="text-base text-base-content/70">{t('story.cropNone')}</span>}
        </div>
      </section>

      {/* Water */}
      <section className="gl-card">
        <CardHead icon={Droplets}>{t('story.water')}</CardHead>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Figure label={t('story.rainLabel')} value={mmToIn(c.precipMm)} unit={t('units.in')}
            tone={rainPct <= -20 ? 'text-error' : rainPct >= 20 ? 'text-info' : ''}
            sub={<Receipt src={['NASA POWER']}>{t('story.rainVsNormal', { pct: signedPct(rainPct), avg: s.avgRainIn })}</Receipt>} />
          {c.heavyStormDays != null && (
            <Figure label={t('story.stormDays')} value={c.heavyStormDays} sub={<Receipt src={['GPM IMERG']}>{t('story.stormDetail')}</Receipt>} />
          )}
          <div className="sm:col-span-2">
            {c.soilMoistureAnomaly != null ? (
              <Figure label={t('story.soilMoisture')} value={`${signedPct(Math.round(c.soilMoistureAnomaly * 100))}%`}
                tone={c.soilMoistureAnomaly < -0.05 ? 'text-error' : c.soilMoistureAnomaly > 0.05 ? 'text-info' : ''}
                sub={<Receipt src={['SMAP L4']}>{t('story.soilDetail')}</Receipt>} />
            ) : <p className="m-0 text-base text-base-content/70">{t('story.soilNoData')}</p>}
          </div>
          {(c.precipMmImerg != null || c.precipMmPrism != null) && (
            <div className="border-t border-base-300 pt-4 sm:col-span-2">
              <p className="m-0 mb-2 text-sm font-medium uppercase tracking-wider text-base-content/60">{t('story.rainOther')}</p>
              <p className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-base">
                {c.precipMmImerg != null && <span>{t('story.rainImerg', { in: mmToIn(c.precipMmImerg) })}</span>}
                {c.precipMmPrism != null && <span>{t('story.rainPrism', { in: mmToIn(c.precipMmPrism) })}</span>}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Heat and frost */}
      <section className="gl-card">
        <CardHead icon={Thermometer}>{t('story.heatFrost')}</CardHead>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Figure label={t('story.statHeat')} value={c.heatStressDays} tone={c.heatStressDays > s.avgHeatDays * 1.25 ? 'text-warning' : ''}
            sub={<Receipt src={['NASA POWER']}>{t('story.heatAvg', { avg: s.avgHeatDays })}</Receipt>} />
          <Figure label={t('story.frostFree')} value={c.frostFreeDaysPrism ?? c.frostFreeDays ?? '–'}
            sub={<Receipt src={[c.frostFreeDaysPrism != null ? 'PRISM' : 'NASA POWER']}>{c.frostFreeDaysPrism != null ? 'PRISM' : 'NASA POWER'}</Receipt>} />
          <div className="flex flex-col gap-3 border-t border-base-300 pt-4 sm:col-span-2">
            {c.lastSpringFrostPrism || c.firstFallFrostPrism ? (
              <>
                <p className="m-0 flex items-center gap-2 text-base"><Snowflake size={18} className="text-info" aria-hidden="true" /><strong className="font-semibold">{t('story.lastFrost')}:</strong> {fmtDate(c.lastSpringFrostPrism) ?? '–'}</p>
                <p className="m-0 flex items-center gap-2 text-base"><Snowflake size={18} className="text-info" aria-hidden="true" /><strong className="font-semibold">{t('story.firstFrost')}:</strong> {fmtDate(c.firstFallFrostPrism) ?? '–'}</p>
              </>
            ) : <p className="m-0 text-base text-base-content/70">{t('story.noFrostDates')}</p>}
          </div>
        </div>
      </section>

      {/* Ground cover */}
      <section className="gl-card">
        <CardHead icon={Layers} extra={bare?.lowConfidence ? <LowConfTag /> : null}>{t('story.explorecover')}</CardHead>
        {bare ? (
          <div className="grid grid-cols-3 gap-4">
            <Figure label={t('story.statBare')} value={bare.days} tone={bare.days > 60 ? 'text-error' : ''} />
            {bare.greenDays != null && <Figure label={t('story.greenDays')} value={bare.greenDays} tone="text-success" />}
            {bare.score != null && <Figure label={t('story.statScore')} value={bare.score} unit="/100" />}
          </div>
        ) : <p className="m-0 text-base text-base-content/70">{year > SENSOR_YEAR ? t('story.noBareNumber') : t('story.sensorNote')}</p>}
        {cover && (
          <div className="mt-6">
            <p className="m-0 mb-2 text-sm font-medium uppercase tracking-wider text-base-content/60">{t('story.coverMonths')}</p>
            <ol className="m-0 grid list-none grid-cols-12 gap-1 p-0">
              {cover.months.map((st, i) => {
                const state = st || (year === SENSOR_YEAR && i < 3 ? 'noImage' : 'none');
                return (
                  <li key={i} className="flex flex-col items-center gap-1" title={`${monthsLong[i]}: ${t(`story.cover.${state}`)}`}>
                    <span className={`block h-10 w-full ${COVER_CLASS[state]} ${cover.lowConfidence ? 'opacity-60' : ''}`} />
                    <span className="text-xs text-base-content/60" aria-hidden="true">{months[i]}</span>
                    <span className="sr-only">{monthsLong[i]}: {t(`story.cover.${state}`)}</span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-base-content/75">
              {['green', 'residue', 'bare', 'none'].map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5"><span className={`inline-block h-3 w-3 ${COVER_CLASS[k]}`} aria-hidden="true" />{t(`story.cover.${k}`)}</span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Month by month */}
      <section className="gl-card">
        <CardHead icon={CloudRain}>{t('story.monthByMonth')}</CardHead>
        <div role="img" aria-label={t('story.monthAlt', { year })} className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthly} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <XAxis dataKey="m" tick={{ fontSize: 12, fill: '#55605a' }} tickLine={false} axisLine={{ stroke: '#ddd6c3' }} />
              {hasMonthlyRain && <YAxis yAxisId="rain" tick={{ fontSize: 12, fill: '#55605a' }} tickLine={false} axisLine={false} width={44} />}
              <YAxis yAxisId="ndvi" orientation="right" domain={[0, 1]} hide={hasMonthlyRain} tick={{ fontSize: 12, fill: '#55605a' }} tickLine={false} axisLine={false} width={36} />
              <Tooltip contentStyle={{ background: '#fbf9f4', border: '1px solid #ddd6c3', borderRadius: 0, fontSize: 13 }}
                labelFormatter={(_, p) => p?.[0]?.payload?.long ?? ''}
                formatter={(v, k) => [v, k === 'rainIn' ? t('story.monthRain') : t('story.monthGreen')]} />
              {hasMonthlyRain && <Bar yAxisId="rain" dataKey="rainIn" fill="#a9c79a" isAnimationActive />}
              <Line yAxisId="ndvi" dataKey="ndvi" stroke="#1f5f40" strokeWidth={2.5} dot={{ r: 3, fill: '#1f5f40' }} connectNulls isAnimationActive />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-base-content/75">
          {hasMonthlyRain && <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 bg-secondary" aria-hidden="true" />{t('story.monthRain')}</span>}
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-primary" aria-hidden="true" />{t('story.monthGreen')}</span>
        </div>
        {!hasMonthlyRain && <p className="m-0 mt-2 text-sm text-base-content/65">{t('story.monthNoRain')}</p>}
      </section>

      <div className="lg:col-span-2">
        <button type="button" className="btn btn-primary btn-lg rounded-none px-7" onClick={() => { setReplayYear(year); setScreen('compare'); }}>
          {t('replayUi.see', { year })}<ArrowRight size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default function FieldStory() {
  const { t, field, setScreen } = useApp();
  const reduce = useReducedMotion();
  useSmoothScroll();
  const years = field?.climateYearly ?? [];
  const [picked, setYear] = useState(null);
  if (!field) return <div className="screen"><NeedField /></div>;
  // The field can load after the first render, so the default year is worked out here, not in useState.
  const year = years.some((r) => r.year === picked) ? picked : years.at(-1)?.year;
  const stats = climateStats(field);
  const rain = years.map((r) => ({ year: r.year, rainIn: mmToIn(r.precipMm), type: r.yearType }));
  const pick = (y) => { setYear(y); };

  return (
    <div className="options-page bg-base-100 text-base-content" key={field.field.id}>
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <VantaTopology className="absolute inset-0 -z-10 opacity-50" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-base-100/20 via-base-100/60 to-base-100" aria-hidden="true" />
        <div className="grid w-full grid-cols-1 items-end gap-x-12 gap-y-6 px-5 pb-10 pt-8 sm:px-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:px-12 lg:pt-10">
          {field.isSampleData && <div className="lg:col-span-2"><p className="alert alert-warning m-0 rounded-none text-sm">{t('app.sampleNotice')}</p></div>}
          <div className="flex flex-col gap-5">
            <span className="badge badge-lg badge-outline w-fit bg-base-100/70">{t('pick.fieldName', { id: field.field.id })}</span>
            <SplitText text={t('story.title')} tag="h1" textAlign="left" splitType="chars" delay={30} duration={1}
              className="m-0 text-5xl font-bold leading-[0.95] tracking-tighter sm:text-7xl" />
            <p className="max-w-2xl text-lg leading-relaxed text-base-content/85 sm:text-xl">{t('story.heroIntro')}</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn btn-primary btn-lg rounded-full px-8" onClick={() => scrollToId('years')}>
                {t('story.heroYears')}<ArrowDown size={20} aria-hidden="true" />
              </button>
              <button type="button" className="btn btn-ghost btn-lg rounded-full px-6" onClick={() => scrollToId('replay')}>{t('story.heroReplay')}</button>
            </div>
          </div>
          <div className="stats stats-horizontal gl-card rounded-none w-full auto-cols-[minmax(0,1fr)] overflow-visible !p-0 [&_.stat-title]:whitespace-normal [&_.stat-title]:text-sm sm:[&_.stat-title]:text-base [&_.stat]:px-3 sm:[&_.stat]:px-5 [&_.stat-desc]:whitespace-normal [&_.stat-value]:text-3xl sm:[&_.stat-value]:text-4xl">
            <div className="stat">
              <div className="stat-title">{t('story.statRain')}</div>
              <div className="stat-value text-primary"><CountUp to={Number(stats.avgRainIn)} decimals={String(stats.avgRainIn).includes('.') ? 1 : 0} duration={1.4} /></div>
              <div className="stat-desc text-sm">{t('units.in')} · NASA POWER</div>
            </div>
            <div className="stat">
              <div className="stat-title">{t('story.statBare')}</div>
              <div className="stat-value"><CountUp to={stats.avgBareDays} duration={1.4} /></div>
              <div className="stat-desc text-sm">{t('story.bareDetail')}</div>
            </div>
            <div className="stat">
              <div className="stat-title">{t('story.statHeat')}</div>
              <div className="stat-value"><CountUp to={stats.avgHeatDays} duration={1.4} /></div>
              <div className="stat-desc text-sm">{t('story.heatDetail')}</div>
            </div>
            <div className="stat">
              <div className="stat-title">{t('story.statDrought')}</div>
              <div className="stat-value text-error"><CountUp to={stats.droughtYears.length} duration={1.2} /></div>
              <div className="stat-desc text-sm">{t('story.droughtDetail', { from: years[0]?.year, to: years.at(-1)?.year })}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Satellite replay, unchanged */}
      <section id="replay" className="w-full px-5 py-8 sm:px-8 lg:px-12">
        <SatelliteReplay key={field.field.id} field={field} />
      </section>

      {/* Year by year */}
      <section id="years" className="w-full px-5 py-10 sm:px-8 lg:px-12">
        <AnimatedContent distance={40} duration={0.9}>
          <h2 className="m-0 text-3xl font-bold tracking-tight sm:text-4xl">{t('story.yearsTitle')}</h2>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-base-content/75">{t('story.yearsIntro')}</p>
        </AnimatedContent>

        <div className="gl-card mt-6">
          <div role="img" aria-label={t('story.chartAlt', { from: rain[0]?.year, to: rain.at(-1)?.year, years: stats.droughtYears.slice(-5).join(', '), avg: stats.avgRainIn })} className="h-56 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rain} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} onClick={(e) => e?.activeLabel && pick(Number(e.activeLabel))}>
                <XAxis dataKey="year" tick={{ fontSize: 12, fill: '#55605a' }} tickLine={false} axisLine={{ stroke: '#ddd6c3' }} minTickGap={18} />
                <YAxis tick={{ fontSize: 12, fill: '#55605a' }} tickLine={false} axisLine={false} width={40} />
                <ReferenceLine y={Number(stats.avgRainIn)} stroke="#1a2420" strokeDasharray="4 4" strokeOpacity={0.5}
                  label={{ value: t('story.yearAvgLine'), position: 'insideTopRight', fontSize: 12, fill: '#55605a' }} />
                <Tooltip cursor={{ fill: 'rgb(31 95 64 / 0.08)' }} contentStyle={{ background: '#fbf9f4', border: '1px solid #ddd6c3', borderRadius: 0, fontSize: 13 }}
                  formatter={(v, _k, p) => [`${v} ${t('units.in')} · ${t(`yearType.${p.payload.type}`)}`, t('story.tooltipRain')]} />
                <Bar dataKey="rainIn" isAnimationActive={!reduce} radius={0} cursor="pointer">
                  {rain.map((r) => (
                    <Cell key={r.year} fill={TYPE_HEX[r.type] || TYPE_HEX.normal} fillOpacity={r.year === year ? 1 : 0.55}
                      stroke={r.year === year ? '#1a2420' : 'none'} strokeWidth={r.year === year ? 1.5 : 0} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-base-content/75">
            {['drought', 'heat', 'normal', 'wet'].map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3" style={{ background: TYPE_HEX[k] }} aria-hidden="true" />{t(`yearType.${k}`)}</span>
            ))}
            {field.yearTypesPlaceholder && <PlaceholderTag />}
          </div>
          <div role="radiogroup" aria-label={t('story.yearPick')} className="mt-5 flex snap-x gap-1.5 overflow-x-auto pb-2">
            {years.slice().reverse().map((r) => (
              <button key={r.year} type="button" role="radio" aria-checked={r.year === year} onClick={() => pick(r.year)}
                className={`btn btn-sm h-10 min-w-16 snap-start rounded-none px-3 text-sm font-semibold ${r.year === year ? 'btn-primary' : 'btn-ghost border border-base-300'}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: TYPE_HEX[r.yearType] }} aria-hidden="true" />{r.year}
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={year} className="mt-5"
            initial={reduce ? false : { opacity: 0, y: 18, filter: 'blur(5px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, filter: 'blur(4px)' }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
            <YearDetail year={year} />
          </motion.div>
        </AnimatePresence>
      </section>

      {/* Typical year and soil */}
      <section className="grid w-full grid-cols-1 gap-5 px-5 pb-14 pt-4 sm:px-8 lg:grid-cols-2 lg:px-12">
        <AnimatedContent distance={40} duration={0.9} className="gl-card">
          <CardHead icon={Sprout}>{t('story.typicalTitle')}</CardHead>
          <TypicalYear bare={typicalBareMonths(field)} green={typicalGreenMonths(field)} />
        </AnimatedContent>
        <AnimatedContent distance={40} duration={0.9} delay={0.1} className="gl-card [&_.card]:border-0 [&_.card]:p-0">
          <SoilGrid field={field} />
        </AnimatedContent>
        <div className="lg:col-span-2">
          <button type="button" className="btn btn-lg rounded-none border-base-content/40 px-7" onClick={() => setScreen('sim')}>
            {t('story.toSimulator')}<ArrowUp size={20} className="rotate-45" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}

// A typical year: for each month, how often it was bare and how often green (dots sized by how often).
function TypicalYear({ bare, green }) {
  const { t } = useApp();
  const letters = t('story.monthsShort');
  const long = t('story.monthsLong');
  const size = (p) => (p >= 0.5 ? 'h-7 w-3.5' : p >= 0.2 ? 'h-3.5 w-3.5' : 'h-2 w-2');
  const often = (ps) => ps.map((p, i) => (p >= 0.5 ? long[i] : null)).filter(Boolean).join(', ') || t('story.dotNone');
  const row = (key, ps, color) => (
    <div className="grid grid-cols-[4.5rem_repeat(12,minmax(0,1fr))] items-center gap-1" role="img" aria-label={t('story.dotRowAlt', { what: t(`story.dot.${key}`), months: often(ps) })}>
      <span className="text-sm font-medium">{t(`story.dot.${key}`)}</span>
      {ps.map((p, i) => <span key={i} className="grid h-8 place-items-center" title={`${long[i]}: ${t(`story.dotLegend.${p >= 0.5 ? 'l' : p >= 0.2 ? 'm' : 's'}`)}`}><span className={`block rounded-full ${size(p)} ${color}`} /></span>)}
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[4.5rem_repeat(12,minmax(0,1fr))] gap-1 text-center text-xs text-base-content/60" aria-hidden="true">
        <span />{letters.map((m, i) => <span key={i}>{m}</span>)}
      </div>
      {row('bare', bare, 'bg-[#8a5a35]')}
      {row('green', green, 'bg-success')}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-base-content/75">
        {['s', 'm', 'l'].map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5"><span className={`inline-block rounded-full bg-[#8a5a35] ${k === 'l' ? 'h-4 w-2' : k === 'm' ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5'}`} aria-hidden="true" />{t(`story.dotLegend.${k}`)}</span>
        ))}
      </div>
    </div>
  );
}
