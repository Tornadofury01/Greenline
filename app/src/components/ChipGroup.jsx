// Tap-to-select chips. multi=true allows several; otherwise exactly one.
export default function ChipGroup({ options, value, onChange, multi = false, labelFor }) {
  const selected = (id) => (multi ? value.includes(id) : value === id);
  const toggle = (id) => {
    if (!multi) return onChange(id);
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };
  return (
    <div className="chips" role={multi ? 'group' : 'radiogroup'}>
      {options.map((id) => (
        <button
          key={id}
          type="button"
          className={`chip ${selected(id) ? 'on' : ''}`}
          role={multi ? 'checkbox' : 'radio'}
          aria-checked={selected(id)}
          onClick={() => toggle(id)}
        >
          {labelFor(id)}
        </button>
      ))}
    </div>
  );
}
