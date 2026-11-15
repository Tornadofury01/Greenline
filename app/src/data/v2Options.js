// Contract (docs/v2-data-contract.md 2.2) -> props for the Options screen. Pure, no React.
// Score names, order, weights and the grade cut-offs come ONLY from content/v2-scores.json.
import scoresConfig from '@content/v2-scores.json';

export const TOP_OPTIONS = 3;
const LETTERS = 'ABCDEFGHIJ';

// Which model slots feed each number on screen (docs/v2-data-contract.md section 1, "Feeds"). A number is tagged
// a placeholder when ANY slot that feeds it was a placeholder when the option was run. The card shows ONE tag; tapping it
// lists these numbers and the slots they wait for (`placeholders` below).
// The market check feeds on NASS county data, not on a model slot, so it is never tagged.
export const FEEDS = {
  score: { profit: ['calibrationE', 'modelB'], risk: ['modelB', 'modelC'], soil: ['modelA'], water: ['modelB', 'modelD'], nutrients: ['calibrationE'], pests: ['modelA'] },
  fit: { water: ['modelB', 'modelD'], disease: ['modelA', 'modelC'], market: [], season: ['modelA', 'modelC'] },
  profit: ['calibrationE', 'modelB'],
  soilSaved: ['modelA'],
  nitrogenSaved: ['calibrationE'],
  // Best plans: the management choices come from the optimizer's simulated yields.
  management: ['calibrationE', 'modelB'],
  // Field risks: which slot feeds each card.
  risk: { stress: ['modelB'], erosion: ['modelA'], climate: ['modelC'] },
};

// Weighted total (0-100) -> letter, using the cut-offs in v2-scores.json (highest cut-off first).
export function gradeFor(total, cfg = scoresConfig) {
  const cuts = Object.entries(cfg.grades).filter(([k]) => !k.startsWith('_')).sort((a, b) => b[1] - a[1]);
  return (cuts.find(([, min]) => total >= min) || cuts.at(-1))[0];
}

// Weighted total from the six scores and weights (used only when the file leaves weightedTotal out).
export function totalFrom(scores, weights) {
  return Math.round(scoresConfig.scores.reduce((a, s) => a + (scores[s.id]?.value ?? 0) * (weights[s.id] ?? s.weight), 0));
}

export const slotSet = (data, o) => new Set(o?.placeholderSlots ?? data.slots.placeholderSlots);
export const isPlaceholder = (feeds, placeholderSlots) => feeds.some((s) => placeholderSlots.has(s));
// The slots (in contract order) that a number is still waiting for.
export const waitingFor = (feeds, placeholderSlots) => feeds.filter((s) => placeholderSlots.has(s));

function card(o, data, i, currentTotal, bestId) {
  const ph = new Set(o.placeholderSlots ?? data.slots.placeholderSlots);
  const weights = data.priorities.weights;
  const total = o.weightedTotal ?? totalFrom(o.scores, weights);
  const isCurrent = o.kind === 'current';
  return {
    id: o.id,
    kind: isCurrent ? 'current' : 'option',
    letter: isCurrent ? null : LETTERS[i],
    best: !isCurrent && o.id === bestId,
    steps: (o.sequence || []).map((y) => y.crops.map((c) => c.crop)), // one entry per rotation year; co-crops together
    total,
    grade: gradeFor(total),
    deltaTotal: isCurrent ? null : total - currentTotal,
    scores: scoresConfig.scores.map((s) => ({
      id: s.id, nameKey: s.nameKey, value: o.scores[s.id].value,
      placeholder: isPlaceholder(FEEDS.score[s.id] ?? [], ph),
    })),
    fit: ['water', 'disease', 'market', 'season'].map((id) => ({
      id, status: o.fitChecks[id].status, evidence: o.fitChecks[id].evidence,
      placeholder: isPlaceholder(FEEDS.fit[id], ph),
    })),
    profit: {
      low: o.profit.returnAboveVariable.low, typical: o.profit.returnAboveVariable.typical, high: o.profit.returnAboveVariable.high,
      beatsCurrent: isCurrent ? null : o.profit.chanceBeatsCurrent ?? null,
      placeholder: isPlaceholder(FEEDS.profit, ph),
    },
    soilSaved: o.soilSaved?.savedVsCurrentTonsPerAcreYear == null ? null
      : { value: o.soilSaved.savedVsCurrentTonsPerAcreYear, placeholder: isPlaceholder(FEEDS.soilSaved, ph) },
    nitrogenSaved: o.nitrogenSaved?.savedVsCurrentLb == null ? null
      : { value: o.nitrogenSaved.savedVsCurrentLb, placeholder: isPlaceholder(FEEDS.nitrogenSaved, ph) },
    // Every number on this card that rests on a placeholder: { labelKey, slots[] }.
    placeholders: [
      ...scoresConfig.scores.map((s) => ({ labelKey: s.nameKey, slots: waitingFor(FEEDS.score[s.id] ?? [], ph) })),
      ...['water', 'disease', 'market', 'season'].map((id) => ({ labelKey: 'optionsScreen.checkOf', nameKey: `optionsScreen.fit.name.${id}`, slots: waitingFor(FEEDS.fit[id], ph) })),
      { labelKey: 'optionsScreen.profitLabel', slots: waitingFor(FEEDS.profit, ph) },
      ...(isCurrent ? [] : [
        { labelKey: 'optionsScreen.soilSaved', slots: waitingFor(FEEDS.soilSaved, ph) },
        { labelKey: 'optionsScreen.nitrogenSaved', slots: waitingFor(FEEDS.nitrogenSaved, ph) },
      ]),
    ].filter((x) => x.slots.length),
    // Held at medium while any model slot is a placeholder, even if a file says "high". A guess about the current
    // rotation goes first so it is never cut off the card face.
    confidence: {
      level: o.confidence.level === 'high' && ph.size ? 'medium' : o.confidence.level,
      capped: ph.size > 0,
      reasons: [...(o.confidence.reasons || [])].sort((a, b) => (b.key === 'v2.conf.currentRotationGuess') - (a.key === 'v2.conf.currentRotationGuess')),
    },
    checkLocally: o.checkLocally || [],
    neighbors: o.neighbors || null,
  };
}

// { current, options, goals } for the screen. Options are the TOP_OPTIONS by weighted total.
export function buildOptionCards(data) {
  const weights = data.priorities.weights;
  const totalOf = (o) => o.weightedTotal ?? totalFrom(o.scores, weights);
  const currentTotal = totalOf(data.current);
  const top = [...data.options].sort((a, b) => totalOf(b) - totalOf(a)).slice(0, TOP_OPTIONS);
  // "Best match" = the file's best balance, if it is among the options shown and beats today; else none.
  const bb = data.bestPlans?.bestBalance?.optionId;
  const bestId = top.find((o) => o.id === bb && totalOf(o) > currentTotal)?.id ?? null;
  return {
    current: card(data.current, data, 0, currentTotal, null),
    options: top.map((o, i) => card(o, data, i, currentTotal, bestId)),
    goals: (data.priorities.selected || []).map((p) => scoresConfig.priorities[p]?.nameKey).filter(Boolean),
  };
}

// One option as a card, looked up by id (used by Best plans). null when the id is not in the file.
export function buildCardFor(data, optionId) {
  const o = data.options.find((x) => x.id === optionId);
  if (!o) return null;
  const weights = data.priorities.weights;
  const totalOf = (x) => x.weightedTotal ?? totalFrom(x.scores, weights);
  return card(o, data, 0, totalOf(data.current), null);
}
