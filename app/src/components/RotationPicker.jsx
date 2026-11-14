// Build a rotation by tapping crops in order. Used for "current rotation" and "build my own".
import { useApp } from '../state/AppContext.jsx';
import { crops } from '../data/loadField.js';

export default function RotationPicker({ value, onChange }) {
  const { t } = useApp();
  return (
    <div className="rotation-picker">
      <div className="sequence" aria-live="polite">
        <span className="sequence-label">{t('farm.yourList')}:</span>
        {value.length === 0 && <span className="muted">{t('farm.emptyList')}</span>}
        {value.map((id, i) => (
          <button key={`${id}-${i}`} type="button" className="seq-item" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <span className="seq-num">{i + 1}</span> {t(`crops.${id}`)} <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      <div className="chips">
        {crops.crops.map((c) => (
          <button key={c.id} type="button" className="chip" onClick={() => value.length < 6 && onChange([...value, c.id])}>
            + {t(`crops.${c.id}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
