// Rotations: the one decision page (what used to be Options, Plans and Compare), in the Options page's look (daisyUI,
// square light cards, Lenis, GSAP reveals, React Bits, a Vanta hero, full width). Everything is ranked by the FARMER'S
// priorities, picked right here (same choices as Your farm): change them and every rotation is re-scored and re-ranked.
//   1. hero: the priorities, the answer in three numbers
//   2. your top 3 next to what you grow now
//   3. look closer: one rotation at a time (scores, checks, money, how to farm it, Play this plan)
//   4. test in a bad year: real past weather plus an optional what-if, run on the engine
//   5. all rotations: a collapsible list of every scored rotation (and the ones the engine removed)
// Data: data/loadV2.js (useV2) -> data/rotations.js buildRotations (Nikki's merge rules from data/mergedPlans.js).
import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Target, Gamepad2, TriangleAlert, Wrench } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { PRIORITIES } from '@scoring/index.js';
import { useApp } from '../state/AppContext.jsx';
import { useV2 } from '../state/useV2.js';
import { buildRotations } from '../data/rotations.js';
import { setPlayPlan } from '../game/playPlan.js';
import OptionSlice, { optionLabel, rotationText } from '../components/OptionSlice.jsx';
import RotationTest from '../components/RotationTest.jsx';
import AllRotations from '../components/AllRotations.jsx';
import RankedPriorities from '../components/RankedPriorities.jsx';
import { SampleBanner, PlaceholderNotice } from '../components/PlaceholderTag.jsx';
import { NeedField } from '../components/Small.jsx';
import { useSmoothScroll, scrollToId } from '../state/useSmoothScroll.js';
import VantaTopology from '../components/VantaTopology.jsx';
import SplitText from '../components/bits/SplitText.jsx';
import CountUp from '../components/bits/CountUp.jsx';
import AnimatedContent from '../components/bits/AnimatedContent.jsx';

gsap.registerPlugin(ScrollTrigger, useGSAP);

