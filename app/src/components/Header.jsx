import { useApp } from '../state/AppContext.jsx';

export default function Header() {
  const { t, lang, setLang, field } = useApp();
  return (
    <header className="header">
      <div className="brand">
        <img src="/icon.svg" alt="" width="32" height="32" />
        <div>
          <div className="brand-name">{t('app.title')}</div>
          <div className="brand-tag">{t('app.tagline')}</div>
        </div>
      </div>
      <div className="header-right">
        {field?.isSampleData && <span className="badge">{t('app.sampleBadge')}</span>}
        <button
          className="lang-toggle"
          onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
          aria-label={t('app.langToggleLabel')}
        >
          {t('app.langToggle')}
        </button>
      </div>
    </header>
  );
}
