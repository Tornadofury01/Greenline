// Ellis County season replay study (Compare screen, Ellis County fields only).
// Data: /shared/fieldshift/ellis-study.json, built by pipeline/fieldshift/export_app.py from the Field Shift models
// (crop classifier, leak-free stress model, year types) and the season replay + recommender. The replay is a
// simulation built on published agronomy (FAO-56, FAO-33, RUSLE), not machine learning, and it runs on one typical
// field and one NASA POWER weather point, so it never changes this field's own scores. All text goes through t().
import { useState } from 'react';
import { Award, FlaskConical } from 'lucide-react';
import { PlaceholderTag } from './PlaceholderTag.jsx';
import { useApp } from '../state/AppContext.jsx';
import study from '@shared/fieldshift/ellis-study.json';
import ChipGroup from './ChipGroup.jsx';
import GlossaryIcon from './GlossaryIcon.jsx';
import { ConfidenceBadge } from './Small.jsx';

const PRESETS = ['balanced', 'income_first', 'soil_first', 'low_risk'];
const T_HA_TO_T_AC = 0.4461; // metric tonnes per hectare -> US tons per acre

// Rows of the current-vs-recommended table: metric key, i18n key, formatter.
const usd = (v) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v))}`;
const ROWS = [
  ['bare_days', 'bareDays', (v) => Math.round(v)],
  ['soil_loss_t_ha', 'soilLoss', (v) => (v * T_HA_TO_T_AC).toFixed(1)],
  ['return_above_var_typical', 'returnTypical', usd],
  ['return_above_var_worst10', 'returnWorst', usd],
  ['fertilizer_n_lb', 'nBought', (v) => Math.round(v)],
  ['pest_index', 'pest', (v) => Math.round(v)],
];

export const showsFieldShiftStudy = (field) => field?.field?.county === 'Ellis' && field?.field?.state === 'TX';

// fieldBest: the name of the best rotation on the field's own cards (or null), for the "why they differ" note.
export default function FieldShiftStudy({ fieldBest = null }) {
  const { t, field } = useApp();
  const [preset, setPreset] = useState('balanced');
  if (!showsFieldShiftStudy(field)) return null;
  const p = study.recommender.presets[preset];
  const { current: cur, recommended: rec } = p;
  const rot = (k) => t(`fieldShift.rot.${k}`);

  return (
    <section className="card fs-study" aria-labelledby="fs-title">
      <p className="fs-flag"><FlaskConical size={16} aria-hidden="true" /><span>{t('fieldShift.notField')}</span></p>
      <h2 id="fs-title" className="section-title">
        {t('fieldShift.title')} <GlossaryIcon term="seasonReplay" />
      </h2>
      <p className="muted">{t('fieldShift.intro', { n: study.area.nFields })}</p>

      <div className="field-group">
        <h3 className="fs-sub">{t('fieldShift.priorityLabel')}</h3>
        <ChipGroup options={PRESETS} value={preset} onChange={setPreset} labelFor={(k) => t(`fieldShift.preset.${k}`)} label={t('fieldShift.priorityLabel')} />
      </div>

      <div className="fs-pair">
        <div className="fs-tile">
          <span className="muted small">{t('fieldShift.currentLabel')}</span>
          <strong>{rot(cur.key)}</strong>
          <span className={`fs-grade grade-${cur.grade}`}>{cur.grade}</span>
          <span className="small">{t('fieldShift.scoreRank', { score: cur.overall, rank: cur.rank, of: p.ranking.length })}</span>
        </div>
        <div className="fs-tile is-best">
          <span className="muted small"><Award size={14} aria-hidden="true" /> {t(p.keepCurrent ? 'fieldShift.keepLabel' : 'fieldShift.recommendedLabel')}</span>
          <strong>{rot(rec.key)}</strong>
          <span className={`fs-grade grade-${rec.grade}`}>{rec.grade}</span>
          <span className="small">{t('fieldShift.scoreWins', { score: rec.overall, wins: Math.round(rec.winsShare * p.scenarios), of: p.scenarios })}</span>
        </div>
      </div>
      <p><ConfidenceBadge level={p.confidence} /></p>
      {fieldBest && <p className="notice-inline">{t('fieldShift.whyDiffers', { study: rot(rec.key), field: fieldBest })}</p>}
      {p.closeCall && <p className="notice-inline">{t('fieldShift.closeCall', { other: rot(p.runnerUp), gap: p.gapPoints })}</p>}

      <table className="fs-table">
        <caption className="sr-only">{t('fieldShift.tableCaption')}</caption>
        <thead>
          <tr><th scope="col">{t('fieldShift.metric')}</th><th scope="col">{t('fieldShift.colCurrent')}</th><th scope="col">{t('fieldShift.colRecommended')}</th></tr>
        </thead>
        <tbody>
          {ROWS.map(([k, label, fmt]) => (
            <tr key={k}>
              <th scope="row">{t(`fieldShift.m.${label}`)}</th>
              <td>{fmt(cur.metrics[k])}</td>
              <td>{fmt(rec.metrics[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rec.metrics.eqip_per_year > 0 && (
        <p className="small">{t('fieldShift.eqip', { usd: Math.round(rec.metrics.eqip_per_year) })}</p>
      )}

      <h3 className="fs-sub">{t('fieldShift.rankingTitle')}</h3>
      <div className="glance">
        {p.ranking.map((r) => (
          <div key={r.key} className={`glance-row ${r.key === rec.key ? 'is-best' : ''}`}>
            <span className="glance-name">{rot(r.key)}</span>
            <span className="glance-score">{r.avg}</span>
            <span className="glance-bar" aria-hidden="true"><span style={{ width: `${r.avg}%` }} /></span>
          </div>
        ))}
      </div>
      <p className="hint small">{t('fieldShift.rankingHint', { n: p.scenarios })}</p>

      <h3 className="fs-sub">{t('fieldShift.modelsTitle')} <PlaceholderTag /></h3>
      <p className="muted small">{t('fieldShift.modelsPlaceholder')}</p>
      <p className="muted small">{t('fieldShift.notYourField')}</p>
      <p className="muted small">{t('how.dataLabel')}: NASA POWER, NASA NEX-GDDP-CMIP6, Landsat 5/7/8/9, HLS, USDA Cropland Data Layer, SMAP, GPM IMERG, MODIS, OpenLandMap, SRTM, Texas A&amp;M AgriLife, USDA WASDE, NRCS EQIP</p>
    </section>
  );
}
