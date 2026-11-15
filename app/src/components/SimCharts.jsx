// Charts and readouts for the farm simulator. One small line chart per category, a "today" strip, the scoreboard and the uncertainty band.
import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, ComposedChart, Area } from 'recharts';
import { useApp } from '../state/AppContext.jsx';
import { chartRows, dateAt, SERIES } from '../sim/simView.js';

export const PLAN_STYLE = [
  { color: 'var(--color-primary)', dash: undefined },
  { color: 'var(--color-water)', dash: '6 4' }, // plan B: second colour AND dashed, so colour is never the only cue
];

function useDateFmt() {
  const { lang } = useApp();
  return useMemo(() => new Intl.DateTimeFormat(lang, { month: 'short', year: '2-digit', timeZone: 'UTC' }), [lang]);
}

export function SimChart({ kind, plans, labels, cursor, money, unitText }) {
  const fmt = useDateFmt();
  const { rows } = useMemo(() => chartRows(plans, kind, cursor, money), [plans, kind, cursor, money]);
  const tick = (d) => fmt.format(new Date(`${dateAt(plans[0], d)}T00:00:00Z`));
  const summary = plans.map((p, k) => `${labels[k]}: ${rows.filter((r) => r[`p${k}`] != null).at(-1)?.[`p${k}`] ?? '-'} ${unitText}`).join('. ');
  return (
    <div className="sim-chart" role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="d" type="number" domain={[0, 'dataMax']} tickFormatter={tick} tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} tickCount={4} minTickGap={36} stroke="var(--color-border-strong)" />
          <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} width={46} stroke="var(--color-border-strong)" domain={kind === 'money' ? ['auto', 'auto'] : [0, 'auto']} />
          {plans.map((p, k) => (
            <Line key={p.id} type="monotone" dataKey={`p${k}`} stroke={PLAN_STYLE[k].color} strokeDasharray={PLAN_STYLE[k].dash} strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls={false} />
          ))}
          <ReferenceLine x={cursor} stroke="var(--color-text-muted)" strokeDasharray="2 3" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Legend({ labels }) {
  return (
    <ul className="sim-legend" aria-hidden="true">
      {labels.map((l, k) => (
        <li key={l}><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke={PLAN_STYLE[k].color} strokeWidth="3" strokeDasharray={PLAN_STYLE[k].dash} /></svg>{l}</li>
      ))}
    </ul>
  );
}

// Typical result with a shaded band from the worst to the best 10 % of past seasons.
export function BandChart({ band, color, dash }) {
  const fmt = useDateFmt();
  const rows = useMemo(() => {
    const out = [], stride = Math.max(1, Math.floor(band.mid.length / 120));
    for (let i = 0; i < band.mid.length; i += stride) out.push({ d: i, base: Math.round(band.lo[i]), range: Math.round(band.hi[i] - band.lo[i]), mid: Math.round(band.mid[i]) });
    return out;
  }, [band]);
  const tick = (d) => fmt.format(new Date(Date.UTC(2027, 0, 1 + d)));
  return (
    <div className="sim-chart">
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="d" type="number" domain={[0, 'dataMax']} tickFormatter={tick} tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} tickCount={4} minTickGap={36} stroke="var(--color-border-strong)" />
          <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} width={46} stroke="var(--color-border-strong)" />
          <Area dataKey="base" stackId="b" stroke="none" fill="none" isAnimationActive={false} />
          <Area dataKey="range" stackId="b" stroke="none" fill={color} fillOpacity={0.22} isAnimationActive={false} />
          <Line dataKey="mid" stroke={color} strokeDasharray={dash} strokeWidth={2.5} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export const UNITS = Object.fromEntries(Object.entries(SERIES).map(([k, v]) => [k, v.unit]));
