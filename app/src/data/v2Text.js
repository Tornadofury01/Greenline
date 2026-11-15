// Turns a contract text ({ key, params }) into a sentence. The contract sends plain numbers and ids; this formats them
// (shares as %, dollars, acres, crop ids to crop names) so the i18n strings stay simple. Unknown keys show a neutral line.
export function makeV2Text(t, lang) {
  const money = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const num = new Intl.NumberFormat(lang);
  const cropName = (id) => { const k = `crops.${id}`; const v = t(k); return v === k ? id : v; };
  const SHARES = new Set(['shortYears', 'share', 'chance', 'beatsShare', 'risk', 'probability']);
  const MONEY = new Set(['usd', 'diffUsd']);
  const fmt = (name, v) => {
    if (typeof v === 'number') {
      if (SHARES.has(name)) return String(Math.round(v * 100));
      if (MONEY.has(name)) return money.format(v);
      if (name === 'acres') return num.format(v);
      return v;
    }
    if (name === 'crops' && typeof v === 'string') return v.split(', ').map((g) => g.split('+').map(cropName).join(' + ')).join(', ');
    if (name === 'crop' || name === 'cover') return cropName(v);
    if (name === 'check') return t(`optionsScreen.fit.name.${v}`).toLowerCase();
    return v;
  };
  return function v2t(text) {
    if (!text?.key) return '';
    const params = Object.fromEntries(Object.entries(text.params || {}).map(([k, v]) => [k, fmt(k, v)]));
    const out = t(text.key, params);
    return out === text.key ? t('v2.noText') : out;
  };
}
