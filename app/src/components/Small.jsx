// Small presentational pieces shared by several screens.
import { ShieldCheck, Shield, ShieldQuestion, Database, Handshake, MapPin } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import GlossaryIcon from './GlossaryIcon.jsx';

export function JudgmentNote() {
  const { t } = useApp();
  return (
    <p className="judgment-note">
      <Handshake size={16} aria-hidden="true" />
      <span>{t('common.judgmentNote')}</span>
    </p>
  );
}

export function PageHead({ title, intro }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {intro && <p>{intro}</p>}
    </div>
  );
}

// Big number + simple label. `detail` is a short plain line under the label.
export function StatCard({ icon: Icon, label, value, unit, detail, term }) {
  return (
    <div className="stat">
      <div className="stat-top">
        {Icon ? <Icon size={20} aria-hidden="true" /> : <span />}
        {term && <GlossaryIcon term={term} />}
      </div>
      <div className="stat-value">{value}{unit && <span className="stat-unit">{unit}</span>}</div>
      <div className="stat-label">{label}</div>
      {detail && <div className="stat-detail">{detail}</div>}
    </div>
  );
}

// "Source: NASA POWER · 0.5° × 0.625° · 2005–2025", from the field's sources list.
export function Source({ datasets }) {
  const { t, field } = useApp();
  if (!field) return null;
  const rows = datasets.map((d) => field.sources.find((s) => s.dataset === d)).filter(Boolean);
  if (!rows.length) return null;
  const text = rows.map((s) => `${s.dataset} · ${s.resolution} · ${s.dateRange.replace('-', '–')}`).join('; ');
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
