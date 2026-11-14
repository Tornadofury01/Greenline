// Dollar estimates on a rotation card. DISPLAY ONLY: they never change a score or a ranking.
// Gross revenue (before costs, not profit) comes from the field's real USDA NASS 2021-2025 averages
// (scoring/economics.js). The N price behind the fertilizer value is a placeholder (content/economics.json).
import { DollarSign, Sprout } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { Receipt } from './Small.jsx';
import GlossaryIcon from './GlossaryIcon.jsx';

const usd = (n) => Math.round(n).toLocaleString('en-US');

function EstimatePill() {
  const { t } = useApp();
  return <span className="pill-estimate">{t('dollars.estimate')}</span>;
}

// Where the yield comes from, in plain words. State averages carry the High Plains caveat.
export function levelText(t, level, d) {
  if (level === 'county') return t('dollars.level.county', { county: d.county });
  if (level === 'district') return t('dollars.level.district', { district: d.district || '' });
  return d.state === 'OK' ? t('dollars.level.stateOk') : t('dollars.level.state');
}

// Card face: one gross number and, for nitrogen fixers, the fertilizer value.
export function DollarFace({ dollars: d }) {
  const { t } = useApp();
  if (!d) return null;
  return (
    <div className="dollar-block">
      <div className="dollar-top">
        <DollarSign size={18} aria-hidden="true" />
        {d.grossPerAcreYear != null
          ? <Receipt src={d.src}><strong className="dollar-num">{t('dollars.grossLine', { usd: usd(d.grossPerAcreYear) })}</strong></Receipt>
          : <span>{t('dollars.noGross')}</span>}
        <EstimatePill />
      </div>
      <span className="muted small">{t('dollars.notProfit')}</span>
      {d.levels.includes('state') && d.state !== 'OK' && <span className="muted small">{t('dollars.stateWarnShort')}</span>}
      {d.fertilizer && (
        <span className="dollar-fert">
          <Sprout size={14} aria-hidden="true" />
          {t('dollars.fertShort', { lo: usd(d.fertilizer.lo), hi: usd(d.fertilizer.hi) })}
        </span>
      )}
    </div>
  );
}

// Details: crop by crop, with yield level, the fertilizer math and every caveat.
export function DollarDetails({ dollars: d }) {
  const { t } = useApp();
  if (!d) return null;
  const crop = (id) => t(`crops.${id}`);
  return (
    <section className="detail">
      <h4><DollarSign size={18} aria-hidden="true" /> {t('dollars.title')} <EstimatePill /> <GlossaryIcon term="grossRevenue" /></h4>
      <ul className="dollar-list">
        {d.byCrop.map((c) => (
          <li key={c.crop}>
            {c.status === 'priced' ? (
              <>
                <Receipt src={d.src}>
                  <strong>{crop(c.crop)}: {t('dollars.grossLine', { usd: usd(c.gross) })}</strong>
                </Receipt>
                <span className="muted small">
                  {t('dollars.cropMath', { yield: c.yield, yieldUnit: c.yieldUnit, price: c.price, priceUnit: c.priceUnit, years: (c.years || '').replace('-', '–') })}
                </span>
                <span className={`small ${c.yieldLevel === 'county' ? 'muted' : 'dollar-warn'}`}>{levelText(t, c.yieldLevel, d)}</span>
              </>
            ) : (
              <span>{t(`dollars.status.${c.status}`, { crop: crop(c.crop) })}</span>
            )}
          </li>
        ))}
      </ul>
      {d.grossPerAcreYear != null && (
        <p className="small">
          {t('dollars.perYear', { usd: usd(d.grossPerAcreYear) })}
          {d.pricedYears < d.years && ` ${t('dollars.partial', { priced: d.pricedYears, years: d.years })}`}
        </p>
      )}
      {d.fertilizer && (
        <p className="small">
          <Receipt src={['NASS Quick Stats']}>
            {t('dollars.fert', {
              crops: d.fertilizer.crops.map(crop).join(', '), lo: usd(d.fertilizer.lo), hi: usd(d.fertilizer.hi),
              price: d.fertilizer.nPrice.toFixed(2), share: Math.round(d.fertilizer.share * 100),
            })}
          </Receipt>
          {d.fertilizer.placeholder && <span className="muted"> {t('dollars.nPlaceholder')}</span>}
        </p>
      )}
      {d.nUnknown.length > 0 && <p className="small">{t('dollars.nUnknown', { crops: d.nUnknown.map(crop).join(', ') })}</p>}
      {d.state === 'OK' && <p className="muted small">{t('dollars.okNote')}</p>}
      <p className="muted small">{t('dollars.source', { years: (d.period || '2021-2025').replace('-', '–') })}</p>
      <p className="muted small"><strong>{t('dollars.notProfit')}</strong> {t('dollars.notInScore')}</p>
    </section>
  );
}
