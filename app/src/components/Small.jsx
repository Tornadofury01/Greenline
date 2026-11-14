// Small presentational pieces shared by several screens.
import { useApp } from '../state/AppContext.jsx';
import GlossaryIcon from './GlossaryIcon.jsx';

export function JudgmentNote() {
  const { t } = useApp();
  return <p className="judgment-note">{t('common.judgmentNote')}</p>;
}

export function StatCard({ label, value, unit, term }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}{unit && <span className="stat-unit"> {unit}</span>}</div>
      <div className="stat-label">{label}{term && <GlossaryIcon term={term} />}</div>
    </div>
  );
}

// Shown on screens that need a field when none is picked yet.
export function NeedField() {
  const { t, setScreen } = useApp();
  return (
    <div className="empty">
      <p>{t('common.noField')}</p>
      <button className="btn primary" onClick={() => setScreen('field')}>{t('common.goPick')}</button>
    </div>
  );
}

export function ConfidencePill({ level }) {
  const { t } = useApp();
  return <span className={`pill conf-${level}`}>{t('compare.confidence')}: {t(`confidenceLevel.${level}`)}</span>;
}
