// Small v2 honesty marks.
//   <PlaceholderNotice /> ONE line at the top of each v2 screen that has placeholder numbers.
//   <PlaceholderCardTag /> ONE small tag in a card heading; tapping it lists which numbers on that card are placeholders
//                          and which model slot each waits for.
//   <PlaceholderTag />     the plain "placeholder, model coming" tag, for the few older screens (History year types).
//   <SampleBanner />       on top of a screen that is showing the sample file instead of the field's own v2 file.
import { useId, useState } from 'react';
import { Hourglass, FlaskConical, Info } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';

export function PlaceholderTag() {
  const { t } = useApp();
  return (
    <span className="pill pill-placeholder">
      <Hourglass size={12} aria-hidden="true" />
      {t('v2.placeholderTag')}
    </span>
  );
}

export function SampleBanner() {
  const { t } = useApp();
  return (
    <p className="sample-banner" role="note">
      <FlaskConical size={16} aria-hidden="true" />
      {t('v2.sampleBanner')}
    </p>
  );
}

export function PlaceholderNotice() {
  const { t } = useApp();
  return (
    <p className="ph-notice" role="note">
      <Info size={16} aria-hidden="true" />
      {t('v2.notice')}
    </p>
  );
}

// The tag (a button). The panel is a separate component so the card can show it at full width under its heading.
export function PlaceholderCardTag({ open, onToggle, panelId }) {
  const { t } = useApp();
  return (
    <button type="button" className="pill pill-placeholder ph-btn" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
      <Hourglass size={12} aria-hidden="true" />
      {t('v2.placeholderShort')}
    </button>
  );
}

// `items`: [{ labelKey, nameKey?, slots: ['modelA', ...] }]. Grouped by slot: which numbers wait for which model.
export function PlaceholderPanel({ items, id }) {
  const { t } = useApp();
  const bySlot = new Map();
  for (const x of items) for (const slot of x.slots) {
    const label = x.nameKey ? t(x.labelKey, { name: t(x.nameKey).toLowerCase() }) : t(x.labelKey);
    bySlot.set(slot, [...(bySlot.get(slot) || []), label]);
  }
  const order = ['modelA', 'modelB', 'modelC', 'modelD', 'calibrationE'].filter((s) => bySlot.has(s));
  return (
    <div className="ph-panel" id={id} role="note">
      <strong>{t('v2.placeholderListTitle')}</strong>
      <ul>
        {order.map((slot) => (
          <li key={slot}>
            <span>{t(`v2.slots.${slot}`)}</span>
            <span className="muted">{bySlot.get(slot).join(', ')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
