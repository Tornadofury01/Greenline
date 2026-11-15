// Dollar estimates on a rotation card. DISPLAY ONLY: they never change a score or a ranking.
// Gross revenue (before costs, not profit) comes from the field's real USDA NASS 2021-2025 averages
// (scoring/economics.js). The N price behind the fertilizer value is a national estimate from the USDA AMS
// Illinois Production Cost Report (content/economics.json), labeled "not Texas".
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

// Receipt row for the N price (USDA AMS Illinois report: national, not Texas). None when it's a placeholder.
// The report date ("2026-11-13") is shown in the reader's language.
export function reportDate(iso, lang) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric' });
}

function nPriceRows(t, lang, f) {
  const s = f.source;
  if (f.placeholder || !s) return [];
  return [{
    dataset: s.dataset,
    variable: t('dollars.nSourceVar', { perTon: usd(s.usdPerTon), perLb: f.nPrice.toFixed(2) }),
    resolution: s.area, dateRange: reportDate(s.date, lang), scale: s.scale,
  }];
}

// Card face, as a small stat tile: the gross number, a thin bar (share of the highest option shown) and the
// "not profit" label. Notes that need more room (Texas averages, nitrogen value) go under the tiles: DollarNotes.
export function DollarTile({ dollars: d, maxGross }) {
  const { t } = useApp();
  if (!d) return null;
  const pct = d.grossPerAcreYear != null && maxGross ? Math.round((100 * d.grossPerAcreYear) / maxGross) : null;
  return (
    <div className="tile">
      <span className="tile-label"><DollarSign size={16} aria-hidden="true" />{t('dollars.tileLabel')}</span>
      {d.grossPerAcreYear != null ? (
        <>
          <span className="tile-value dollar-num"><Receipt src={d.src}>{t('dollars.tileValue', { usd: usd(d.grossPerAcreYear) })}</Receipt></span>
          <span className="tile-unit">{t('dollars.tileUnit')} <EstimatePill /></span>
        </>
      ) : <span className="tile-unit">{t('dollars.noGross')}</span>}
      {pct != null && (
        <span className="thin-bar" role="img" aria-label={t('dollars.barLabel', { pct })}><span style={{ width: `${Math.min(100, pct)}%` }} /></span>
      )}
      <span className="tile-note">{t('dollars.notProfitShort')}</span>
    </div>
  );
}

export function DollarNotes({ dollars: d }) {
  const { t } = useApp();
  if (!d) return null;
  const stateWarn = d.levels.includes('state') && d.state !== 'OK';
  if (!stateWarn && !d.fertilizer) return null;
  return (
    <div className="dollar-notes">
      {stateWarn && <span className="muted small">{t('dollars.stateWarnShort')}</span>}
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
  const { t, lang } = useApp();
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
          <Receipt extra={nPriceRows(t, lang, d.fertilizer)}>
            {t('dollars.fert', {
              crops: d.fertilizer.crops.map(crop).join(', '), lo: usd(d.fertilizer.lo), hi: usd(d.fertilizer.hi),
              price: d.fertilizer.nPrice.toFixed(2), share: Math.round(d.fertilizer.share * 100),
            })}
          </Receipt>
          <span className={d.fertilizer.placeholder ? 'muted' : 'dollar-warn'}>
            {' '}{d.fertilizer.placeholder ? t('dollars.nPlaceholder') : t('dollars.nSource', { date: reportDate(d.fertilizer.source.date, lang) })}
          </span>
        </p>
      )}
      {d.nUnknown.length > 0 && <p className="small">{t('dollars.nUnknown', { crops: d.nUnknown.map(crop).join(', ') })}</p>}
      {d.state === 'OK' && <p className="muted small">{t('dollars.okNote')}</p>}
      <p className="muted small">{t('dollars.source', { years: (d.period || '2021-2025').replace('-', '–') })}</p>
      <p className="muted small"><strong>{t('dollars.notProfit')}</strong> {t('dollars.notInScore')}</p>
    </section>
  );
}
