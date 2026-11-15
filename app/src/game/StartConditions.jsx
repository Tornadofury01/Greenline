// "Starting conditions": what every plot starts year 1 from (startState.js via the worker), each value with its source.
// Free play: the farmer may correct the two things they can know better than the data (last crop, a soil-test nitrate
// number). Challenges: read only, so everyone gets the same test. Corrections stay in memory only (not saved, not sent).
import { useState } from 'react';
import { ArrowRight, Pencil, RotateCcw } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { PlaceholderTag } from '../components/PlaceholderTag.jsx';
import { CASH_CROPS } from '../sim/simSetup.js';

const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${Math.round(x * 100)}%`);

export function StartConditions({ info, error, editable, fix, setFix, onClose, top = 0 }) {
  const { t } = useApp();
  const [edit, setEdit] = useState(false);
  const [nText, setNText] = useState(fix.soilTestNLb != null ? String(fix.soilTestNLb) : '');
  const src = (k) => (k ? t(`game.startState.src.${k}`) : '');
  const crop = (id) => t(`crops.${id}`);
  const rows = info ? [
    { id: 'water', value: t('game.startState.waterVal', { pct: pct(info.waterShare) }), src: info.sources.water, ph: info.sources.water !== 'modelD' },
    { id: 'n', value: t('game.startState.nVal', { lb: Math.round(info.nMinLb) }), src: info.sources.n },
    { id: 'som', value: t('game.startState.somVal', { pct: info.somPct.toFixed(1) }), src: info.sources.som },
    { id: 'residue', value: t('game.startState.residueVal', { pct: pct(info.residueCover) }), src: info.sources.residue },
    { id: 'pests', value: info.topPest ? t('game.startState.pestVal', { pest: t(`game.pest.${info.topPest.id}`), pct: pct(info.topPest.pressure) }) : '—', src: info.sources.pests },
    { id: 'lastCrop', value: info.lastCrop ? crop(info.lastCrop) : t('game.startState.none'), src: info.sources.lastCrop },
  ] : [];
  const applyN = () => {
    const v = nText.trim() === '' ? null : Number(nText);
    setFix({ ...fix, soilTestNLb: v != null && Number.isFinite(v) && v >= 0 && v <= 500 ? v : null });
  };

  return (
    <section className="gm-board" style={{ top }} aria-labelledby="gm-start-title">
      <div className="gm-board-inner">
        <h2 id="gm-start-title">{t('game.startState.title')}</h2>
        <p className="small">{info?.historyYears ? t('game.startState.intro', { from: info.historyYears[0], to: info.historyYears[1] }) : t('game.startState.introNoHistory')}</p>
        <article className="gm-plotcard">
          {!info && !error && <p className="small muted" role="status">{t('game.startState.loading')}</p>}
          {error && <p className="small" role="alert">{t('game.error')}</p>}
          {info && (
            <dl className="gm-start-list">
              {rows.map((r) => (
                <div key={r.id} className="gm-start-row">
                  <dt>{t(`game.startState.${r.id}`)}</dt>
                  <dd><strong>{r.value}</strong><span className={`gm-start-src src-${r.src}`}>{src(r.src)}</span></dd>
                </div>
              ))}
            </dl>
          )}
          {info?.sources.water !== 'modelD' && info && <p className="small muted">{t('game.startState.waterNote')} <PlaceholderTag /></p>}
          {info?.sources.n !== 'input' && info && <p className="small muted">{t('game.startState.nNote')}</p>}
        </article>
        {editable ? (
          <article className="gm-plotcard">
            {!edit ? (
              <button type="button" className="btn btn-block" onClick={() => setEdit(true)}><Pencil size={18} aria-hidden="true" />{t('game.startState.edit')}</button>
            ) : (
              <>
                <strong>{t('game.startState.lastCropQ')}</strong>
                <div className="gm-opts" role="group" aria-label={t('game.startState.lastCropQ')}>
                  {CASH_CROPS.map((id) => (
                    <button type="button" key={id} className="gm-opt" aria-pressed={(fix.lastCrop ?? info?.lastCrop) === id}
                      onClick={() => setFix({ ...fix, lastCrop: id })}>{crop(id)}</button>
                  ))}
                </div>
                <label className="gm-start-n">
                  <span>{t('game.startState.soilTestQ')}</span>
                  <input type="number" inputMode="decimal" min="0" max="500" step="1" value={nText} placeholder={t('game.startState.soilTestPh')}
                    onChange={(e) => setNText(e.target.value)} onBlur={applyN} onKeyDown={(e) => { if (e.key === 'Enter') applyN(); }} />
                </label>
                <p className="gm-note">{t('game.startState.inputNote')}</p>
                {(fix.lastCrop || fix.soilTestNLb != null) && (
                  <button type="button" className="btn btn-block" onClick={() => { setFix({ lastCrop: null, soilTestNLb: null }); setNText(''); }}>
                    <RotateCcw size={18} aria-hidden="true" />{t('game.startState.reset')}
                  </button>
                )}
              </>
            )}
          </article>
        ) : <p className="small">{t('game.startState.challengeNote')}</p>}
      </div>
      <div className="gm-board-foot">
        <button type="button" className="btn btn-primary btn-block" onClick={() => { applyN(); onClose(); }}>{t('game.startState.go')}<ArrowRight size={18} aria-hidden="true" /></button>
      </div>
    </section>
  );
}
