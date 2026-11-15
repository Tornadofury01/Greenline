// Screen 4 (v2): Options. Today's rotation first, then the top options against it.
// Data: ONE loader (data/loadV2.js) -> data/v2Options.js -> cards. The sample banner shows only when the sample is used.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Lightbulb } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { useSmoothScroll, scrollToId } from '../state/useSmoothScroll.js';
import VantaTopology from '../components/VantaTopology.jsx';
import SplitText from '../components/bits/SplitText.jsx';
import CountUp from '../components/bits/CountUp.jsx';
import AnimatedContent from '../components/bits/AnimatedContent.jsx';
import { useApp } from '../state/AppContext.jsx';
import { useV2 } from '../state/useV2.js';
import { buildOptionCards } from '../data/v2Options.js';
import OptionSlice, { optionLabel, rotationText } from '../components/OptionSlice.jsx';
import { SampleBanner, PlaceholderNotice } from '../components/PlaceholderTag.jsx';
import { NeedField, PageHead } from '../components/Small.jsx';

gsap.registerPlugin(ScrollTrigger, useGSAP);

// The page itself (props only, so a preview or test can feed it anything). Laid out like anduril.com/air-defense:
// a header slice (label, big title, a row of intro + index links, the field's satellite still), a side-by-side
// comparison row, then one open section per rotation. No cards anywhere.
export function OptionsView({ cards, sample = false, photo = '' }) {
  const { t, field } = useApp();
  const all = [cards.current, ...cards.options];
  // One dollar scale for every rotation, so the profit bars can be compared by eye.
  const pad = 10;
  const scale = {
    min: Math.max(0, Math.min(...all.map((c) => c.profit.low)) - pad),
    max: Math.max(...all.map((c) => c.profit.high)) + pad,
  };
  const best = all.find((c) => c.best) || cards.options[0] || cards.current;
  const [selected, setSelected] = useState(best.id);
  const reduce = useReducedMotion();
  const detailsRef = useRef(null);
  useSmoothScroll();
  const card = all.find((c) => c.id === selected) || best;
  const open = (id) => { setSelected(id); scrollToId('details'); };
  // Score bars grow from zero each time a rotation is shown.
  useGSAP(() => {
    if (reduce) return;
    gsap.utils.toArray('[data-grow]', detailsRef.current).forEach((el, i) => {
      gsap.fromTo(el, { attr: { value: 0 } }, {
        attr: { value: el.getAttribute('value') }, duration: 1.1, delay: 0.15 + i * 0.06, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 92%', once: true },
      });
    });
  }, { scope: detailsRef, dependencies: [selected, reduce], revertOnUpdate: true });
  const placeholders = all.some((c) => c.placeholders.length > 0);
  return (
    <div className="options-page bg-base-100 text-base-content">
      {/* Hero: animated contour lines, the title, and the answer in three numbers */}
      <section className="relative isolate overflow-hidden">
        <VantaTopology className="absolute inset-0 -z-10 opacity-50" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-base-100/20 via-base-100/60 to-base-100" aria-hidden="true" />
        <div className="flex min-h-[78svh] w-full flex-col justify-center gap-8 px-5 pb-20 pt-16 sm:px-8 lg:px-12">
          {(sample || placeholders) && <div className="flex flex-col gap-2">{sample && <SampleBanner />}{placeholders && <PlaceholderNotice />}</div>}
          <span className="badge badge-lg badge-outline w-fit bg-base-100/70">{t('pick.fieldName', { id: field?.field?.id ?? '' })}</span>
          <SplitText text={t('optionsScreen.title')} tag="h1" textAlign="left" splitType="chars" delay={45} duration={1}
            className="m-0 text-7xl font-bold leading-[0.9] tracking-tighter sm:text-9xl" />
          <p className="max-w-2xl text-xl leading-relaxed text-base-content/85 sm:text-2xl">{t('optionsScreen.intro')}</p>
          {cards.goals.length > 0 && (
            <p className="max-w-2xl text-base leading-relaxed text-base-content/70">{t('optionsScreen.weightedFor', { goals: cards.goals.map((k) => t(k)).join(', ') })}</p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary btn-lg rounded-full px-8" onClick={() => open(best.id)}>
              {t('optionsScreen.heroBest')}<ArrowDown size={20} aria-hidden="true" />
            </button>
            <button type="button" className="btn btn-ghost btn-lg rounded-full px-6" onClick={() => scrollToId('compare')}>{t('optionsScreen.heroCompare')}</button>
          </div>
          <div className="stats stats-vertical mt-4 w-full max-w-4xl bg-base-100/75 sm:stats-horizontal">
            <div className="stat">
              <div className="stat-title text-base">{t('optionsScreen.statBest')}</div>
              <div className="stat-value text-primary"><CountUp to={Math.round(best.total)} duration={1.6} /></div>
              <div className="stat-desc text-sm">{optionLabel(t, best)}</div>
            </div>
            {best.deltaTotal != null && best.kind !== 'current' && (
              <div className="stat">
                <div className="stat-title text-base">{t('optionsScreen.statGain')}</div>
                <div className="stat-value"><CountUp to={Math.round(best.deltaTotal)} prefix={best.deltaTotal > 0 ? '+' : ''} duration={1.6} /></div>
                <div className="stat-desc text-sm">{t('optionsScreen.vsToday')}</div>
              </div>
            )}
            <div className="stat">
              <div className="stat-title text-base">{t('optionsScreen.statCount')}</div>
              <div className="stat-value"><CountUp to={all.length} duration={1} /></div>
              <div className="stat-desc whitespace-normal text-sm">{t('optionsScreen.statCountDesc')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Every rotation side by side */}
      <section id="compare" className="w-full px-5 py-24 sm:px-8 lg:px-12">
        <AnimatedContent distance={40} duration={0.9}>
          <h2 className="m-0 text-4xl font-bold tracking-tight sm:text-5xl">{t('optionsScreen.sideBySide')}</h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-base-content/75">{t('optionsScreen.compareIntro')}</p>
        </AnimatedContent>
        <ol className="mt-12 grid snap-x snap-mandatory auto-cols-[minmax(250px,1fr)] grid-flow-col overflow-x-auto pb-4 lg:overflow-visible">
          {all.map((c) => (
            <li key={c.id} className="snap-start border-l border-base-300 first:border-l-0">
              <button type="button" onClick={() => open(c.id)}
                className={`group flex h-full w-full flex-col gap-4 rounded-box px-6 py-6 text-left transition-colors duration-300 hover:bg-base-200 ${selected === c.id ? 'bg-base-200' : ''}`}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">{optionLabel(t, c)}</span>
                  {c.best && <span className="badge badge-primary badge-sm">{t('optionsScreen.best')}</span>}
                </span>
                <span className="flex items-start gap-2">
                  <span className={`text-6xl font-bold leading-none tracking-tighter ${c.best ? 'text-primary' : ''}`}>{Math.round(c.total)}</span>
                  <span className="badge badge-secondary mt-1 font-bold">{c.grade}</span>
                </span>
                <progress className="progress progress-primary h-1.5 w-full" value={Math.round(c.total)} max="100" aria-hidden="true" />
                <span className="text-base leading-relaxed text-base-content/80">{rotationText(t, c)}</span>
                <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-semibold text-primary">
                  {t('optionsScreen.seeDetails')}<ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      {/* One rotation at a time */}
      <section id="details" ref={detailsRef} className="w-full px-5 pb-28 pt-8 sm:px-8 lg:px-12">
        <h2 className="m-0 text-4xl font-bold tracking-tight sm:text-5xl">{t('optionsScreen.detailsTitle')}</h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-base-content/75">{t('optionsScreen.detailsIntro')}</p>
        <div role="tablist" aria-label={t('optionsScreen.detailsTitle')} className="tabs tabs-box mt-10 w-full flex-nowrap overflow-x-auto bg-base-200 sm:w-fit">
          {all.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={selected === c.id} aria-controls="option-panel"
              className={`tab h-11 whitespace-nowrap px-5 text-base ${selected === c.id ? 'tab-active font-semibold' : ''}`}
              onClick={() => setSelected(c.id)}>
              {optionLabel(t, c)}
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={card.id} id="option-panel" role="tabpanel" className="mt-14"
            initial={reduce ? false : { opacity: 0, y: 24, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, filter: 'blur(4px)' }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
            <OptionSlice card={card} scale={scale} />
          </motion.div>
        </AnimatePresence>
      </section>

      <section className="w-full px-5 pb-32 sm:px-8 lg:px-12">
        <div role="note" className="alert alert-soft items-start text-base leading-relaxed">
          <Lightbulb size={22} className="text-primary" aria-hidden="true" />
          <span>{t('optionsScreen.takeaway')}</span>
        </div>
      </section>
    </div>
  );
}

function useFieldStill(id) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!id) return undefined;
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}history/fields/${id}.json`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const frame = data?.frames?.at(-1);
        if (frame?.src && !controller.signal.aborted) setSrc(`${import.meta.env.BASE_URL}${frame.src}`);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id]);
  return src;
}

export default function Options() {
  const { t, field } = useApp();
  const v2 = useV2();
  const photo = useFieldStill(field?.field?.id);
  const cards = useMemo(() => (v2.status === 'ready' ? buildOptionCards(v2.data) : null), [v2.status, v2.data]);
  if (!field) return <div className="screen"><NeedField /></div>;
  if (v2.status === 'loading') return <div className="screen"><p className="muted" role="status">{t('optionsScreen.loading')}</p></div>;
  if (v2.status === 'error') {
    return (
      <div className="screen">
        <PageHead title={t('optionsScreen.title')} />
        <p className="sheet-note sheet-warn" role="alert">{t(`optionsScreen.error.${['invalid', 'missing'].includes(v2.error) ? v2.error : 'network'}`)}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>{t('pick.retry')}</button>
      </div>
    );
  }
  return <OptionsView cards={cards} sample={v2.usingSample} photo={photo} />;
}
