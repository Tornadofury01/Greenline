// "All rotations" on the Rotations page: a collapsible card with every rotation the engine scored for this field, ranked by
// the farmer's priorities, as short rows. Built to stay usable when a field has many more rotations: sort, filter by a
// crop, and 10 rows at a time with "Show more". Rotations the engine removed (failed a fit check before scoring) are
// listed apart, greyed, with the check they failed. Tapping a scored row opens it in "Look closer".
import { useMemo, useState } from 'react';
import { ListOrdered, ChevronDown, TriangleAlert, ArrowRight } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { cropsOf } from '../data/rotations.js';
import { rotationText } from './OptionSlice.jsx';

const PAGE = 10;
const SORTS = {
  rank: (a, b) => a.rank - b.rank,
  profit: (a, b) => (b.returns?.typical ?? -Infinity) - (a.returns?.typical ?? -Infinity),
  soil: (a, b) => (b.option.soilSaved?.savedVsCurrentTonsPerAcreYear ?? -Infinity) - (a.option.soilSaved?.savedVsCurrentTonsPerAcreYear ?? -Infinity),
  bare: (a, b) => (a.option.soilSaved?.bareDaysPerYear ?? Infinity) - (b.option.soilSaved?.bareDaysPerYear ?? Infinity),
};

export default function AllRotations({ all, removed, onOpen, openId }) {
  const { t, lang, browseRotations } = useApp();
  const money = useMemo(() => new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }), [lang]);
  const [sort, setSort] = useState('rank');
  const [crop, setCrop] = useState('');
  const [shown, setShown] = useState(PAGE);
  const crops = useMemo(() => [...new Set(all.flatMap((e) => cropsOf(e.option)))].sort((a, b) => t(`crops.${a}`).localeCompare(t(`crops.${b}`))), [all, t]);
  const rows = useMemo(() => all.filter((e) => !crop || cropsOf(e.option).includes(crop)).sort(SORTS[sort]), [all, crop, sort]);
  const visible = rows.slice(0, shown);
  const checkName = (id) => t(`optionsScreen.fit.name.${id}`);

  return (
    <details className="gl-card collapse collapse-arrow rounded-none !p-0" open={browseRotations || undefined}>
      <summary className="collapse-title flex min-h-16 items-center gap-3 px-5 py-4 sm:px-7">
        <span className="grid h-10 w-10 flex-none place-items-center bg-primary/10 text-primary"><ListOrdered size={20} aria-hidden="true" /></span>
        <span className="text-xl font-semibold tracking-tight sm:text-2xl">{t('rotations.allTitle', { count: all.length + removed.length })}</span>
      </summary>
      <div className="collapse-content px-5 sm:px-7">
        <p className="m-0 mb-5 max-w-3xl text-base leading-relaxed text-base-content/75">{t('rotations.allIntro')}</p>

        <div className="mb-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium uppercase tracking-wider text-base-content/60">{t('rotations.sortLabel')}</span>
            <select className="select rounded-none border-base-300 bg-base-100" value={sort} onChange={(e) => { setSort(e.target.value); setShown(PAGE); }}>
              {Object.keys(SORTS).map((k) => <option key={k} value={k}>{t(`rotations.sort.${k}`)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium uppercase tracking-wider text-base-content/60">{t('rotations.filterCrop')}</span>
            <select className="select rounded-none border-base-300 bg-base-100" value={crop} onChange={(e) => { setCrop(e.target.value); setShown(PAGE); }}>
              <option value="">{t('rotations.filterAny')}</option>
              {crops.map((c) => <option key={c} value={c}>{t(`crops.${c}`)}</option>)}
            </select>
          </label>
          <p className="m-0 ml-auto text-sm text-base-content/65" aria-live="polite">{t('rotations.showing', { shown: visible.length, total: rows.length })}</p>
        </div>

        {rows.length === 0 && <p className="m-0 py-4 text-base text-base-content/70">{t('rotations.empty')}</p>}
        <ol className="m-0 list-none divide-y divide-base-300 border-y border-base-300 p-0">
          {visible.map((e) => {
            const c = e.card;
            const bare = e.option.soilSaved?.bareDaysPerYear;
            return (
              <li key={c.id}>
                <button type="button" onClick={() => onOpen(c.id)} aria-current={openId === c.id ? 'true' : undefined}
                  className={`group grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-2 py-3 text-left transition-colors hover:bg-base-200 sm:grid-cols-[2.5rem_minmax(0,1fr)_6rem_7rem_7rem_auto] ${openId === c.id ? 'bg-base-200' : ''} ${e.eligible ? '' : 'text-base-content/70'}`}>
                  <span className="text-sm font-semibold tabular-nums text-base-content/60" aria-label={t('rotations.rank', { n: e.rank })}>{e.rank}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-medium">{rotationText(t, c)}</span>
                    {!e.eligible && <span className="mt-0.5 inline-flex items-center gap-1 text-sm text-warning"><TriangleAlert size={14} aria-hidden="true" />{t('rotations.failsCheck')}</span>}
                  </span>
                  <span className="flex items-baseline gap-1.5 justify-self-end sm:justify-self-start">
                    <span className="text-2xl font-bold tabular-nums tracking-tight">{Math.round(c.total)}</span>
                    <span className="badge badge-secondary badge-sm font-bold">{c.grade}</span>
                  </span>
                  <span className="col-start-2 text-sm tabular-nums text-base-content/75 sm:col-start-auto sm:text-base">{e.returns ? t('rotations.perAcre', { usd: money.format(e.returns.typical) }) : '–'}</span>
                  <span className="col-start-2 text-sm tabular-nums text-base-content/75 sm:col-start-auto sm:text-base">{Number.isFinite(bare) ? t('rotations.bareShort', { n: Math.round(bare) }) : '–'}</span>
                  <ArrowRight size={18} className="hidden text-primary transition-transform group-hover:translate-x-1 sm:block" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
        {rows.length > shown && (
          <button type="button" className="btn mt-4 rounded-none border-base-300" onClick={() => setShown(shown + PAGE)}>
            {t('rotations.showMore', { n: Math.min(PAGE, rows.length - shown) })}<ChevronDown size={18} aria-hidden="true" />
          </button>
        )}

        {removed.length > 0 && (
          <details className="mt-6 border-t border-base-300 pt-4">
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-base font-semibold">{t('rotations.removedTitle', { count: removed.length })}<ChevronDown size={18} aria-hidden="true" /></summary>
            <p className="m-0 mb-3 mt-1 text-sm text-base-content/70">{t('rotations.removedIntro')}</p>
            <ul className="m-0 list-none divide-y divide-base-300 p-0 text-base-content/65">
              {removed.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                  <span>{[...r.crops.map((c) => t(`crops.${c}`)), ...r.covers.map((c) => t(`crops.${c}`))].join(' · ')}</span>
                  <span className="text-sm">{t('rotations.failed', { checks: r.failed.map(checkName).join(', ') })}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  );
}

