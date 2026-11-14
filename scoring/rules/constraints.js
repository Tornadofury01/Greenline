// CONSTRAINTS: penalties (points off the 0-100 total) and the gaps/risks they create.
import { reason, isThirsty } from './helpers.js';

export function constraintRule(rotation, crops, constraints = {}) {
  let penalty = 0;
  const gaps = [];
  const risks = [];

  // Dryland farms: thirsty crops are risky.
  if (constraints.water === 'dryland') {
    const thirsty = crops.filter(isThirsty);
    if (thirsty.length) {
      penalty += 8 * thirsty.length;
      risks.push(reason('risks.thirstyDryland', { crops: [...new Set(thirsty.map((c) => c.id))] }));
    }
  }

  // Equipment: the rotation lists what it needs; the farmer lists what they have.
  const have = constraints.equipment || [];
  if (rotation.equipment?.length && have.length && !rotation.equipment.some((e) => have.includes(e))) {
    penalty += 10;
    gaps.push(reason('gaps.equipment', { needs: rotation.equipment }));
  }

  // Low budget: many different crops means many seed purchases and new skills.
  const unique = new Set(crops.map((c) => c.id)).size;
  if (constraints.budget === 'low' && unique > 3) {
    penalty += 5;
    gaps.push(reason('gaps.budgetVariety', { count: unique }));
  }
  return { penalty, gaps, risks };
}