// "How to farm it": the management the engine picked (Nikki's rows from the Plans page, same text keys).
function HowToFarm({ option }) {
  const { t } = useApp();
  const m = option.management || {};
  const hasCover = (option.sequence || []).some((y) => y.crops.some((c) => c.role === 'cover'));
  const pick = (group, v) => { const k = `plansScreen.mgmt.${group}.${v}`; const s = t(k); return s === k ? String(v) : s; };
  const rows = [
    ['plantingDate', m.plantingDate != null && pick('plantingDate', m.plantingDate)],
    ['nitrogen', m.nitrogenLbPerAcre != null && (m.nitrogenLbPerAcre === 0 ? t('plansScreen.mgmt.nitrogen.none') : t('plansScreen.mgmt.nitrogen.rate', { lb: m.nitrogenLbPerAcre }))],
    ['maturity', m.maturity != null && pick('maturity', m.maturity)],
    ['cover', hasCover ? m.coverTermination != null && pick('cover', m.coverTermination) : t('plansScreen.mgmt.cover.none')],
    ['doubleCrop', m.doubleCrop != null && t(`plansScreen.mgmt.doubleCrop.${m.doubleCrop ? 'yes' : 'no'}`)],
    ['tillage', m.tillage != null && pick('tillage', m.tillage)],
    ['irrigation', m.irrigation != null && pick('irrigation', m.irrigation)],
  ].filter(([, v]) => v);
  if (!rows.length) return null;
  return (
    <section className="gl-card">
      <div className="mb-2 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center bg-primary/10 text-primary"><Wrench size={20} aria-hidden="true" /></span>
        <h3 className="m-0 text-xl font-semibold tracking-tight sm:text-2xl">{t('rotations.howTitle')}</h3>
      </div>
      <p className="m-0 mb-4 text-base text-base-content/70">{t('rotations.howNote')}</p>
      <dl className="m-0 grid grid-cols-1 gap-x-10 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(([id, v]) => (
          <div key={id} className="border-t border-base-300 py-3">
            <dt className="text-sm font-medium uppercase tracking-wider text-base-content/60">{t(`plansScreen.mgmt.label.${id}`)}</dt>
            <dd className="m-0 mt-1 text-lg font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function RotationsView({ data, sample = false }) {
  const { t, field, farm, updateFarm, setScreen } = useApp();
  const reduce = useReducedMotion();
  const detailsRef = useRef(null);
  useSmoothScroll();
  // Re-ranked every time the farmer changes a priority.
  const r = useMemo(() => buildRotations(data, farm.priorities, farm), [data, farm]);
  const shown = [r.current, ...r.top];
  const best = r.top[0] ?? null;
  const [picked, setPicked] = useState(null);
  const pickedEntry = picked ? (r.all.find((e) => e.card.id === picked) ?? (picked === r.current.card.id ? r.current : null)) : null;
  const selected = pickedEntry ?? best ?? r.current;
  const extra = pickedEntry && !shown.some((e) => e.card.id === pickedEntry.card.id) ? pickedEntry : null;
  const tabs = extra ? [...shown, extra] : shown;
  const pad = 10;
  const scale = {
    min: Math.min(...tabs.map((e) => e.card.profit.low)) - pad,
    max: Math.max(...tabs.map((e) => e.card.profit.high)) + pad,
  };
  const labelFor = (e) => (e.card.kind === 'current' ? t('optionsScreen.current') : e === extra ? `${t('rotations.rank', { n: e.rank })}` : t('optionsScreen.option', { letter: 'ABC'[r.top.indexOf(e)] ?? '' }));
  const open = (id) => { setPicked(id); scrollToId('details'); };
  const placeholders = tabs.some((e) => e.card.placeholders.length > 0);
  const eligibleCount = r.all.filter((e) => e.eligible).length;

  // Score bars grow from zero each time a rotation is shown.
  useGSAP(() => {
    if (reduce) return;
    gsap.utils.toArray('[data-grow]', detailsRef.current).forEach((el, i) => {
      gsap.fromTo(el, { attr: { value: 0 } }, {
        attr: { value: el.getAttribute('value') }, duration: 1.1, delay: 0.15 + i * 0.06, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 92%', once: true },
      });
    });
  }, { scope: detailsRef, dependencies: [selected.card.id, reduce, farm.priorities.join()], revertOnUpdate: true });

  return (
    <div className="options-page bg-base-100 text-base-content">
      {/* Hero: priorities first, then the answer */}
      <section className="relative isolate overflow-hidden">
        <VantaTopology className="absolute inset-0 -z-10 opacity-50" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-base-100/20 via-base-100/60 to-base-100" aria-hidden="true" />
        <div className="grid w-full grid-cols-1 items-end gap-x-12 gap-y-6 px-5 pb-10 pt-8 sm:px-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:px-12 lg:pt-10">
          {(sample || placeholders) && <div className="flex flex-col gap-2 lg:col-span-2">{sample && <SampleBanner />}{placeholders && <PlaceholderNotice />}</div>}
          <div className="flex flex-col gap-5">
            <span className="badge badge-lg badge-outline w-fit bg-base-100/70">{t('pick.fieldName', { id: field?.field?.id ?? '' })}</span>
            <SplitText text={t('rotations.title')} tag="h1" textAlign="left" splitType="chars" delay={45} duration={1}
              className="m-0 text-6xl font-bold leading-[1.2] tracking-tighter sm:text-8xl" />
            <p className="max-w-2xl text-lg leading-relaxed text-base-content/85 sm:text-xl">{t('rotations.intro')}</p>
          </div>
          <div className="stats stats-horizontal gl-card rounded-none w-full auto-cols-[minmax(0,1fr)] overflow-visible !p-0 [&_.stat-title]:whitespace-normal [&_.stat-title]:text-sm sm:[&_.stat-title]:text-base [&_.stat]:px-3 sm:[&_.stat]:px-5 [&_.stat-desc]:whitespace-normal [&_.stat-value]:text-3xl sm:[&_.stat-value]:text-4xl">
            <div className="stat">
              <div className="stat-title">{t('rotations.statBest')}</div>
              <div className="stat-value text-primary">{best ? <CountUp key={`${best.card.id}-${best.card.total}`} to={Math.round(best.card.total)} duration={1.2} /> : '–'}</div>
              <div className="stat-desc text-sm">{best ? rotationText(t, best.card) : ''}</div>
            </div>
            <div className="stat">
              <div className="stat-title">{t('rotations.statGain')}</div>
              <div className="stat-value">{best ? <CountUp key={`g-${best.card.deltaTotal}`} to={Math.round(best.card.deltaTotal)} prefix={best.card.deltaTotal > 0 ? '+' : ''} duration={1.2} /> : '–'}</div>
              <div className="stat-desc text-sm">{t('optionsScreen.vsToday')}</div>
            </div>
            <div className="stat">
              <div className="stat-title">{t('rotations.statCount')}</div>
              <div className="stat-value"><CountUp to={r.all.length} duration={1} /></div>
              <div className="stat-desc text-sm">{t('rotations.statCountDesc', { eligible: eligibleCount, removed: r.removed.length })}</div>
            </div>
          </div>

          {/* The priorities: the ranking is calculated from these */}
          <div className="gl-card border-primary/40 lg:col-span-2">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 flex-none place-items-center bg-primary text-primary-content"><Target size={20} aria-hidden="true" /></span>
              <div>
                <h2 id="rot-prio-title" className="m-0 text-xl font-bold tracking-tight sm:text-2xl">{t('rotations.prioritiesTitle')}</h2>
                <p className="m-0 mt-1 max-w-3xl text-base leading-relaxed text-base-content/80">{t('rotations.prioritiesNote')}</p>
              </div>
            </div>
            <div className="mt-4 border-t border-base-300 pt-4">
              <RankedPriorities options={PRIORITIES} value={farm.priorities} onChange={(v) => updateFarm({ priorities: v })} labelledBy="rot-prio-title" />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 lg:col-span-2">
            <button type="button" className="btn btn-primary btn-lg rounded-full px-8" onClick={() => scrollToId('top3')}>
              {t('rotations.topTitle')}<ArrowDown size={20} aria-hidden="true" />
            </button>
            <button type="button" className="btn btn-ghost btn-lg rounded-full px-6" onClick={() => scrollToId('test')}>{t('rotations.testTitle')}</button>
          </div>
        </div>
      </section>

      {/* Top 3 next to today */}
      <section id="top3" className="w-full px-5 py-10 sm:px-8 lg:px-12">
        <AnimatedContent distance={40} duration={0.9}>
          <h2 className="m-0 text-3xl font-bold tracking-tight sm:text-4xl">{t('rotations.topTitle')}</h2>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-base-content/75">{t('rotations.topIntro')}</p>
        </AnimatedContent>
        <ol className="m-0 mt-6 grid list-none snap-x snap-mandatory auto-cols-[minmax(250px,1fr)] grid-flow-col gap-4 overflow-x-auto px-0.5 pb-5 pt-0.5 lg:overflow-visible">
          {shown.map((e) => {
            const c = e.card;
            return (
              <li key={c.id} className={`gl-card snap-start !p-0 transition-colors duration-300 ${selected.card.id === c.id ? '!border-primary' : ''}`}>
                <button type="button" onClick={() => open(c.id)}
                  className="group flex h-full w-full flex-col gap-4 rounded-none border-0 bg-transparent px-6 py-6 text-left shadow-none transition-colors duration-300 hover:bg-base-200/60">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold">{labelFor(e)}</span>
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
            );
          })}
        </ol>
      </section>

      {/* No rotation passed every check and limit for this field: say so plainly, never invent one */}
      {r.top.length === 0 && (
        <section className="w-full px-5 pb-4 sm:px-8 lg:px-12">
          <p role="note" className="gl-card m-0 flex items-start gap-3 text-base leading-relaxed">
            <TriangleAlert size={22} className="mt-0.5 flex-none text-warning" aria-hidden="true" />
            <span>{t('rotations.noBetter', { count: r.all.length })}</span>
          </p>
        </section>
      )}

      {/* One rotation at a time */}
      <section id="details" ref={detailsRef} className="w-full px-5 pb-12 pt-4 sm:px-8 lg:px-12">
        <h2 className="m-0 text-3xl font-bold tracking-tight sm:text-4xl">{t('rotations.detailsTitle')}</h2>
        <p className="mt-3 max-w-2xl text-lg leading-relaxed text-base-content/75">{t('rotations.detailsIntro')}</p>
        <div role="tablist" aria-label={t('rotations.detailsTitle')} className="tabs tabs-box mt-6 w-full flex-nowrap overflow-x-auto rounded-none border border-base-300 bg-base-200 sm:w-fit [&_.tab]:rounded-none">
          {tabs.map((e) => (
            <button key={e.card.id} type="button" role="tab" aria-selected={selected.card.id === e.card.id} aria-controls="rotation-panel"
              className={`tab h-11 whitespace-nowrap px-5 text-base ${selected.card.id === e.card.id ? 'tab-active font-semibold' : ''}`}
              onClick={() => setPicked(e.card.id)}>
              {e === extra ? `${t('rotations.fromList')} · ${labelFor(e)}` : labelFor(e)}
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={`${selected.card.id}-${farm.priorities.join()}`} id="rotation-panel" role="tabpanel" className="mt-8 flex flex-col gap-5"
            initial={reduce ? false : { opacity: 0, y: 24, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, filter: 'blur(4px)' }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
            {selected.eligible === false && (
              <p role="note" className="m-0 flex items-start gap-2 border border-warning/40 bg-warning/10 px-4 py-3 text-base text-warning"><TriangleAlert size={18} className="mt-0.5 flex-none" aria-hidden="true" />{t('rotations.notEligible')}</p>
            )}
            <OptionSlice card={selected.card} scale={scale} />
            <HowToFarm option={selected.option} />
            <div>
              <button type="button" className="btn btn-primary btn-lg rounded-none px-7" onClick={() => { setPlayPlan(selected.option); setScreen('sim'); }}>
                <Gamepad2 size={20} aria-hidden="true" />{t('rotations.play')}
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      </section>

      {/* Bad-year test */}
      <section id="test" className="w-full px-5 pb-10 sm:px-8 lg:px-12">
        <RotationTest key={shown.map((e) => e.card.id).join()} rotations={shown} labelFor={labelFor} />
      </section>

      {/* Every rotation, folded */}
      <section id="all" className="w-full px-5 pb-16 sm:px-8 lg:px-12">
        <AllRotations all={r.all} removed={r.removed} onOpen={open} openId={selected.card.id} />
        <div role="note" className="gl-card mt-5 flex items-start gap-3 text-base leading-relaxed">
          <Target size={22} className="mt-0.5 flex-none text-primary" aria-hidden="true" />
          <span>{t('optionsScreen.takeaway')}</span>
        </div>
      </section>
    </div>
  );
}

export default function Rotations() {
  const { t, field } = useApp();
  const v2 = useV2();
  if (!field) return <div className="screen"><NeedField /></div>;
  if (v2.status === 'loading') return <div className="screen"><p className="muted" role="status">{t('optionsScreen.loading')}</p></div>;
  if (v2.status === 'error') {
    return (
      <div className="screen">
        <p className="sheet-note sheet-warn" role="alert">{t(`optionsScreen.error.${['invalid', 'missing'].includes(v2.error) ? v2.error : 'network'}`)}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>{t('pick.retry')}</button>
      </div>
    );
  }
  return <RotationsView key={v2.data.field.id} data={v2.data} sample={v2.usingSample} />;
}
