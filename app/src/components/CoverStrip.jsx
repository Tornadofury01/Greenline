// 12 squares, one per month: how likely the ground is bare that month under a rotation.
// Same colours as the field story (green / partly covered / bare), plus a letter and a pattern, so colour is never the only cue.
import { useApp } from '../state/AppContext.jsx';

const level = (p) => (p >= 0.5 ? 'bare' : p >= 0.2 ? 'residue' : 'green');
const WORD = { green: 'low', residue: 'mid', bare: 'high' };

export default function CoverStrip({ months }) {
  const { t } = useApp();
  const letters = t('story.monthsShort');
  const long = t('story.monthsLong');
  const barest = months.map((p, i) => (p >= 0.5 ? long[i] : null)).filter(Boolean);
  return (
    <div className="strip">
      <div className="strip-row" role="img"
        aria-label={barest.length ? t('bareUi.stripAlt', { months: barest.join(', ') }) : t('bareUi.stripAltNone')}>
        {months.map((p, i) => (
          <span key={i} className="strip-col" title={`${long[i]}: ${t(`bareUi.level.${WORD[level(p)]}`)}`}>
            <span className={`strip-cell cover-${level(p)}`} />
            <span className="strip-letter" aria-hidden="true">{letters[i]}</span>
          </span>
        ))}
      </div>
      <div className="legend" aria-hidden="true">
        {['green', 'residue', 'bare'].map((l) => (
          <span key={l} className="legend-item"><span className={`swatch cover-${l}`} />{t(`bareUi.level.${WORD[l]}`)}</span>
        ))}
      </div>
    </div>
  );
}
