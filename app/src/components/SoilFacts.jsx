// Soil facts (USDA SSURGO) and typical frost dates (PRISM) in plain words, for the Field story and the
// expert handoff. Any value can be missing (the fake sample field has none): missing rows are left out.
import { Mountain, Droplets, ShieldAlert, Award, Snowflake, Sun } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { Fact } from '../screens/PickField.jsx';
import { Receipt } from './Small.jsx';
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

// Field story: two cards side by side on desktop.
export default function SoilAndFrost({ field }) {
  const { t } = useApp();
  const soil = hasSoilFacts(field.soil) && <SoilFacts field={field} />;
  const frost = frostDates(field) && <FrostFacts field={field} />;
  if (!soil && !frost) return null;
  return (
    <div className="split">
      {soil && (
        <section className="card">
          <h2>{t('soilFacts.title', { series: field.soil.seriesName || t('common.unknown') })}</h2>
          {soil}
          <p className="muted small"><Receipt src={['USDA SSURGO']}>{t('soilFacts.source')}</Receipt></p>
        </section>
      )}
      {frost && (
        <section className="card">
          <h2>{t('frost.title')}</h2>
          {frost}
          <p className="muted small"><Receipt src={['PRISM', 'NASA POWER']}>{t('frost.source')}</Receipt></p>
        </section>
      )}
    </div>
  );
}
