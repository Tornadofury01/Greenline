// Shared loading / error / "pick a field" states for the v2 screens. `ns` is the i18n group with `loading`,
// `error.network` and `error.invalid`, and `title`. children(v2) renders once the file is ready.
import { useApp } from '../state/AppContext.jsx';
import { useV2 } from '../state/useV2.js';
import { NeedField, PageHead } from './Small.jsx';

export default function V2Gate({ ns, children }) {
  const { t, field } = useApp();
  const v2 = useV2();
  if (!field) return <div className="screen"><NeedField /></div>;
  if (v2.status === 'loading') return <div className="screen"><p className="muted" role="status">{t(`${ns}.loading`)}</p></div>;
  if (v2.status === 'error') {
    return (
      <div className="screen">
        <PageHead title={t(`${ns}.title`)} />
        <p className="sheet-note sheet-warn" role="alert">{t(`${ns}.error.${['invalid', 'missing'].includes(v2.error) ? v2.error : 'network'}`)}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>{t('pick.retry')}</button>
      </div>
    );
  }
  return children(v2);
}
