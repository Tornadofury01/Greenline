// Setup bar at the bottom of the game view: plot picker, a tray with the choices of the open tool, quick fill, planned cost,
// "Start season", and the big tool buttons. Only choices the engine really runs (docs/game-plan.md "Player choices").
import { useState } from 'react';
import { Sprout, Leaf, Tractor, FlaskConical, Droplets, Lock, Wand2, Play, X } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { CASH_CROPS, COVERS } from '../sim/simSetup.js';
import { TILLAGE, FERT, IRRIGATION, fertOf, setupCost } from './plots.js';

const TOOLS = [
  { id: 'seeds', Icon: Sprout },
  { id: 'cover', Icon: Leaf },
  { id: 'tillage', Icon: Tractor, locks: true },
  { id: 'fert', Icon: FlaskConical, locks: true },
  { id: 'irr', Icon: Droplets, locks: true, irrigatedOnly: true },
];

export function Toolbar({ k, plots, sel, setSel, setPlot, irrigated, fills, onStart, usd, barRef }) {
  const { t } = useApp();
  const [tool, setTool] = useState(null);
  const [fillOpen, setFillOpen] = useState(false);
  const plot = plots[sel];
  const choice = plot.crops[k] ?? { main: null, cover: null };
  const locked = k > 0;
  const crop = (id) => t(`crops.${id}`);
  const setChoice = (patch) => setPlot(sel, { ...plot, crops: plot.crops.map((c, i) => (i === k ? { main: null, cover: null, ...c, ...patch } : c)), from: null });
  const setControls = (patch) => setPlot(sel, { ...plot, controls: { ...plot.controls, ...patch }, from: null });
  const cost = setupCost(plot.crops[k] ?? { main: 'fallow' }, plot.controls);
  const totalCost = plots.reduce((a, p) => a + setupCost(p.crops[k] ?? { main: 'fallow' }, p.controls), 0);
  const tools = TOOLS.filter((x) => !x.irrigatedOnly || irrigated);

  const opt = (key, active, label, onClick) => (
    <button type="button" key={key} className="gm-opt" aria-pressed={active} onClick={onClick}>{label}</button>
  );
  let tray = null;
  if (tool === 'seeds') tray = CASH_CROPS.map((id) => opt(id, choice.main === id, crop(id), () => setChoice({ main: id })));
  else if (tool === 'cover') tray = [opt('none', !choice.cover, t('game.noCover'), () => setChoice({ cover: null })), ...COVERS.map((id) => opt(id, choice.cover === id, crop(id), () => setChoice({ cover: id })))];
  else if (tool === 'tillage') tray = TILLAGE.map((v) => opt(v, plot.controls.tillage === v, t(`sim.in.tillageOpt.${v}`), () => setControls({ tillage: v })));
  else if (tool === 'fert') tray = Object.keys(FERT).map((v) => opt(v, fertOf(plot.controls.nScale) === v, t(`game.fert.${v}`), () => setControls({ nScale: FERT[v] })));
  else if (tool === 'irr') tray = IRRIGATION.map((v) => opt(v, plot.controls.irrigation === v, t(`sim.in.irrOpt.${v}`), () => setControls({ irrigation: v })));
  const toolLocked = tool && TOOLS.find((x) => x.id === tool)?.locks && locked;

  return (
    <div className="gm-bottom" ref={barRef}>
      {fillOpen && (
        <div className="gm-sheet" role="dialog" aria-label={t('game.fill.title')}>
          <div className="gm-sheet-head"><strong>{t('game.fill.title')}</strong>
            <button type="button" className="gm-icon-btn" aria-label={t('common.close')} onClick={() => setFillOpen(false)}><X size={20} aria-hidden="true" /></button>
          </div>
          {fills.map((f) => (
            <button type="button" key={f.id} className="gm-opt gm-opt-wide" disabled={f.disabled} onClick={() => { f.run(); setFillOpen(false); }}>{f.label}</button>
          ))}
          {locked && <p className="gm-note">{t('game.fill.lockNote')}</p>}
        </div>
      )}
      {tool && (
        <div className="gm-tray" role="group" aria-label={t(`game.tool.${tool}`)}>
          <div className="gm-tray-head">
            <strong>{t('game.plotN', { n: sel + 1 })} · {t(`game.tool.${tool}`)}</strong>
            <button type="button" className="gm-icon-btn" aria-label={t('common.close')} onClick={() => setTool(null)}><X size={20} aria-hidden="true" /></button>
          </div>
          {toolLocked
            ? <p className="gm-note"><Lock size={14} aria-hidden="true" /> {t('game.tool.locked')}</p>
            : <div className="gm-opts">{tray}</div>}
          {tool === 'cover' && <p className="gm-note">{t('game.tool.coverNote')}</p>}
        </div>
      )}
      <p className="gm-cost" title={t('game.setup.costNote')}>{t('game.setup.cost', { n: sel + 1, usd: usd(cost), total: usd(totalCost) })}</p>
      <div className="gm-actions">
        <div className="gm-plotpick" role="group" aria-label={t('game.pickPlot')}>
          {plots.map((p, i) => (
            <button type="button" key={i} aria-pressed={sel === i} aria-label={t('game.plotN', { n: i + 1 })} onClick={() => setSel(i)}>{i + 1}</button>
          ))}
        </div>
        <button type="button" className="btn btn-primary gm-start" onClick={onStart} disabled={!onStart}><Play size={18} aria-hidden="true" />{t('game.setup.start')}</button>
      </div>
      <div className="gm-tools" role="toolbar" aria-label={t('game.tool.label')}>
        {tools.map(({ id, Icon, locks }) => (
          <button type="button" key={id} className="gm-tool" aria-pressed={tool === id} onClick={() => { setTool(tool === id ? null : id); setFillOpen(false); }}>
            <span className="gm-tool-icon"><Icon size={22} aria-hidden="true" />{locks && locked && <Lock size={12} className="gm-tool-lock" aria-hidden="true" />}</span>
            <span className="gm-tool-name">{t(`game.tool.${id}`)}</span>
          </button>
        ))}
        <button type="button" className="gm-tool" aria-pressed={fillOpen} onClick={() => { setFillOpen(!fillOpen); setTool(null); }}>
          <span className="gm-tool-icon"><Wand2 size={22} aria-hidden="true" /></span>
          <span className="gm-tool-name">{t('game.fill.short')}</span>
        </button>
      </div>
    </div>
  );
}
