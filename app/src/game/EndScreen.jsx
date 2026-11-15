// End of the game (5 seasons or out of money): all plots' results side by side, challenge stars, play again.
import { RotateCcw, Star, Trophy } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { PlaceholderTag } from '../components/PlaceholderTag.jsx';
import { meterView, winnerOf, METERS } from './Scoreboard.jsx';

export function Stars({ n, label }) {
  return (
    <span className="gm-stars" role="img" aria-label={label}>
      {[1, 2, 3].map((i) => <Star key={i} size={18} className={i <= n ? '' : 'off'} fill={i <= n ? 'currentColor' : 'none'} aria-hidden="true" />)}
    </span>
  );
}

export function EndScreen({ runs, mode, stars, outOfMoney, played, coins, usd, onAgain, onNew, top = 0 }) {
  const { t, lang } = useApp();
  const num1 = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const win = winnerOf(runs);
  const crop = (id) => t(`crops.${id}`);
  const ph = runs[0].placeholderSlots?.length > 0;
  return (
    <section className="gm-board" style={{ top }} aria-label={t('game.end.title')}>
      <div className="gm-board-inner">
        <h2>{t(outOfMoney ? 'game.end.broke' : 'game.end.title')}</h2>
        {outOfMoney && <p>{t('game.end.brokeWhy', { n: played, usd: usd(coins) })}</p>}
        {mode.kind === 'challenge' ? (
          <div className="gm-endgoal">
            <strong>{t(`game.challenge.${mode.id}.name`)}</strong>
            <Stars n={stars} label={t('game.end.stars', { n: stars })} />
            <p className="small">{t(`game.end.starRule.${mode.id}`)}</p>
          </div>
        ) : <p className="small">{t('game.end.free')}</p>}
        <p className="small muted">{t('game.end.sameWeather', { years: runs[0].seasons.map((s) => s.weatherYear).join(', ') })}</p>
        <div className="gm-endgrid">
          {runs.map((r, i) => {
            const n = r.seasons.length;
            const ero = r.seasons.reduce((a, s) => a + (s.erosion ?? 0), 0) / n;
            const bare = r.seasons.reduce((a, s) => a + (s.bareDays ?? 0), 0) / n;
            return (
              <article key={i} className={`gm-plotcard gm-endcard${i === win ? ' is-winner' : ''}`}>
                <header className="gm-plotcard-head">
                  <span className="gm-pop-plot">{i + 1}</span>
                  {i === win && <span className="gm-winner"><Trophy size={14} aria-hidden="true" />{t('game.board.winner')}</span>}
                </header>
                <p className="small">{r.seasons.map((s) => (s.crops[0] ? crop(s.crops[0].crop) : crop('fallow'))).join(' → ')}</p>
                <dl className="gm-endstats">
                  <div><dt>{t('game.end.money')}</dt><dd className={r.moneyTotal >= 0 ? 'lvl-good' : 'lvl-low'}>{usd(r.moneyTotal)}</dd></div>
                  <div><dt>{t('game.end.soil')}</dt><dd className={ero <= r.toleranceT ? 'lvl-good' : 'lvl-low'}>{t('game.end.soilVal', { t: num1.format(ero), max: num1.format(r.toleranceT) })}</dd></div>
                  <div><dt>{t('game.end.bare')}</dt><dd>{Math.round(bare)}</dd></div>
                  <div><dt>{t('game.end.som')}</dt><dd className={r.somEnd >= r.somStart ? 'lvl-good' : 'lvl-low'}>{`${r.somEnd >= r.somStart ? '+' : ''}${num1.format(Math.round((r.somEnd - r.somStart) * 100) / 100)}`}</dd></div>
                </dl>
                <ul className="gm-endwords">
                  {METERS.map((id) => { const v = meterView(r, id); return <li key={id}><span>{t(`game.meter.${id}.name`)}</span> <strong className={`lvl-${v.level}`}>{t(`game.word.${v.word}`)}</strong></li>; })}
                </ul>
              </article>
            );
          })}
        </div>
        <p className="small muted">{t('game.end.moneyNote')}</p>
        {ph && <p className="small"><PlaceholderTag /> {t('game.board.phNote')}</p>}
      </div>
      <div className="gm-board-foot gm-endfoot">
        <button type="button" className="btn btn-primary" onClick={onAgain}><RotateCcw size={18} aria-hidden="true" />{t('game.end.again')}</button>
        <button type="button" className="btn" onClick={onNew}>{t('game.end.another')}</button>
      </div>
    </section>
  );
}
