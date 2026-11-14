import { FlaskConical, BookOpen } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import Logo from './Logo.jsx';
import { NavItems } from './BottomNav.jsx';

export default function Header() {
  const { t, lang, setLang, field, screen, openHow } = useApp();
  return (
    <>
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <Logo />
            <span className="brand-name">{t('app.title')}</span>
            <span className="brand-tag">{t('app.tagline')}</span>
          </div>
          {/* Desktop (1024px+): navigation lives in the header. Phones use the bottom bar. */}
          <nav className="top-nav" aria-label={t('nav.label')}>
            <NavItems />
          </nav>
          <button type="button" className="icon-btn how-btn" aria-label={t('how.open')} title={t('how.open')}
            aria-current={screen === 'how' ? 'page' : undefined} onClick={() => openHow()}>
            <BookOpen size={24} aria-hidden="true" />
          </button>
          <div className="lang" role="group" aria-label={t('app.langGroup')}>
            {['en', 'es'].map((code) => (
              <button key={code} type="button" lang={code} aria-pressed={lang === code} onClick={() => setLang(code)}
                aria-label={t(`app.langName.${code}`)}>
                {t(`app.langShort.${code}`)}
              </button>
            ))}
          </div>
        </div>
      </header>
      {field?.isSampleData && (
        <div className="sample-strip" role="note">
          <div className="sample-strip-inner">
            <FlaskConical size={16} aria-hidden="true" />
            <span>{t('app.sampleNotice')}</span>
          </div>
        </div>
      )}
    </>
  );
}
