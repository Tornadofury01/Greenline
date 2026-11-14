// Small "i" button that explains a term. Text comes from i18n glossary.<term>.
import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';

export default function GlossaryIcon({ term }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <span className="glossary">
      <button type="button" className="info-btn" aria-label={`${t('common.glossaryLabel')} ${t(`glossary.${term}.title`)}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        i
      </button>
      {open && (
        <span className="glossary-pop" role="dialog">
          <strong>{t(`glossary.${term}.title`)}</strong>
          <span>{t(`glossary.${term}.text`)}</span>
          <button type="button" className="link-btn" onClick={() => setOpen(false)}>{t('common.close')}</button>
        </span>
      )}
    </span>
  );
}
