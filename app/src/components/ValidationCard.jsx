// The validation report card (shared/v2/validation.json), shown as it is: passes, partial results and failures.
// Text is all i18n (v2.val.*); the numbers come from the file.
import { CheckCircle2, XCircle, CircleDashed, CircleDot } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { makeV2Text } from '../data/v2Text.js';
import report from '@shared/v2/validation.json';

const ICON = { pass: CheckCircle2, fail: XCircle, partial: CircleDot, 'pending-model': CircleDashed, 'not-run': CircleDashed };
const pct = (x) => Math.round(x * 100);

// One plain line of what was measured, by check id. Empty when nothing was run.
function measuredLines(c, t, v2t) {
  const m = c.measured;
  if (!m) return [];
  if (c.id === 2) return [t('v2.val.res2', { share: pct(m.fieldsWithin15Days), sim: Math.round(m.meanSimulatedPerYear), meas: Math.round(m.meanMeasuredPerYear) })];
  if (c.id === 3) return [t('v2.val.res3', { days: Math.round(m.meanAbsErrorDays) })];
  if (c.id === 4) {
    return Object.entries(m.byCrop || {}).filter(([, v]) => v.meanRatioSimOverNass != null)
      .map(([crop, v]) => t('v2.val.res4crop', { crop: t(`crops.${crop}`), ratio: pct(v.meanRatioSimOverNass) }));
  }
  return [];
}

export default function ValidationCard() {
  const { t, lang } = useApp();
  const v2t = makeV2Text(t, lang);
  return (
    <section className="card how-list" aria-labelledby="how-val">
      <h2 id="how-val" className="card-kicker">{t('v2.val.title')}</h2>
      <p>{t('v2.val.intro', { n: report.fieldsChecked })}</p>
      {report.checks.map((c) => {
        const Icon = ICON[c.status] || CircleDashed;
        const lines = measuredLines(c, t, v2t);
        return (
          <article key={c.id} className="how-term">
            <h3><Icon size={18} aria-hidden="true" /> {t(c.nameKey)} <span className={`pill val-${c.status}`}>{t(`v2.val.status.${c.status}`)}</span></h3>
            <p className="muted">{t('v2.val.target')}: {v2t(c.target)}</p>
            {lines.map((l, i) => <p key={i}>{l}</p>)}
            {c.n > 0 && <p className="muted">{t('v2.val.n', { n: c.n })}</p>}
            {c.noteKey && <p className="muted">{t(c.noteKey)}</p>}
          </article>
        );
      })}
      <p><strong>{t('v2.val.misses')}</strong></p>
    </section>
  );
}
