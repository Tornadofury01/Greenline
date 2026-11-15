// Soil facts (USDA SSURGO) and typical frost dates (PRISM) in plain words, for the Field story and the
// expert handoff. Any value can be missing (the fake sample field has none): missing rows are left out.
import { Mountain, Droplets, ShieldAlert, Award, Snowflake, Sun } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { Fact } from '../screens/PickField.jsx';
import { Receipt, MiniStat } from './Small.jsx';
import { kWord, parseCapability, frostDates } from '../display.js';

// True when the field has at least one of the four soil facts.
const hasSoilFacts = (s = {}) => [s.kFactor, s.tFactor, s.waterStorage100Cm, s.landCapabilityClass].some((x) => x != null);

export function SoilFacts({ field }) {
  const { t } = useApp();
  const s = field.soil || {};
  const k = kWord(s.kFactor);
  const lcc = parseCapability(s.landCapabilityClass);
  const inches = s.waterStorage100Cm != null ? Math.round((s.waterStorage100Cm / 2.54) * 10) / 10 : null;
  if (!hasSoilFacts(s)) return null;
  return (
    <div className="facts">
      {k && (
        <Fact icon={ShieldAlert} tone="soil" label={t('soilFacts.k')} term="kFactor"
          value={t(`soilFacts.kWord.${k}`)} detail={t('soilFacts.kDetail', { k: s.kFactor })} />
      )}
      {s.tFactor != null && (
        <Fact icon={Mountain} tone="soil" label={t('soilFacts.t')} term="tFactor"
          value={t('soilFacts.tValue', { t: s.tFactor })} detail={t('soilFacts.tDetail')} />
      )}
      {inches != null && (
        <Fact icon={Droplets} tone="water" label={t('soilFacts.water')} term="waterStorage"
          value={t('soilFacts.waterValue', { inches })} detail={t('soilFacts.waterDetail', { cm: s.waterStorage100Cm })} />
      )}
      {lcc && (
        <Fact icon={Award} tone="green" label={t('soilFacts.lcc')} term="landCapability"
          value={lcc.sub ? t('soilFacts.lccValueSub', { cls: lcc.cls, sub: t(`soilFacts.sub.${lcc.sub}`) }) : t('soilFacts.lccValue', { cls: lcc.cls })}
          detail={t('soilFacts.lccDetail')} />
      )}
    </div>
  );
}

export function FrostFacts({ field }) {
  const { t } = useApp();
  const f = frostDates(field);
  if (!f) return null;
  const months = t('story.monthsLong');
  const date = (d) => t('frost.date', { month: months[d.month], day: d.day });
  return (
    <div className="facts">
      {f.spring && <Fact icon={Snowflake} tone="water" label={t('frost.spring')} term="frost" value={date(f.spring)} detail={t('frost.typical', { from: f.from, to: f.to })} />}
      {f.fall && <Fact icon={Snowflake} tone="water" label={t('frost.fall')} value={date(f.fall)} detail={t('frost.typical', { from: f.from, to: f.to })} />}
      {f.seasonDays != null && (
        <Fact icon={Sun} tone="green" label={t('frost.season')} value={t('frost.seasonValue', { days: f.seasonDays })}
          detail={f.powerDays != null ? t('frost.powerNote', { days: f.powerDays }) : null} />
      )}
    </div>
  );
}

// Field story: soil and frost as one 2 x 3 grid of small stats with icons.
export function SoilGrid({ field }) {
  const { t } = useApp();
  const s = field.soil || {};
  const k = kWord(s.kFactor);
  const lcc = parseCapability(s.landCapabilityClass);
  const inches = s.waterStorage100Cm != null ? Math.round((s.waterStorage100Cm / 2.54) * 10) / 10 : null;
  const f = frostDates(field);
  const months = t('story.monthsLong');
  const date = (d) => t('frost.date', { month: months[d.month], day: d.day });
  if (!hasSoilFacts(s) && !f) return null;
  return (
    <section className="card" aria-labelledby="soil-title">
      <div className="card-head">
        <h2 id="soil-title" className="card-kicker"><Mountain size={18} aria-hidden="true" />{t('soilFacts.title', { series: s.seriesName || t('common.unknown') })}</h2>
      </div>
      <div className="mini-stats">
        {k && <MiniStat icon={ShieldAlert} label={t('soilFacts.grid.k')} term="kFactor" value={t(`soilFacts.kWord.${k}`)} detail={t('soilFacts.kShort', { k: s.kFactor })} />}
        {s.tFactor != null && <MiniStat icon={Mountain} label={t('soilFacts.grid.t')} term="tFactor" value={t('soilFacts.tShort', { t: s.tFactor })} detail={t('soilFacts.tUnit')} />}
        {inches != null && <MiniStat icon={Droplets} label={t('soilFacts.grid.water')} term="waterStorage" value={t('soilFacts.waterValue', { inches })} detail={t('soilFacts.waterShort', { cm: s.waterStorage100Cm })} />}
        {lcc && <MiniStat icon={Award} label={t('soilFacts.grid.lcc')} term="landCapability" value={t('soilFacts.lccValue', { cls: lcc.cls })} detail={lcc.sub ? t(`soilFacts.sub.${lcc.sub}`) : null} />}
        {f?.spring && <MiniStat icon={Snowflake} label={t('frost.spring')} term="frost" value={date(f.spring)} detail={t('frost.typical', { from: f.from, to: f.to })} />}
        {f?.fall && <MiniStat icon={Snowflake} label={t('frost.fall')} value={date(f.fall)} detail={t('frost.typical', { from: f.from, to: f.to })} />}
      </div>
      {f?.seasonDays != null && (
        <p className="small">
          <Sun size={16} aria-hidden="true" className="inline-icon" />{t('frost.seasonLine', { days: f.seasonDays })}
          {f.powerDays != null && <span className="muted"> {t('frost.powerNote', { days: f.powerDays })}</span>}
        </p>
      )}
      {hasSoilFacts(s) && <p className="muted small"><Receipt src={['USDA SSURGO']}>{t('soilFacts.source')}</Receipt></p>}
      {f && <p className="muted small"><Receipt src={['PRISM', 'NASA POWER']}>{t('frost.source')}</Receipt></p>}
    </section>
  );
}
