// What-if sliders (inside the Replay card on Compare). They build a pretend year from this field's own averages
// and re-score every option through the same replay rule (scoring/rules/replay.js whatIfHazards). Hypothetical,
// not a forecast. Picking a real replay year clears them, and moving a slider clears the replay year.
import { useId } from 'react';
import { SlidersHorizontal, FlaskConical, RotateCcw } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';

const RAIN = { min: -50, max: 50, step: 10 };   // % vs. this field's average rain
const HEAT = { min: 0, max: 40, step: 5 };      // extra days at 95 °F or hotter

function Slider({ label, value, range, text, onChange, ends }) {
  const id = useId();
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="slider-value">{text}</output>
      </div>
      <input id={id} type="range" min={range.min} max={range.max} step={range.step} value={value}
        aria-valuetext={text} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="slider-scale" aria-hidden="true"><span>{ends[0]}</span><span>{ends[1]}</span></div>
    </div>
  );
}

export function HypotheticalBanner() {
  const { t } = useApp();
  return (
    <p className="notice-inline notice-hypo" role="status">
      <FlaskConical size={16} aria-hidden="true" />
      <span><strong>{t('whatIfUi.banner')}</strong> {t('whatIfUi.bannerDetail')}</span>
    </p>
  );
}

export default function WhatIfSliders() {
  const { t, whatIf, setWhatIf } = useApp();
  const rain = whatIf ? Math.round(whatIf.rainPct * 100) : 0;
  const heat = whatIf?.heatDays ?? 0;
  const set = (patch) => setWhatIf({ rainPct: rain / 100, heatDays: heat, ...patch });
  const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
  const rainText = rain === 0 ? t('whatIfUi.rainNormal') : t('whatIfUi.rainValue', { pct: signed(rain) });
  const heatText = heat === 0 ? t('whatIfUi.heatNormal') : t('whatIfUi.heatValue', { n: heat });

  return (
    <div className="whatif" role="group" aria-labelledby="whatif-title">
      <h3 id="whatif-title" className="section-title"><SlidersHorizontal size={18} aria-hidden="true" />{t('whatIfUi.title')}</h3>
      <p className="chart-caption">{t('whatIfUi.caption')}</p>
      <Slider label={t('whatIfUi.rain')} value={rain} range={RAIN} text={rainText} ends={['−50%', '+50%']}
        onChange={(v) => set({ rainPct: v / 100 })} />
      <Slider label={t('whatIfUi.heat')} value={heat} range={HEAT} text={heatText} ends={['0', '+40']}
        onChange={(v) => set({ heatDays: v })} />
      {whatIf && <HypotheticalBanner />}
      <button type="button" className="btn" disabled={!whatIf} onClick={() => setWhatIf(null)}>
        <RotateCcw size={16} aria-hidden="true" />{t('whatIfUi.reset')}
      </button>
      <p className="hint small">{t('whatIfUi.assumption')}</p>
    </div>
  );
}
