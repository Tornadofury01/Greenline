// Turns a contract text ({ key, params }) into a sentence. The contract sends plain numbers and ids; this formats them
// (shares as %, dollars, acres, crop ids to crop names) so the i18n strings stay simple. Unknown keys show a neutral line.
export function makeV2Text(t, lang) {
  const money = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const num = new Intl.NumberFormat(lang);
  const cropName = (id) => { const k = `crops.${id}`; const v = t(k); return v === k ? id : v; };
  const SHARES = new Set(['shortYears', 'share', 'chance', 'beatsShare', 'risk', 'probability', 'ratioError']);
  const MONEY = new Set(['usd', 'diffUsd']);
  const MONTHS = (m) => new Intl.DateTimeFormat(lang, { month: 'long' }).format(new Date(2001, m - 1, 1));
  const r2 = (n) => Math.round(n * 100) / 100;
  // A few params change meaning with the key: 0 to 1 shown as percent, or a plain ratio shown as "times".
  const PCT = { 'v2.fit.market.warnWeakPrice': ['ratio'], 'v2.reason.water.supply': ['ratio'] };
  const fmt = (name, v, key) => {
    if (Array.isArray(v)) {
      if (name === 'slots') return v.map((s) => t(`v2.slots.${s}`)).join(', ');
      return v.map(cropName).join(name === 'covers' ? ' + ' : ', ');
    }
    if (v == null) return '0';
    if (name === 'pest') { const k = `v2.pest.${v}`; const o = t(k); return o === k ? v : o; }
    if (name === 'month') return MONTHS(v);
    if (PCT[key]?.includes(name)) return String(Math.round(v * 100));
    if (typeof v === 'number') {
      if (SHARES.has(name)) return String(Math.round(v * 100));
      if (MONEY.has(name)) return money.format(v);
      if (name === 'acres') return num.format(v);
      return r2(v);
    }
    if (name === 'crops' && typeof v === 'string') return v.split(', ').map((g) => g.split('+').map(cropName).join(' + ')).join(', ');
    if (name === 'crop' || name === 'cover') return cropName(v);
    if (name === 'check') return t(`optionsScreen.fit.name.${v}`).toLowerCase();
    return v;
  };
  return function v2t(text) {
    if (!text?.key) return '';
    // The crop map found no crop on this field: say so plainly instead of "names only 0 crops".
    const key = text.key === 'v2.conf.currentRotationGuess' && text.params?.known === 0 ? 'v2.conf.currentRotationNoHistory' : text.key;
    const params = Object.fromEntries(Object.entries(text.params || {}).map(([k, v]) => [k, fmt(k, v, key)]));
    const out = t(key, params);
    return out === key ? t('v2.noText') : out;
  };
}
