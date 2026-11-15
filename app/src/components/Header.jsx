import { useEffect, useState } from 'react';
import { BookOpen, Plus, Sun, Moon, X } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import Logo from './Logo.jsx';
import { NavItems, SCREENS } from './BottomNav.jsx';

const MENU_LABEL = {
  field: 'nav.field',
  farm: 'nav.farmLong',
  story: 'nav.story',
  options: 'nav.options',
  plans: 'nav.plans',
  risks: 'nav.risksLong',
  sim: 'nav.simLong',
  compare: 'nav.compareLong',
  handoff: 'nav.handoffLong',
};

export default function Header() {
  const { t, lang, setLang, theme, setTheme, field, screen, setScreen, openHow } = useApp();
  const [open, setOpen] = useState(false);
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  useEffect(() => { setOpen(false); }, [screen]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <header className={open ? 'header menu-open' : 'header'}>
        <div className="header-inner">
          <button type="button" className="brand" aria-label={t('app.home')} title={t('app.home')} onClick={() => setScreen('field')}>
            <Logo />
            <span className="brand-name">{t('app.title')}</span>
          </button>
          <nav className="top-nav" aria-label={t('nav.label')}>
            <NavItems />
          </nav>
          <button type="button" className="menu-btn" aria-expanded={open} aria-controls="site-menu"
            aria-label={open ? t('nav.menuClose') : t('nav.menu')} onClick={() => setOpen(!open)}>
            <span>{t('nav.menu')}</span>
            {open ? <X size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
          </button>
        </div>
      </header>
      {open && (
        <div className="menu-sheet" id="site-menu" role="dialog" aria-label={t('nav.label')}>
          <nav className="menu-list">
            {SCREENS.map(({ id }) => (
              <button key={id} type="button" aria-current={screen === id ? 'page' : undefined} onClick={() => setScreen(id)}>
                {t(MENU_LABEL[id])}
              </button>
            ))}
            <button type="button" aria-current={screen === 'how' ? 'page' : undefined} onClick={() => openHow()}>
              <BookOpen size={18} aria-hidden="true" />{t('how.open')}
            </button>
          </nav>
          <div className="menu-tools">
            <div className="lang" role="group" aria-label={t('app.langGroup')}>
              {['en', 'es'].map((code) => (
                <button key={code} type="button" lang={code} aria-pressed={lang === code} onClick={() => setLang(code)}
                  aria-label={t(`app.langName.${code}`)}>
                  <span>{t(`app.langShort.${code}`)}</span>
                </button>
              ))}
            </div>
            <button type="button" className="menu-theme" onClick={() => setTheme(nextTheme)}>
              {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
              {t(`app.theme.${nextTheme}`)}
            </button>
          </div>
        </div>
      )}
      {field?.isSampleData && (
        <div className="sample-strip" role="note">
          <div className="sample-strip-inner">
            <span>{t('app.sampleNotice')}</span>
          </div>
        </div>
      )}
    </>
  );
}
