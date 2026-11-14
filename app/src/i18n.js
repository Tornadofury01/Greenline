// All user-facing text comes from /content/i18n. Never hardcode strings in components.
import en from '@content/i18n/en.json';
import es from '@content/i18n/es.json';

export const LANGUAGES = { en, es };

function lookup(dict, key) {
  return key.split('.').reduce((obj, part) => (obj == null ? undefined : obj[part]), dict);
}

// t('reasons.waterAvg', { value: 2.5 }) -> "Average water need is 2.5 out of 5."
// Falls back to English, then to the key itself so missing text is easy to spot.
export function makeT(lang) {
  const dict = LANGUAGES[lang] || en;
  return function t(key, params = {}) {
    let value = lookup(dict, key);
    if (value === undefined) value = lookup(en, key);
    if (value === undefined) return key;
    if (typeof value !== 'string') return value; // arrays/objects (e.g. month letters)
    return value.replace(/\{(\w+)\}/g, (_, name) => (params[name] ?? `{${name}}`));
  };
}

// Turn a scoring reason ({ key, params }) into a sentence. Params holding crop ids,
// equipment ids or a priority id are translated before being inserted.
export function formatReason(t, { key, params = {} }) {
  const p = { ...params };
  if (Array.isArray(p.crops)) p.crops = p.crops.map((id) => t(`crops.${id}`)).join(', ');
  if (Array.isArray(p.needs)) p.needs = p.needs.map((id) => t(`options.equipment.${id}`)).join(' / ');
  if (p.priority) p.priority = t(`priorities.${p.priority}`);
  return t(key, p);
}

// Dataset descriptions in field.sources[] are English data strings. Show them in the reader's language:
// `variable` by source id (i18n sources.var.<id>), plus the few word-only resolutions and "current".
// Unknown ids / values fall back to the raw text from the file.
const RES_KEYS = { 'per field': 'perField', 'county / state': 'countyState', state: 'state', 'map unit (1:24,000)': 'mapUnit' };
export function sourceText(t, s) {
  const tr = (key, fallback) => { const v = t(key); return v === key ? fallback : v; };
  return {
    variable: s.id ? tr(`sources.var.${s.id}`, s.variable) : s.variable,
    resolution: RES_KEYS[s.resolution] ? t(`sources.res.${RES_KEYS[s.resolution]}`) : s.resolution,
    dates: s.dateRange === 'current' ? t('sources.current') : String(s.dateRange).replace('-', '–'),
  };
}
