// Screen 3 (v2): Field risks. Stress calendar with the next months' risk and reason, erosion hotspots,
// water and groundwater trend, frost and heat now vs 2040.
// Data: ONE loader (data/loadV2.js) -> data/v2Risks.js. One placeholder notice per screen, one tag per card.
// Colorblind-safe: risk levels are blue / yellow / dark orange AND bar height AND a stripe pattern on "high" AND a word.
import { useId, useMemo, useState } from 'react';
import { Lightbulb, Minus, TrendingDown, TrendingUp, CircleHelp, Droplets, ArrowRight } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { buildRisks } from '../data/v2Risks.js';
import { makeV2Text } from '../data/v2Text.js';
import { PageHead } from '../components/Small.jsx';
import { SampleBanner, PlaceholderNotice, PlaceholderCardTag, PlaceholderPanel } from '../components/PlaceholderTag.jsx';
import V2Gate from '../components/V2Gate.jsx';

const GW_ICON = { falling: TrendingDown, steady: Minus, rising: TrendingUp, unknown: CircleHelp, 'not-applicable': Droplets };

// Month names from the browser's own calendar, so Spanish needs no copy of ours.
function useMonths() {
  const { lang } = useApp();
  return useMemo(() => {
    const at = (m) => new Date(Date.UTC(2026, m - 1, 1));
    const long = new Intl.DateTimeFormat(lang, { month: 'long', timeZone: 'UTC' });
    const short = new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'UTC' });
    const narrow = new Intl.DateTimeFormat(lang, { month: 'narrow', timeZone: 'UTC' });
    return { long: (m) => long.format(at(m)), short: (m) => short.format(at(m)), narrow: (m) => narrow.format(at(m)) };
  }, [lang]);
}

// A card with its heading and (only when something on it is a placeholder) the one tag.
function RiskCard({ title, placeholders, children, className = '' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className={`card risk-card ${className}`}>
      <div className="opt-name">
        <h2>{title}</h2>
        {placeholders.length > 0 && <PlaceholderCardTag open={open} onToggle={() => setOpen(!open)} panelId={id} />}
      </div>
      {open && <PlaceholderPanel items={placeholders} id={id} />}
      {children}
    </section>
  );
}

function StressCalendar({ risks }) {
  const { t } = useApp();
  const months = useMonths();
  const first = risks.next[0] ? Number(risks.next[0].month.slice(5)) : null; // the month the outlook starts with
  const top = Math.max(0.4, ...risks.calendar.map((m) => m.risk)); // bar scale: at least 40%
  const peak = risks.peakMonths.map((m) => months.long(m)).join(', ');
  const summary = risks.calendar.map((m) => `${months.long(m.month)}: ${t(`risksScreen.level.${m.level}`)}, ${Math.round(m.risk * 100)}%`).join('. ');
  return (
    <>
      <p className="muted">{t('risksScreen.stress.intro')}</p>
      <div className="stress-chart" role="img" aria-label={summary}>
        {risks.calendar.map((m) => (
          <span key={m.month} className={`stress-col${m.month === first ? ' is-next' : ''}`} aria-hidden="true">
            <span className="stress-pct">{Math.round(m.risk * 100)}</span>
            <span className="stress-track"><span className={`stress-bar risk-${m.level}`} style={{ height: `${Math.max(4, (m.risk / top) * 100)}%` }} /></span>
            <span className="stress-m">{months.narrow(m.month)}</span>
          </span>
        ))}
      </div>
      <ul className="risk-legend" aria-hidden="true">
        {['low', 'medium', 'high'].map((l) => <li key={l}><span className={`legend-swatch risk-${l}`} />{t(`risksScreen.level.${l}`)}</li>)}
      </ul>
      <p className="takeaway"><Lightbulb size={18} aria-hidden="true" /><span>{peak ? t('risksScreen.stress.peak', { months: peak }) : t('risksScreen.stress.noPeak')}</span></p>
    </>
  );
}

function NextMonths({ risks, v2t }) {
  const { t } = useApp();
  const months = useMonths();
  return (
    <ul className="next-list">
      {risks.next.map((m, i) => {
        const pct = (x) => Math.round(x * 100);
        const range = t('risksScreen.next.range', { low: pct(m.low), high: pct(m.high) });
        return (
          <li key={m.month} className={`tile next-tile${i === 0 ? ' is-first' : ''}`}>
            <span className="tile-label">{months.long(Number(m.month.slice(5)))} {m.month.slice(0, 4)}</span>
            <span className="tile-value">{pct(m.chance)}% <span className="tile-unit">{t('risksScreen.next.chanceUnit')}</span></span>
            <span className="range-bar" role="img" aria-label={range}>
              <span className="range-span" style={{ left: `${pct(m.low)}%`, width: `${Math.max(2, pct(m.high) - pct(m.low))}%` }} />
              <span className="range-mark" style={{ left: `${pct(m.chance)}%` }} />
            </span>
            <span className="tile-note">{range}</span>
            {m.reasons.map((r, j) => <span key={j} className="next-reason">{v2t(r)}</span>)}
          </li>
        );
      })}
    </ul>
  );
}

