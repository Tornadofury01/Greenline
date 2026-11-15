// Small presentational pieces shared by several screens.
import { useId, useState } from 'react';
import { ShieldCheck, Shield, ShieldQuestion, Database, Handshake, MapPin, Receipt as ReceiptIcon, BrainCircuit } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import GlossaryIcon from './GlossaryIcon.jsx';
import { modelSummary } from '../si.js';
import { sourceText } from '../i18n.js';

export function JudgmentNote() {
  const { t } = useApp();
  return (
    <p className="judgment-note">
      <Handshake size={16} aria-hidden="true" />
      <span>{t('common.judgmentNote')}</span>
    </p>
  );
}

// center: a compact centered title (screens that open with a card, like Compare).
export function PageHead({ title, intro, center = false }) {
  return (
    <div className={`page-head${center ? ' page-head-center' : ''}`}>
      <h1>{title}</h1>
      {intro && <p>{intro}</p>}
    </div>
  );
}

// Evidence receipt: tap a claim to see which datasets back it, with resolution and dates.
// `src` is a list of dataset names matching field.sources[].dataset. Without matches it renders plain text.
// field.sources[].scale: is the number read over the field itself, or a regional / county / state value?
// `extra`: rows shaped like field.sources for sources that aren't per-field (e.g. the national N price).
const SCALES = ['patch', 'area', 'county', 'state', 'national', 'model'];

export function Receipt({ src, extra, children }) {
  const { t, field } = useApp();
  const [open, setOpen] = useState(false);
  const id = useId();
  const rows = [...(src || []).map((d) => field?.sources.find((s) => s.dataset === d)), ...(extra || [])].filter(Boolean);
  if (!rows.length) return <span>{children}</span>;
  return (
    <span className="receipt-wrap">
      <button type="button" className="receipt" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span>{children}</span>
        <ReceiptIcon size={14} className="receipt-icon" aria-label={t('common.receiptOpen')} />
      </button>
      {open && (
        <span className="receipt-card" id={id} role="note">
          <span className="receipt-title">{t('common.receiptTitle')}</span>
          {rows.map((s) => (
            <span key={s.dataset} className="receipt-row">
              <strong>{s.dataset}</strong>
              <span>{sourceText(t, s).variable}</span>
              <span className="muted">{t('common.receiptLine', { resolution: sourceText(t, s).resolution, dates: sourceText(t, s).dates })}</span>
              {SCALES.includes(s.scale) && <span className={`receipt-scale scale-${s.scale}`}>{t(`common.scale.${s.scale}`)}</span>}
            </span>
          ))}
          {field?.isSampleData && <span className="muted">{t('common.sampleValues')}</span>}
        </span>
      )}
    </span>
  );
}

// "How sure are the models": accuracy on years each model never saw.
export function ModelCard() {
  const { t, field } = useApp();
  const m = modelSummary(field);
  if (!m) return null;
  const crops = m.stressCrops.map((c) => t(`si.cls.${c}`)).join(', ');
  return (
    <section className="card si-card">
      <h2 className="section-title"><BrainCircuit size={20} aria-hidden="true" />{t('si.title')} <GlossaryIcon term="heldOut" /></h2>
      <p className="muted">{t('si.intro')}</p>
      <ul className="si-list">
        <li>
          <Receipt src={['Greenline SI models', 'Landsat 5/7/8/9', 'USDA Cropland Data Layer']}>
            <strong>{t('si.cropTitle')}</strong> {t('si.cropLine', { acc: m.cropAcc, clean: m.cropClean, base: m.cropBase })}
          </Receipt>
          {m.fieldAgree != null && <span className="si-sub">{t('si.fieldAgree', { pct: m.fieldAgree })}</span>}
        </li>
        <li>
          <Receipt src={['Greenline SI models', 'NASA POWER', 'SMAP L4', 'GPM IMERG']}>
            <strong>{t('si.stressTitle')}</strong> {t('si.stressLine', { acc: m.stressAcc, auc: m.stressAuc, base: m.stressBaseAuc })}
          </Receipt>
          <span className="si-sub">{t('si.stressCrops', { crops })}</span>
        </li>
        <li>
          <Receipt src={['Greenline SI models', 'NASA POWER']}>
            <strong>{t('si.yearTitle')}</strong> {t('si.yearLine', { from: m.yearYears[0], to: m.yearYears[1], drought: m.yearGroups.drought ?? 0, heat: m.yearGroups.heat ?? 0, normal: m.yearGroups.normal ?? 0, wet: m.yearGroups.wet ?? 0 })}
          </Receipt>
        </li>
      </ul>
    </section>
  );
}

// "Low confidence: older satellite" tag for years before 2013 (Landsat 5/7). Opens "Why 2013 matters".
export function LowConfTag() {
  const { t, openHow } = useApp();
  return (
    <button type="button" className="lowconf-tag" onClick={() => openHow('sensor2013')}>
      {t('story.lowConfTag')}
    </button>
  );
}

// Small stat for 2-column grids: round icon, a small label and a bold value. `src` makes the label a receipt.
export function MiniStat({ icon: Icon, label, value, unit, detail, term, src }) {
  return (
    <div className="mini-stat">
      <span className="mini-stat-icon"><Icon size={18} aria-hidden="true" /></span>
      <div className="mini-stat-body">
        <span className="mini-stat-label">{src ? <Receipt src={src}>{label}</Receipt> : label}{term && <GlossaryIcon term={term} />}</span>
        <span className="mini-stat-value">{value}{unit && <small>{unit}</small>}</span>
        {detail && <span className="mini-stat-detail">{detail}</span>}
      </div>
    </div>
  );
}

// "Source: NASA POWER · 0.5° × 0.625° · 2005–2025", from the field's sources list.
export function Source({ datasets }) {
  const { t, field } = useApp();
  if (!field) return null;
  const rows = datasets.map((d) => field.sources.find((s) => s.dataset === d)).filter(Boolean);
  if (!rows.length) return null;
  const text = rows.map((s) => { const x = sourceText(t, s); return `${s.dataset} · ${x.resolution} · ${x.dates}`; }).join('; ');
  return (
    <p className="source">
      <Database size={14} aria-hidden="true" />
      <span>{t('common.source')}: {text}{field.isSampleData ? ` (${t('common.sampleValues')})` : ''}</span>
    </p>
  );
}

// Shown on screens that need a field when none is picked yet.
export function NeedField() {
  const { t, setScreen } = useApp();
  return (
    <div className="empty">
      <h1>{t('common.noFieldTitle')}</h1>
      <p className="muted">{t('common.noField')}</p>
      <button type="button" className="btn btn-primary" onClick={() => setScreen('field')}>
        <MapPin size={20} aria-hidden="true" />{t('common.goPick')}
      </button>
    </div>
  );
}

const CONF_ICON = { high: ShieldCheck, medium: Shield, low: ShieldQuestion };
export function ConfidenceBadge({ level }) {
  const { t } = useApp();
  const Icon = CONF_ICON[level];
  return (
    <span className={`badge conf conf-${level}`}>
      <Icon size={16} aria-hidden="true" />
      {t('compare.confidenceBadge', { level: t(`confidenceLevel.${level}`) })}
    </span>
  );
}
