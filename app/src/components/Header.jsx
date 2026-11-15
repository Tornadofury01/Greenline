// Top bar in the plat-book world: the wordmark, the main tabs (desktop), More, and the language switch.
// Paper ground with a double rule under it, like the head of an atlas page.
import { Ellipsis } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import Logo from './Logo.jsx';
import { TABS, MoreMenu, useMoreMenu } from './BottomNav.jsx';

function LangSwitch() {
  const { t, lang, setLang } = useApp();
  return (
    <div role="group" aria-label={t('app.langGroup')} className="flex items-center">
      {['en', 'es'].map((code, i) => (
        <span key={code} className="flex items-center">
          {i > 0 && <span className="h-4 w-px bg-rule-strong" aria-hidden="true" />}
          <button type="button" lang={code} aria-pressed={lang === code} aria-label={t(`app.langName.${code}`)} onClick={() => setLang(code)}
            className={`plat-label min-h-11 min-w-11 border-0 bg-transparent px-2 text-[13px] ${lang === code ? 'text-ink underline decoration-forest decoration-2 underline-offset-[6px]' : 'text-ink-soft hover:text-ink'}`}>
            {t(`app.langShort.${code}`)}
          </button>
        </span>
      ))}
    </div>
  );
}

export default function Header() {
  const { t, field, screen, setScreen } = useApp();
  const { open, setOpen, wrap, inMore } = useMoreMenu();
  return (
    <>
      <header className="relative z-[1000] h-[var(--plat-header)] border-b-[3px] border-double border-ink/70 bg-paper">
        <div className="mx-auto flex h-full max-w-[1600px] items-center gap-2 pl-4 pr-2 lg:gap-6 lg:px-6">
          <button type="button" aria-label={t('app.home')} title={t('app.home')} onClick={() => setScreen('field')}
            className="mr-auto flex min-h-11 items-center gap-3 border-0 bg-transparent p-0 text-ink">
            <Logo />
            <span className="font-display text-[26px] leading-none tracking-[-0.01em]">{t('app.title')}</span>
          </button>
          <nav aria-label={t('nav.label')} className="hidden h-full items-center lg:flex">
            {TABS.map(({ id }) => (
              <button key={id} type="button" aria-current={screen === id ? 'page' : undefined} onClick={() => setScreen(id)}
                className="plat-tab plat-label text-[13px]">
                {t(`nav.${id}`)}
              </button>
            ))}
            <div ref={wrap} className="relative">
              <button type="button" aria-expanded={open} aria-controls="more-menu-top" onClick={() => setOpen(!open)}
                className={`plat-tab plat-label text-[13px] ${inMore ? 'is-active' : ''}`}>
                {t('nav.more')}<Ellipsis size={16} aria-hidden="true" />
              </button>
              <MoreMenu open={open} id="more-menu-top" place="below" />
            </div>
          </nav>
          <span className="hidden h-6 w-px bg-rule-strong lg:block" aria-hidden="true" />
          <LangSwitch />
        </div>
      </header>
      {field?.isSampleData && (
        <div role="note" className="border-b border-rule bg-caution-soft px-4 py-2 text-[14px] text-caution">
          <div className="mx-auto max-w-[1600px]">{t('app.sampleNotice')}</div>
        </div>
      )}
    </>
  );
}
