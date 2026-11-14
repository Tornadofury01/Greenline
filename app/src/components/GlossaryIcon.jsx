// Info button that opens a plain-language explanation of a science term.
// Uses a native <dialog> (bottom sheet on phones): focus is trapped and Esc closes it.
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';

export default function GlossaryIcon({ term }) {
  const { t } = useApp();
  const ref = useRef(null);
  const title = t(`glossary.${term}.title`);
  return (
    <>
      <button type="button" className="info-btn" aria-label={t('common.explain', { term: title })} onClick={() => ref.current?.showModal()}>
        <Info size={20} aria-hidden="true" />
      </button>
      {createPortal(<dialog ref={ref} className="sheet" aria-label={title} onClick={(e) => e.target === ref.current && ref.current.close()}>
        <div className="sheet-body">
          <div className="sheet-head">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => ref.current?.close()}>
              <X size={24} aria-hidden="true" />
            </button>
          </div>
          <p>{t(`glossary.${term}.text`)}</p>
        </div>
      </dialog>, document.body)}
    </>
  );
}
