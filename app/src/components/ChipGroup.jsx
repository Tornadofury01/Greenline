// Tap-to-select chips. multi=true allows several; otherwise exactly one.
// Selected chips show a check mark, so selection isn't shown by color alone.
import { Check } from 'lucide-react';

export default function ChipGroup({ options, value, onChange, multi = false, labelFor, label }) {
  const selected = (id) => (multi ? value.includes(id) : value === id);
  const toggle = (id) => {
    if (!multi) return onChange(id);
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };
  return (
    <div className="chips" role={multi ? 'group' : 'radiogroup'} aria-label={label}>
      {options.map((id) => (
        <button
          key={id}
          type="button"
          className="chip"
          role={multi ? 'checkbox' : 'radio'}
          aria-checked={selected(id)}
          onClick={() => toggle(id)}
        >
          {selected(id) && <Check size={18} strokeWidth={2.5} aria-hidden="true" />}
          {labelFor(id)}
        </button>
      ))}
    </div>
  );
}
