// "Test in a bad year" on the Rotations page: what you grow now and the top rotations, run side by side through one real
// past year of this field's weather (each rotation year replays that year), with an optional what-if (more or less rain,
// warmer). Runs the same daily engine as the farm simulator (game/runSource.js testPlans, in workers, loaded on first use).
// Nothing is invented: a number the engine can't give is left out.
import { useMemo, useState } from 'react';
import { FlaskConical, LoaderCircle, TriangleAlert, ArrowUp, ArrowDown } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { planToSim } from '../game/playPlan.js';
import { loadModelFile } from '../data/loadModels.js';
import { mmToIn } from '../display.js';

const RAIN_STEPS = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50];
const HEAT_F = [0, 1, 2, 3, 4, 5]; // degrees F warmer (sent to the engine in C)

function worstYield(run) {
  const v = run.seasons.flatMap((s) => s.crops.map((c) => c.yieldVsTypical)).filter(Number.isFinite);
  if (!v.length) return null;
  const w = Math.min(...v);
  return Math.round(w <= 3 ? w * 100 : w);
}

export default function RotationTest({ rotations, labelFor }) {
  const { t, lang, field, tillage, replayYear } = useApp();
  const money = useMemo(() => new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }), [lang]);
  // Years with a full year of real monthly weather (2008 on); drought years first in the hint.
  const years = useMemo(() => {
    const full = [...new Set((field.climateMonthly ?? []).map((r) => r.year))].filter((y) => field.climateMonthly.filter((r) => r.year === y).length === 12);
    return full.sort((a, b) => b - a).map((y) => ({ year: y, type: field.climateYearly.find((c) => c.year === y)?.yearType ?? null, rainMm: field.climateYearly.find((c) => c.year === y)?.precipMm }));
  }, [field]);
  const firstDrought = years.find((y) => y.type === 'drought')?.year ?? years[0]?.year;
  // A year sent from the History page ("see how rotations hold up in {year}") wins, if it has full monthly weather.
  const [year, setYear] = useState(() => (years.some((y) => y.year === replayYear) ? replayYear : firstDrought));
  const [rain, setRain] = useState(0);
  const [heatF, setHeatF] = useState(0);
  const [state, setState] = useState({ status: 'idle', result: null, key: null });
  const hypo = rain !== 0 || heatF !== 0;
  const runKey = `${year}|${rain}|${heatF}|${rotations.map((r) => r.option.id).join(',')}`;

  async function run() {
    setState({ status: 'running', result: state.result, key: state.key });
    try {
      const [{ testPlans }, modelFile] = await Promise.all([import('../game/runSource.js'), loadModelFile(field.field.id)]);
      const plans = rotations.map((r) => { const s = planToSim(r.option); return { id: r.option.id, crops: s.crops, controls: s.controls, nScale: s.nitrogenScale }; });
      const scenario = hypo ? { rain: rain / 100, warmC: heatF / 1.8 } : null;
      const prevCrop = field.cropHistory?.at(-1)?.crop ?? null;
      const res = await testPlans({ field, modelFile, plans, year, scenario, prevCrop, start: { tillage: tillage ?? 'reduced' } });
      setState({ status: 'done', result: res, key: runKey });
    } catch {
      setState({ status: 'error', result: null, key: null });
    }
  }

  const res = state.status !== 'error' && state.key ? state.result : null;
  const stale = res && state.key !== runKey;
  const perYear = (r) => r.moneyTotal / Math.max(1, r.seasons.length);
  const base = res ? perYear(res.runs[0]) : null;

  return (
    <section className="gl-card" aria-labelledby="rot-test-title">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 place-items-center bg-primary/10 text-primary"><FlaskConical size={20} aria-hidden="true" /></span>
        <h3 id="rot-test-title" className="m-0 text-xl font-semibold tracking-tight sm:text-2xl">{t('rotations.testTitle')}</h3>
      </div>
      <p className="m-0 mb-5 max-w-3xl text-base leading-relaxed text-base-content/75">{t('rotations.testIntro')}</p>

      <div className="grid grid-cols-1 items-end gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium uppercase tracking-wider text-base-content/60">{t('rotations.testYear')}</span>
          <select className="select select-lg w-full rounded-none border-base-300 bg-base-100 text-base" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y.year} value={y.year}>{y.year}{y.type ? ` · ${t(`yearType.${y.type}`)}` : ''}{y.rainMm != null ? ` · ${mmToIn(y.rainMm)} ${t('units.in')}` : ''}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="flex justify-between text-sm font-medium uppercase tracking-wider text-base-content/60">{t('rotations.testRain')}<strong className="text-base-content">{rain > 0 ? '+' : ''}{rain}%</strong></span>
          <input type="range" className="range range-primary range-sm" min={0} max={RAIN_STEPS.length - 1} step={1} value={RAIN_STEPS.indexOf(rain)}
            onChange={(e) => setRain(RAIN_STEPS[Number(e.target.value)])} aria-valuetext={`${rain}%`} />
        </label>
        <label className="flex flex-col gap-2">
          <span className="flex justify-between text-sm font-medium uppercase tracking-wider text-base-content/60">{t('rotations.testHeat')}<strong className="text-base-content">+{heatF}°F</strong></span>
          <input type="range" className="range range-primary range-sm" min={0} max={HEAT_F.length - 1} step={1} value={HEAT_F.indexOf(heatF)}
            onChange={(e) => setHeatF(HEAT_F[Number(e.target.value)])} aria-valuetext={`+${heatF}°F`} />
        </label>
        <button type="button" className="btn btn-primary btn-lg rounded-none px-7" disabled={state.status === 'running'} onClick={run}>
          {state.status === 'running' ? <><LoaderCircle size={20} className="animate-spin" aria-hidden="true" />{t('rotations.testRunning')}</> : t('rotations.testRun')}
        </button>
      </div>

      <p className={`m-0 mt-4 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium ${hypo ? 'bg-warning/15 text-warning' : 'bg-base-200 text-base-content/75'}`} role="status">
        {hypo && <TriangleAlert size={16} aria-hidden="true" />}{hypo ? t('rotations.testHypo') : t('rotations.testReal', { year })}
      </p>

      {state.status === 'error' && <p className="m-0 mt-4 text-base text-error" role="alert">{t('rotations.testError')}</p>}
      {!res && state.status !== 'error' && <p className="m-0 mt-5 text-base text-base-content/70">{t('rotations.testEmpty')}</p>}
      {res && (
        <div className={`mt-6 transition-opacity ${stale || state.status === 'running' ? 'opacity-50' : ''}`} aria-live="polite">
          <ol className="m-0 grid list-none snap-x snap-mandatory auto-cols-[minmax(220px,1fr)] grid-flow-col gap-4 overflow-x-auto p-0.5 pb-3 lg:overflow-visible">
            {res.runs.map((r, i) => {
              const usd = perYear(r);
              const diff = i === 0 ? null : usd - base;
              const bare = r.seasons.map((s) => s.bareDays).filter(Number.isFinite);
              const worst = worstYield(r);
              return (
                <li key={r.id} className={`snap-start border border-base-300 bg-base-100 p-5 ${i > 0 && diff > 0 ? 'border-t-4 border-t-primary' : ''}`}>
                  <p className="m-0 text-base font-semibold">{labelFor(rotations[i])}</p>
                  <p className="m-0 mt-3 text-sm uppercase tracking-wider text-base-content/60">{t('rotations.testReturn')}</p>
                  <p className="m-0 text-3xl font-bold tabular-nums tracking-tight">{money.format(usd)}</p>
                  <p className="m-0 text-sm text-base-content/70">{t('rotations.testPerYear')}</p>
                  {diff != null && (
                    <p className={`m-0 mt-2 inline-flex items-center gap-1 text-sm font-semibold ${diff >= 0 ? 'text-success' : 'text-error'}`}>
                      {diff >= 0 ? <ArrowUp size={15} aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}
                      {t('rotations.testVsToday', { usd: `${diff >= 0 ? '+' : '−'}${money.format(Math.abs(diff))}` })}
                    </p>
                  )}
                  {bare.length > 0 && <p className="m-0 mt-3 text-base"><strong>{Math.round(bare.reduce((a, b) => a + b, 0) / bare.length)}</strong> <span className="text-base-content/70">{t('rotations.testBare').toLowerCase()}</span></p>}
                  <p className="m-0 mt-1 text-sm text-base-content/75">{worst != null && worst < 85 ? t('rotations.testLoss', { pct: worst }) : t('rotations.testNoLoss')}</p>
                </li>
              );
            })}
          </ol>
          <p className="m-0 mt-2 text-sm leading-relaxed text-base-content/60">{t('rotations.testNote', { year: state.key?.split('|')[0] ?? year })}</p>
        </div>
      )}
    </section>
  );
}
