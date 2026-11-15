// Farm simulator (under "More"): start from "your farm today", change the plan, inputs, money, weather and length, then play it
// day by day. The same engine as the recommendations (/scoring/engine) runs in a web worker. Two plans can run on the same weather.
// It shows what would happen under the chosen weather. It is not a forecast. Yields are placeholders until Calibration E is plugged in.
import { useEffect, useId, useMemo, useState } from 'react';
import { Play, Pause, StepForward, FastForward, Plus, Minus, Copy, Lightbulb, RotateCcw } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { PageHead } from '../components/Small.jsx';
import SlidingTabs from '../components/SlidingTabs.jsx';
import { PlaceholderNotice, PlaceholderCardTag, PlaceholderPanel } from '../components/PlaceholderTag.jsx';
import { SimChart, Legend, BandChart, PLAN_STYLE, UNITS } from '../components/SimCharts.jsx';
import { useSimRuns } from '../sim/useSimRuns.js';
import { slotsFor, todayCrops, defaultControls, pastYears, START_YEAR, MAX_YEARS, CASH_CROPS, COVERS } from '../sim/simSetup.js';
import { readout, totalsOf, eventLog, isoOf, DAY_MS } from '../sim/simView.js';
import economics from '@content/economics.json';

const SPEEDS = { slow: 2, normal: 7, fast: 30 };
const KINDS = ['typical', 'past', 'random', 'ssp245', 'ssp585'];
const SHIFTS = [-14, 0, 14];
const N_RATES = ['default', 0, 40, 80, 120];
const SHOWN_EVENTS = new Set(['planted', 'flowering', 'harvested', 'terminated', 'cut', 'frost-kill', 'flower-frost', 'fallow-start']);
const f1 = (x) => (Math.round(x * 10) / 10).toLocaleString();
const f0 = (x) => Math.round(x).toLocaleString();
const usd = (x) => `${x < 0 ? '−' : ''}$${f0(Math.abs(x))}`;

function Card({ title, tagItems, children, className = '' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className={`card sim-card ${className}`}>
      <div className="opt-name">
        <h2>{title}</h2>
        {tagItems?.length > 0 && <PlaceholderCardTag open={open} onToggle={() => setOpen(!open)} panelId={id} />}
      </div>
      {open && <PlaceholderPanel items={tagItems} id={id} />}
      {children}
    </section>
  );
}