function Erosion({ risks, v2t }) {
  const { t } = useApp();
  if (!risks.erosion.length) return <p className="muted">{t('risksScreen.erosion.none')}</p>;
  return (
    <ul className="hotspot-list">
      {risks.erosion.map((z, i) => {
        const zone = t(z.zoneKey);
        return (
          <li key={i} className="hotspot">
            <div className="hotspot-head">
              <strong>{zone === z.zoneKey ? t('risksScreen.erosion.zoneFallback') : zone}</strong>
              <span className="muted">{t('risksScreen.erosion.share', { pct: Math.round(z.areaShare * 100) })}</span>
            </div>
            <span className="hotspot-num">{z.tons.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="tile-unit">{t('risksScreen.erosion.unit')}</span></span>
            <span className="thin-bar" aria-hidden="true"><span style={{ width: `${Math.max(4, z.bar * 100)}%` }} /></span>
            {z.reasons.map((r, j) => <p key={j} className="opt-conf-reason">{v2t(r)}</p>)}
          </li>
        );
      })}
    </ul>
  );
}

function Water({ status }) {
  const { t } = useApp();
  const Icon = GW_ICON[status] || CircleHelp;
  return (
    <div className="gw">
      <span className="fit-chip gw-chip"><Icon size={16} aria-hidden="true" /><span>{t(`risksScreen.water.word.${status}`)}</span></span>
      <p>{t(`risksScreen.water.line.${status}`)}</p>
    </div>
  );
}

// Now vs 2040, with the change in words (an arrow and a word, never color alone).
function Climate({ risks }) {
  const { t, lang } = useApp();
  const num = useMemo(() => new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }), [lang]);
  return (
    <ul className="climate-list">
      {risks.climate.map((c) => {
        const share = c.unit === 'share';
        const show = (v) => (share ? `${num.format(v * 100)}%` : num.format(v));
        const delta = share ? Math.round((c.y2040 - c.today) * 100) : Math.round(c.y2040 - c.today);
        const dir = delta === 0 ? 'same' : delta > 0 ? 'up' : 'down';
        const change = dir === 'same' ? t('risksScreen.climate.same') : t(`risksScreen.climate.${dir}.${share ? 'points' : 'days'}`, { n: num.format(Math.abs(delta)) });
        return (
          <li key={c.id} className="climate-row">
            <span className="climate-name">{t(`risksScreen.climate.name.${c.id}`)}</span>
            <span className="climate-pair">
              <span className="climate-val"><span className="tile-unit">{t('risksScreen.climate.now')}</span><strong>{show(c.today)}</strong></span>
              <ArrowRight size={16} className="step-arrow" aria-hidden="true" />
              <span className="climate-val"><span className="tile-unit">{t('risksScreen.climate.y2040')}</span><strong>{show(c.y2040)}</strong></span>
            </span>
            <span className={`pill climate-change climate-${dir}`}>{dir === 'up' ? '▲ ' : dir === 'down' ? '▼ ' : ''}{change}</span>
            {c.id === 'rainVariability' && <span className="tile-note">{t('risksScreen.climate.rainHint')}</span>}
          </li>
        );
      })}
    </ul>
  );
}

// Props only: risks = buildRisks(data).
export function RisksView({ risks, sample = false }) {
  const { t, lang } = useApp();
  const v2t = useMemo(() => makeV2Text(t, lang), [t, lang]);
  const ph = risks.placeholders;
  const anyPlaceholder = Object.values(ph).some((l) => l.length > 0);
  return (
    <div className="screen screen-risks">
      {sample && <SampleBanner />}
      {anyPlaceholder && <PlaceholderNotice />}
      <PageHead title={t('risksScreen.title')} intro={t('risksScreen.intro')} />

      <RiskCard title={t('risksScreen.stress.title')} placeholders={ph.stress}>
        <StressCalendar risks={risks} />
      </RiskCard>

      {risks.next.length > 0 && (
        <RiskCard title={t('risksScreen.next.title')} placeholders={ph.stress}>
          <NextMonths risks={risks} v2t={v2t} />
        </RiskCard>
      )}

      <RiskCard title={t('risksScreen.erosion.title')} placeholders={ph.erosion}>
        <p className="muted">{t('risksScreen.erosion.intro')}</p>
        <Erosion risks={risks} v2t={v2t} />
      </RiskCard>

      <RiskCard title={t('risksScreen.water.title')} placeholders={[]}>
        <Water status={risks.groundwater} />
      </RiskCard>

      <RiskCard title={t('risksScreen.climate.title')} placeholders={ph.climate}>
        <Climate risks={risks} />
      </RiskCard>

      <p className="takeaway small"><Lightbulb size={18} aria-hidden="true" /><span>{t('risksScreen.takeaway')}</span></p>
    </div>
  );
}

function RisksBuilt({ data, sample }) {
  const risks = useMemo(() => buildRisks(data), [data]);
  return <RisksView risks={risks} sample={sample} />;
}

export default function Risks() {
  return (
    <V2Gate ns="risksScreen">
      {(v2) => <RisksBuilt data={v2.data} sample={v2.usingSample} />}
    </V2Gate>
  );
}
