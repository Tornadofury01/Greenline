// Build a rotation by tapping crops in order. Used for "current rotation" and "build my own".
import { Plus, X } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { crops } from '../data/loadField.js';

const MAX_SEASONS = 6;

export default function RotationPicker({ value, onChange, label }) {
  const { t } = useApp();
  return (
    <div className="field-group">
      <div className="picker-box" aria-live="polite">
        <span className="sr-only">{label}</span>
        {value.length === 0 ? (
          <p className="sequence-empty">{t('picker.empty')}</p>
        ) : (
          <ol className="sequence" style={{ listStyle: 'none', padding: 0 }}>
            {value.map((id, i) => (
              <li key={`${id}-${i}`}>
                <button type="button" className="seq-item" onClick={() => onChange(value.filter((_, j) => j !== i))}
                  aria-label={t('picker.remove', { crop: t(`crops.${id}`), n: i + 1 })}>
                  <span className="seq-num" aria-hidden="true">{i + 1}</span>
                  {t(`crops.${id}`)}
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="hint">{t('picker.hint')}</p>
      <div className="chips">
        {crops.crops.map((c) => (
          <button key={c.id} type="button" className="chip chip-add" disabled={value.length >= MAX_SEASONS}
            onClick={() => onChange([...value, c.id])}
            aria-label={t('picker.add', { crop: t(`crops.${c.id}`) })}>
            <Plus size={18} aria-hidden="true" />
            {t(`crops.${c.id}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