function Select({ label, value, onChange, options }) {
  const id = useId();
  return (
    <div className="sim-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, valueText }) {
  const id = useId();
  return (
    <div className="sim-field">
      <label htmlFor={id}>{label}: <strong>{valueText}</strong></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function PlanEditor({ plan, onChange, onCopyFrom, canCopy }) {
  const { t } = useApp();
  const cropName = (id) => t(`crops.${id}`);
  const setYear = (i, patch) => onChange({ ...plan, crops: plan.crops.map((y, k) => (k === i ? { ...y, ...patch } : y)) });
  const setCtl = (patch) => onChange({ ...plan, controls: { ...plan.controls, ...patch } });
  const c = plan.controls;
  return (
    <div className="sim-editor">
      <fieldset className="sim-years">
        <legend>{t('sim.plan.rotation')}</legend>
        {plan.crops.map((y, i) => (
          <div className="sim-year" key={i}>
            <span className="sim-year-n">{t('sim.plan.year', { n: i + 1 })}</span>
            <Select label={t('sim.plan.crop')} value={y.main} onChange={(v) => setYear(i, { main: v })} options={CASH_CROPS.map((id) => [id, cropName(id)])} />
            <Select label={t('sim.plan.cover')} value={y.cover ?? ''} onChange={(v) => setYear(i, { cover: v || null })} options={[['', t('sim.plan.noCover')], ...COVERS.map((id) => [id, cropName(id)])]} />
          </div>
        ))}
        <div className="sim-row">
          <button type="button" className="btn" disabled={plan.crops.length >= 5} onClick={() => onChange({ ...plan, crops: [...plan.crops, { main: 'fallow', cover: null }] })}><Plus size={18} aria-hidden="true" />{t('sim.plan.addYear')}</button>
          <button type="button" className="btn" disabled={plan.crops.length <= 1} onClick={() => onChange({ ...plan, crops: plan.crops.slice(0, -1) })}><Minus size={18} aria-hidden="true" />{t('sim.plan.removeYear')}</button>
          {canCopy && <button type="button" className="btn" onClick={onCopyFrom}><Copy size={18} aria-hidden="true" />{t('sim.plan.copyA')}</button>}
        </div>
      </fieldset>
      <div className="sim-grid">
        <Select label={t('sim.in.tillage')} value={c.tillage} onChange={(v) => setCtl({ tillage: v })} options={['conventional', 'reduced', 'no-till'].map((v) => [v, t(`sim.in.tillageOpt.${v}`)])} />
        <Select label={t('sim.in.nitrogen')} value={String(c.nitrogen)} onChange={(v) => setCtl({ nitrogen: v === 'default' ? 'default' : Number(v) })} options={N_RATES.map((v) => [String(v), v === 'default' ? t('sim.in.nDefault') : t('sim.in.nRate', { n: v })])} />
        <Select label={t('sim.in.irrigation')} value={c.irrigation} onChange={(v) => setCtl({ irrigation: v })} options={['none', 'limited', 'full'].map((v) => [v, t(`sim.in.irrOpt.${v}`)])} />
        <Select label={t('sim.in.shift')} value={String(c.shiftDays)} onChange={(v) => setCtl({ shiftDays: Number(v) })} options={SHIFTS.map((v) => [String(v), v === 0 ? t('sim.in.shiftNormal') : v < 0 ? t('sim.in.shiftEarly', { n: -v }) : t('sim.in.shiftLate', { n: v })])} />
        <Select label={t('sim.in.maturity')} value={c.maturity} onChange={(v) => setCtl({ maturity: v })} options={['full', 'short'].map((v) => [v, t(`sim.in.maturityOpt.${v}`)])} />
        <Select label={t('sim.in.termination')} value={c.termination} onChange={(v) => setCtl({ termination: v })} options={['at-planting', 'early', 'none'].map((v) => [v, t(`sim.in.termOpt.${v}`)])} />
      </div>
    </div>
  );
}

function Today({ plans, labels, cursor, money }) {
  const { t } = useApp();
  return (
    <div className="sim-today">
      {plans.map((p, k) => {
        const r = readout(p, Math.min(cursor, p.days - 1), money);
        const crop = r.crop && r.crop !== 'none' ? t(`crops.${r.crop}`) : t('sim.today.noCrop');
        return (
          <div className="sim-today-plan" key={p.id}>
            {plans.length > 1 && <h3><span className="sim-swatch" style={{ background: PLAN_STYLE[k].color }} />{labels[k]}</h3>}
            <p className="sim-today-head"><strong>{crop}</strong> · {t(`sim.stage.${r.stage}`)}</p>
            <div className="tiles">
              <div className="tile"><span className="tile-label">{t('sim.today.weather')}</span><span className="tile-value">{f0(r.high)}°/{f0(r.low)}°F</span><span className="tile-note">{t('sim.today.rain', { n: (Math.round(r.rainDay * 100) / 100).toFixed(2) })}</span></div>
              <div className="tile"><span className="tile-label">{t('sim.today.water')}</span><span className="tile-value">{f1(r.waterIn)} in</span><span className="tile-note">{t('sim.today.waterNote', { cap: f1(r.capIn), stress: f0(r.stress * 100) })}</span></div>
              <div className="tile"><span className="tile-label">{t('sim.today.cover')}</span><span className="tile-value">{f0(r.cover * 100)}%</span><span className="tile-note">{t('sim.today.erosion', { n: (Math.round(r.erosion * 100) / 100).toFixed(2) })}</span></div>
              <div className="tile"><span className="tile-label">{t('sim.today.money')}</span><span className="tile-value">{usd(r.profit)}</span><span className="tile-note">{t('sim.today.nitrogen', { n: f0(r.nitrogen) })}</span></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Scoreboard({ plans, labels, money, tagItems }) {
  const { t } = useApp();
  const rows = plans.map((p) => totalsOf(p, money));
  return (
    <Card title={t('sim.score.title')} tagItems={tagItems}>
      <div className="sim-table-wrap">
        <table className="sim-table">
          <thead><tr><th scope="col">{plans.length > 1 ? t('sim.score.plan') : ''}</th><th scope="col">{t('sim.score.profit')}</th><th scope="col">{t('sim.score.soil')}</th><th scope="col">{t('sim.score.bare')}</th><th scope="col">{t('sim.score.nLeached')}</th></tr></thead>
          <tbody>
            {rows.map((r, k) => (
              <tr key={plans[k].id}>
                <th scope="row">{labels[k]}</th>
                <td>{usd(r.profitYear)}</td>
                <td>{f1(r.erosionYear)} <span className="muted">/ {f1(r.tolerance)}</span></td>
                <td>{f0(r.bareYear)}</td>
                <td>{f1(r.nLeachedYear)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tile-note">{t('sim.score.note', { years: f1(rows[0].years) })}</p>
    </Card>
  );
}

function SeasonTable({ plan, label, showLabel }) {
  const { t } = useApp();
  const eps = plan.episodes.filter((e) => e.role !== 'fallow');
  if (!eps.length) return null;
  return (
    <div className="sim-table-wrap">
      <table className="sim-table">
        <caption>{showLabel ? label : t('sim.seasons.caption')}</caption>
        <thead><tr><th scope="col">{t('sim.seasons.crop')}</th><th scope="col">{t('sim.seasons.ended')}</th><th scope="col">{t('sim.seasons.yield')}</th><th scope="col">{t('sim.seasons.vs')}</th></tr></thead>
        <tbody>
          {eps.slice(0, 40).map((e, i) => (
            <tr key={i}>
              <th scope="row">{t(`crops.${e.crop}`)}</th>
              <td>{e.end.slice(0, 7)}</td>
              <td>{e.role === 'cover' ? '–' : `${f1(e.yield)} ${e.unit}`}</td>
              <td>{e.yieldVsTypical != null && e.role !== 'cover' ? `${f0(e.yieldVsTypical * 100)}%` : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Simulator() {
  const { t, field, lang, tillage } = useApp();
  const { status, progress, result, band, bandStatus, error, start } = useSimRuns();
  const slots = useMemo(() => (field ? slotsFor(field) : null), [field]);
  const fieldId = field?.field?.id;
  const [planA, setPlanA] = useState(null);
  const [planB, setPlanB] = useState(null);
  const [compare, setCompare] = useState(false);
  const [editing, setEditing] = useState('A');
  const [scen, setScen] = useState({ kind: 'typical', year: 2011, rainPct: 0, tempF: 0, seed: 1 });
  const [years, setYears] = useState(3);
  const [money, setMoney] = useState({ pricePct: 0, nPrice: economics.nPricePerLb, rent: 0 });
  const [showBand, setShowBand] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('normal');
  const [drawerOpen, setDrawerOpen] = useState(true);

  // The farmer's tillage answer (Farm screen) is the current rotation's tillage; Plan A follows it when it changes.
  useEffect(() => { if (tillage) setPlanA((a) => (a ? { ...a, controls: { ...a.controls, tillage } } : a)); }, [tillage]);

  // "Your farm today" for the picked field; Plan B starts as the same rotation with a cereal rye cover and no-till.
  useEffect(() => {
    if (!field || !slots) return;
    const crops = todayCrops(field, slots);
    setPlanA({ id: 'A', crops, controls: { ...defaultControls(), ...(tillage ? { tillage } : {}) } });
    setPlanB({ id: 'B', crops: crops.map((y) => ({ ...y, cover: 'cereal_rye' })), controls: { ...defaultControls(), tillage: 'no-till' } });
    const ys = pastYears(field);
    setScen((s) => ({ ...s, year: ys.includes(2011) ? 2011 : ys[0] }));
    setCursor(0); setPlaying(false);
  }, [fieldId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run when anything changes (after a short pause so sliders stay smooth).
  const plansKey = JSON.stringify([planA, compare ? planB : null, scen, years, money, showBand]);
  useEffect(() => {
    if (!field || !planA) return undefined;
    const id = setTimeout(() => {
      const plans = [planA, ...(compare ? [planB] : [])];
      start({ field, plans, years, scen: { ...scen, tempC: scen.tempF / 1.8 }, money }, showBand);
      setCursor(0); setPlaying(false);
    }, 350);
    return () => clearTimeout(id);
  }, [plansKey, field]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxIdx = result ? Math.max(...result.map((p) => p.days)) - 1 : 0;
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => setCursor((c) => { if (c >= maxIdx) { setPlaying(false); return c; } return Math.min(maxIdx, c + SPEEDS[speed]); }), 90);
    return () => clearInterval(id);
  }, [playing, speed, maxIdx]);

  const labelA = t(compare ? 'sim.plan.nameA' : 'sim.plan.today'), labelB = t('sim.plan.nameB');
  const labels = compare ? [labelA, labelB] : [labelA];
  const phSlots = new Set(result?.[0]?.placeholderSlots ?? []);
  const tagItems = [
    { labelKey: 'sim.ph.yields', slots: ['calibrationE', 'modelB'].filter((s) => phSlots.has(s)) },
    { labelKey: 'sim.ph.calendars', slots: ['modelA'].filter((s) => phSlots.has(s)) },
    { labelKey: 'sim.ph.weather2040', slots: ['modelC'].filter((s) => phSlots.has(s)) },
    { labelKey: 'sim.ph.startWater', slots: ['modelD'].filter((s) => phSlots.has(s)) },
  ].filter((x) => x.slots.length);

  const jumpMonth = () => {
    if (!result) return;
    const d = new Date((result[0].date0 + cursor) * DAY_MS);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY_MS;
    setCursor(Math.min(maxIdx, next - result[0].date0));
  };

  if (!field || !planA) return <div className="screen"><PageHead title={t('sim.title')} /><p className="muted">{t('common.noField')}</p></div>;
  const editPlan = editing === 'B' && compare ? planB : planA;
  const setEdit = editing === 'B' && compare ? setPlanB : setPlanA;
  const dateText = result ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${isoOf(result[0].date0 + Math.min(cursor, result[0].days - 1))}T00:00:00Z`)) : '';
  const ready = status !== 'error' && result;
  const events = ready ? eventLog(result, cursor).filter((e) => SHOWN_EVENTS.has(e.kind)).slice(-40).reverse() : [];
  const eventText = (e) => {
    const crop = e.crop && e.crop !== 'fallow' ? t(`crops.${e.crop}`).toLowerCase() : '';
    const yieldText = e.units != null && e.unit && e.unit.indexOf('biomass') < 0 ? `${f1(e.units)} ${e.unit}` : '';
    return t(`sim.event.${e.kind}`, { crop, yield: yieldText });
  };

  return (
    <div className="screen screen-sim">
      <PageHead title={t('sim.title')} intro={t('sim.intro')} />
      <PlaceholderNotice />
      <p className="sim-honest" role="note"><Lightbulb size={18} aria-hidden="true" /><span>{t('sim.notForecast')}</span></p>

      <Card title={t('sim.controls.title')}>
        <div className="sim-tabs" role="group" aria-label={t('sim.controls.title')}>
          <button type="button" className="chip" aria-pressed={drawerOpen} onClick={() => setDrawerOpen(!drawerOpen)}>{t(drawerOpen ? 'sim.controls.hide' : 'sim.controls.show')}</button>
          <button type="button" className="chip" aria-pressed={compare} onClick={() => { setCompare(!compare); setEditing(compare ? 'A' : 'B'); }}>{t('sim.plan.compare')}</button>
        </div>
        {drawerOpen && (
          <>
            {compare && (
              <SlidingTabs
                id="sim-plan"
                label={t('sim.plan.editing')}
                value={editing}
                onChange={setEditing}
                options={[
                  { value: 'A', label: labelA },
                  { value: 'B', label: labelB },
                ]}
              />
            )}
            <PlanEditor plan={editPlan} onChange={setEdit} canCopy={compare && editing === 'B'} onCopyFrom={() => setPlanB({ ...planA, id: 'B', crops: planA.crops.map((y) => ({ ...y })) })} />
            <h3>{t('sim.weather.title')}</h3>
            <div className="sim-grid">
              <Select label={t('sim.weather.kind')} value={scen.kind} onChange={(v) => setScen({ ...scen, kind: v })} options={KINDS.map((k) => [k, t(`sim.weather.kinds.${k}`)])} />
              {scen.kind === 'past' && <Select label={t('sim.weather.year')} value={String(scen.year)} onChange={(v) => setScen({ ...scen, year: Number(v) })} options={pastYears(field).map((y) => [String(y), String(y)])} />}
              {scen.kind === 'random' && <button type="button" className="btn sim-reroll" onClick={() => setScen({ ...scen, seed: scen.seed + 1 })}><RotateCcw size={18} aria-hidden="true" />{t('sim.weather.redraw')}</button>}
            </div>
            <Slider label={t('sim.weather.rain')} value={scen.rainPct} min={-40} max={40} step={5} onChange={(v) => setScen({ ...scen, rainPct: v })} valueText={scen.rainPct === 0 ? t('sim.weather.asIs') : t(scen.rainPct > 0 ? 'sim.weather.wetter' : 'sim.weather.drier', { n: Math.abs(scen.rainPct) })} />
            <Slider label={t('sim.weather.temp')} value={scen.tempF} min={-5} max={9} step={1} onChange={(v) => setScen({ ...scen, tempF: v })} valueText={scen.tempF === 0 ? t('sim.weather.asIs') : t(scen.tempF > 0 ? 'sim.weather.hotter' : 'sim.weather.cooler', { n: Math.abs(scen.tempF) })} />
            <h3>{t('sim.money.title')}</h3>
            <Slider label={t('sim.money.price')} value={money.pricePct} min={-30} max={30} step={5} onChange={(v) => setMoney({ ...money, pricePct: v })} valueText={money.pricePct === 0 ? t('sim.weather.asIs') : `${money.pricePct > 0 ? '+' : '−'}${Math.abs(money.pricePct)}%`} />
            <Slider label={t('sim.money.nPrice')} value={money.nPrice} min={0.3} max={1.2} step={0.05} onChange={(v) => setMoney({ ...money, nPrice: Math.round(v * 100) / 100 })} valueText={`$${money.nPrice.toFixed(2)}`} />
            <Slider label={t('sim.money.rent')} value={money.rent} min={0} max={150} step={5} onChange={(v) => setMoney({ ...money, rent: v })} valueText={`$${money.rent}`} />
            <p className="tile-note">{t('sim.money.note')}</p>
            <Slider label={t('sim.length.title')} value={years} min={1} max={MAX_YEARS} step={1} onChange={setYears} valueText={t('sim.length.years', { n: years })} />
            <p className="tile-note">{t('sim.length.note', { year: START_YEAR })}</p>
          </>
        )}
      </Card>

      {status === 'error' && <p className="sheet-note sheet-warn" role="alert">{t('sim.error')}{error && error !== 'worker' ? ` (${error})` : ''}</p>}
      {status === 'running' && !result && <p className="muted" role="status">{t('sim.running')}</p>}

      {ready && (
        <>
          <Card title={t('sim.play.title')} className="sim-play">
            <p className="sim-date" aria-live="off">{dateText}{status === 'running' && <span className="muted"> · {t('sim.running')} {Math.round(progress * 100)}%</span>}</p>
            <input className="sim-scrub" type="range" min={0} max={maxIdx} value={Math.min(cursor, maxIdx)} aria-label={t('sim.play.scrub')} onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }} />
            <div className="sim-row">
              <button type="button" className="btn btn-primary" onClick={() => { if (cursor >= maxIdx) setCursor(0); setPlaying(!playing); }}>
                {playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}{t(playing ? 'sim.play.pause' : 'sim.play.play')}
              </button>
              <button type="button" className="btn" onClick={() => { setPlaying(false); setCursor(Math.min(maxIdx, cursor + 1)); }}><StepForward size={20} aria-hidden="true" />{t('sim.play.stepDay')}</button>
              <button type="button" className="btn" onClick={() => { setPlaying(false); jumpMonth(); }}><FastForward size={20} aria-hidden="true" />{t('sim.play.jumpMonth')}</button>
            </div>
            <div className="segmented sim-speed" role="group" aria-label={t('sim.play.speed')} style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {Object.keys(SPEEDS).map((k) => <button type="button" key={k} aria-pressed={speed === k} onClick={() => setSpeed(k)}>{t(`sim.play.speeds.${k}`)}</button>)}
            </div>
            <Today plans={result} labels={labels} cursor={cursor} money={money} />
          </Card>

          {['crop', 'water', 'soil', 'nutrients', 'pests', 'money'].map((kind) => (
            <Card key={kind} title={t(`sim.chart.${kind}.title`)} tagItems={kind === 'crop' || kind === 'money' ? tagItems : undefined}>
              <p className="tile-note">{t(`sim.chart.${kind}.note`)}</p>
              <SimChart kind={kind} plans={result} labels={labels} cursor={Math.min(cursor, maxIdx)} money={money} unitText={t(`sim.unit.${UNITS[kind]}`)} />
              {compare && <Legend labels={labels} />}
            </Card>
          ))}

          <Scoreboard plans={result} labels={labels} money={money} tagItems={tagItems} />

          <Card title={t('sim.seasons.title')} tagItems={tagItems}>
            {result.map((p, k) => <SeasonTable key={p.id} plan={p} label={labels[k]} showLabel={compare} />)}
          </Card>

          <Card title={t('sim.band.title')}>
            <p className="tile-note">{t('sim.band.intro')}</p>
            <button type="button" className="chip" aria-pressed={showBand} onClick={() => setShowBand(!showBand)}>{t(showBand ? 'sim.band.hide' : 'sim.band.show')}</button>
            {showBand && bandStatus === 'running' && <p className="muted" role="status">{t('sim.running')}</p>}
            {showBand && bandStatus === 'error' && <p className="sheet-note sheet-warn" role="alert">{t('sim.error')}</p>}
            {showBand && bandStatus === 'ready' && band?.map((b, k) => {
              const ends = b.finals.map((f) => f.profit).sort((x, y) => x - y);
              const q = (p) => ends[Math.round((ends.length - 1) * p)];
              return (
                <div key={b.id} className="sim-band">
                  <h3>{labels[k] ?? labels[0]}</h3>
                  <BandChart band={b} color={PLAN_STYLE[k].color} dash={PLAN_STYLE[k].dash} />
                  <p className="takeaway"><Lightbulb size={18} aria-hidden="true" /><span>{t('sim.band.takeaway', { n: b.seasons, low: usd(q(0.1)), mid: usd(q(0.5)), high: usd(q(0.9)) })}</span></p>
                </div>
              );
            })}
          </Card>

          <Card title={t('sim.log.title')}>
            {events.length === 0 ? <p className="muted">{t('sim.log.empty')}</p> : (
              <ol className="sim-log">
                {events.map((e, i) => (
                  <li key={i}>
                    <span className="sim-log-date">{new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${e.date}T00:00:00Z`))}</span>
                    {compare && <span className="pill">{e.plan === 0 ? 'A' : 'B'}</span>}
                    <span>{eventText(e)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
