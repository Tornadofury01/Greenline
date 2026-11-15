// Contract bestPlans (docs/v2-data-contract.md 2.3) -> props for the Best plans screen. Pure, no React.
// The three answers always show in this order; the management choices come from the option each one points to.
import { buildCardFor, FEEDS, slotSet, waitingFor } from './v2Options.js';

export const PLAN_KINDS = ['mostProfitable', 'bestBalance', 'safest'];

// { limits, plans: [{ kind, optionId, why, card, management, hasCover, typicalVsToday, alsoKinds, placeholders }] }.
// A plan whose option is missing from the file is left out (the validator already rejects that, so this is just a guard).
export function buildBestPlans(data) {
  const currentTypical = data.current.profit.returnAboveVariable.typical;
  const plans = [];
  for (const kind of PLAN_KINDS) {
    const bp = data.bestPlans[kind];
    const o = data.options.find((x) => x.id === bp.optionId);
    const card = o && buildCardFor(data, o.id);
    if (!card) continue;
    const ph = slotSet(data, o);
    plans.push({
      kind,
      optionId: o.id,
      why: bp.why,
      card,
      management: o.management || {},
      hasCover: (o.sequence || []).some((y) => y.crops.some((c) => c.role === 'cover')),
      typicalVsToday: card.profit.typical - currentTypical,
      alsoKinds: plans.filter((p) => p.optionId === o.id).map((p) => p.kind), // earlier answers pointing at the same option
      placeholders: [
        { labelKey: 'plansScreen.ph.profit', slots: waitingFor(FEEDS.profit, ph) },
        { labelKey: 'plansScreen.ph.management', slots: waitingFor(FEEDS.management, ph) },
        { labelKey: 'optionsScreen.soilSaved', slots: waitingFor(FEEDS.soilSaved, ph) },
      ].filter((x) => x.slots.length),
    });
  }
  return { limits: data.bestPlans.limits || {}, plans };
}
