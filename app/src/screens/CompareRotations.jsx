// Screen 4: a scoreboard (one row per rotation), a Normal year / Bad year switch, then one card per rotation.
// "Build my own" is scored by the same scoreRotation() function. The Ellis County study sits below the field's own
// cards, clearly marked as a county-wide simulation (not this field).
import { useMemo, useState } from 'react';
import { Award, Tractor, Lightbulb, Send } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { useScores } from '../state/useScores.js';
import { useWide } from '../state/useWide.js';
import RotationCard from '../components/RotationCard.jsx';
import RotationPicker from '../components/RotationPicker.jsx';
import ReplayBar from '../components/ReplayBar.jsx';
import FieldShiftStudy from '../components/FieldShiftStudy.jsx';
import { NeedField, JudgmentNote, PageHead } from '../components/Small.jsx';

// One plain sentence under a table or chart.
function Takeaway({ children }) {
  return <p className="takeaway"><Lightbulb size={18} aria-hidden="true" /><span>{children}</span></p>;
}

export default function CompareRotations() {
  const { t, field, setScreen, replayYear, setReplayYear, whatIf, setWhatIf } = useApp();
  // A scenario is on: a real replay year or a what-if (never both).
  const scenario = replayYear != null || !!whatIf;
  const scores = useScores();
  const [custom, setCustom] = useState([]);
  const [scored, setScored] = useState(null); // crops the farmer asked us to score
  // Recomputed when the replay year changes, so the custom card follows the same replay as the others.
  const customResult = useMemo(() => (scored && scores ? scores.scoreCustom(scored) : null), [scored, scores]);
  // Desktop: one toggle opens all side-by-side cards so details line up for comparison.
  const wide = useWide();
  const [allOpen, setAllOpen] = useState(false);
  const shared = wide ? { open: allOpen, onToggle: setAllOpen } : {};
  // "Bad year" side of the switch: shows the replay picker and the what-if sliders.
  const [badOpen, setBadOpen] = useState(scenario);

  if (!field) return <div className="screen"><NeedField /></div>;

  const cropNames = (r) => r.crops.map((id) => t(`crops.${id}`)).join(', ');
  const options = scores.suggested.map((r, i) => ({
    key: r.rotationId,
    result: r,
    label: t('compare.option', { letter: t(`compare.letters.${i}`) }),
    short: t('compare.option', { letter: t(`compare.letters.${i}`) }),
    name: t(`rotations.${r.rotationId}`),
  }));
  const current = scores.current && { key: 'current', result: scores.current, label: t('compare.current'), short: t('compare.short.current'), name: cropNames(scores.current) };
  const own = customResult && { key: 'custom', result: customResult, label: t('compare.custom'), short: t('compare.short.custom'), name: cropNames(customResult) };
  // "Best match" = top suggestion, only if it beats what the farmer grows now.
  const bestKey = options[0] && (!current || options[0].result.total > current.result.total) ? options[0].key : null;
  const best = options.find((o) => o.key === bestKey) || null;
  const rows = [current, ...options, own].filter(Boolean);
  // While a scenario is on, the cards show the scenario score; otherwise the normal score.
  const shownScore = (r) => (scenario && r.replayTotal != null ? r.replayTotal : r.total);
  // While replaying a drought year, bare days count cover crops as partly established.
  const bareOf = (r) => (scenario && r.replay?.bareDays) || r.bareDays;
  const bareDelta = (r) => (current ? bareOf(r).bareDays - bareOf(current.result).bareDays : null);
  const delta = (r) => (current ? shownScore(r) - shownScore(current.result) : null);
  const maxGross = Math.max(0, ...rows.map((r) => r.result.dollars?.grossPerAcreYear ?? 0)) || null;

  // Scoreboard: normal score, bare days a year, and a bad year. The bad year is the chosen scenario when one is
  // on, else the field's default bad year (2011 drought).
  const badYear = scores.badYear;
  const badScore = (r) => (scenario ? r.replayTotal : scores.badYearScore(r.crops)?.replayTotal) ?? null;
  const badHead = whatIf ? t('compare.col.whatIf')
    : replayYear != null ? t(`compare.col.year.${field.climateYearly.find((y) => y.year === replayYear)?.yearType || 'normal'}`, { year: replayYear })
      : badYear ? t(`compare.col.year.${badYear.yearType}`, { year: badYear.year }) : null;
  const badLabelYear = whatIf ? null : replayYear ?? badYear?.year ?? null;
  const board = rows.map((r) => ({ ...r, score: r.result.total, bare: r.result.bareDays.bareDays, bad: badHead ? badScore(r.result) : null }));
  const top = {
    score: Math.max(...board.map((r) => r.score)),
    bare: Math.min(...board.map((r) => r.bare)),
    bad: Math.max(...board.map((r) => r.bad ?? -1)),
  };
  const anyMaxed = board.some((r) => r.bad === 0);
  const rowOf = (key) => board.find((r) => r.key === key);

  const pickNormal = () => { setBadOpen(false); setReplayYear(null); setWhatIf(null); };
  const pickBad = () => { setBadOpen(true); if (!scenario && badYear) setReplayYear(badYear.year); };

  const takeaway = () => {
    const a = best && rowOf(best.key);
    const b = current && rowOf('current');
    if (a && b) {
      return (
        <>
          {t('compare.takeaway.best', { name: a.short, a: a.score, b: b.score, bareA: a.bare, bareB: b.bare })}
          {a.bad != null && b.bad != null && <> {whatIf ? t('compare.takeaway.whatIf', { dA: a.bad, dB: b.bad }) : t('compare.takeaway.badYear', { year: badLabelYear, dA: a.bad, dB: b.bad })}</>}
        </>
      );
    }
    if (a) return t('compare.takeaway.noCurrent', { name: a.short, a: a.score, bareA: a.bare });
    if (b) return t('compare.takeaway.keep', { b: b.score });
    return null;
  };

  return (
    <div className="screen screen-compare">
      <PageHead title={t('compare.title')} intro={t('compare.intro')} center />

      <section className="card scoreboard" aria-label={t('compare.scoreboardLabel')}>
        <div className="sb-table" role="table">
          <div className="sb-row sb-head" role="row">
            <span role="columnheader" className="sr-only">{t('compare.col.rotation')}</span>
            <span role="columnheader">{t('compare.col.score')}</span>
            <span role="columnheader">{t('compare.col.bare')}</span>
            {badHead && <span role="columnheader">{badHead}</span>}
          </div>
          {board.map((r) => (
            <div key={r.key} className={`sb-row${r.key === bestKey ? ' is-best' : ''}`} role="row">
              <span className="sb-name" role="rowheader">
                <span className="sb-label">
                  {r.short}
                  {r.key === bestKey && <Award size={18} aria-label={t('compare.bestMatch')} />}
                </span>
                <span className="sb-sub">{r.name}</span>
              </span>
              <span role="cell" className={`sb-num${r.score === top.score ? ' top' : ''}`}>{r.score}</span>
              <span role="cell" className={`sb-num${r.bare === top.bare ? ' top' : ''}`}>{r.bare}</span>
              {badHead && (
                <span role="cell" className={`sb-num${r.bad === top.bad ? ' top' : ''}`}>
                  {r.bad === 0
                    ? <><span aria-hidden="true">—</span><span className="sr-only">{t('replayUi.verdict.maxed')}</span></>
                    : r.bad ?? '–'}
                </span>
              )}
            </div>
          ))}
        </div>
        {anyMaxed && <p className="muted small">{t('replayUi.maxedGlance')}</p>}
      </section>
      <Takeaway>{takeaway()}</Takeaway>

      <div className="segmented" role="group" aria-label={t('compare.seg.label')}>
        <button type="button" aria-pressed={!badOpen} onClick={pickNormal}>{t('compare.seg.normal')}</button>
        <button type="button" aria-pressed={badOpen} onClick={pickBad}>{t('compare.seg.bad')}</button>
      </div>
      {badOpen && <ReplayBar embedded />}

      {!current && (
        <div className="notice">
          <Tractor size={20} aria-hidden="true" />
          <div className="notice-body">
            <p>{t('compare.noCurrent')}</p>
            <button type="button" className="btn" onClick={() => setScreen('farm')}>{t('compare.goFarm')}</button>
          </div>
        </div>
      )}

      <div className="rot-grid">
        {best && (
          <RotationCard key={best.key} result={best.result} label={best.label} name={best.name} best delta={delta(best.result)} bareDelta={bareDelta(best.result)} maxGross={maxGross} {...shared} />
        )}
        {current && <RotationCard result={current.result} label={current.label} name={current.name} maxGross={maxGross} {...shared} />}
        {options.filter((o) => o.key !== bestKey).map((o) => (
          <RotationCard key={o.key} result={o.result} label={o.label} name={o.name} delta={delta(o.result)} bareDelta={bareDelta(o.result)} maxGross={maxGross} {...shared} />
        ))}
      </div>

      <div className="split split-build">
        <section className="card">
          <div className="field-group">
            <h2>{t('compare.buildOwn')}</h2>
            <p className="hint">{t('compare.buildHint')}</p>
          </div>
          <RotationPicker label={t('compare.buildOwn')} value={custom} onChange={(v) => { setCustom(v); setScored(null); }} />
          <button type="button" className="btn btn-block" disabled={!custom.length} onClick={() => setScored(custom)}>
            {t('compare.scoreIt')}
          </button>
        </section>
        {customResult && (
          <RotationCard result={customResult} label={t('compare.custom')} name={cropNames(customResult)} delta={delta(customResult)} bareDelta={bareDelta(customResult)} maxGross={maxGross} defaultOpen />
        )}
      </div>

      <FieldShiftStudy fieldBest={best ? `${best.label}: ${best.name}` : current ? current.label : null} />

      <JudgmentNote />

      <button type="button" className="btn btn-primary btn-block btn-cta" onClick={() => setScreen('handoff')}>
        <Send size={20} aria-hidden="true" />{t('compare.sendAgent')}
      </button>
    </div>
  );
}
