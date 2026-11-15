// Two small v2 honesty marks.
//   <PlaceholderTag />  next to any value whose source is a placeholder model slot ("placeholder, model coming").
//   <SampleBanner />    on top of a screen that is showing the sample file instead of the field's own v2 file.
import { Hourglass, FlaskConical } from 'lucide-react';
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
