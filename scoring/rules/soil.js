// IMPROVE SOIL: points for nitrogen-fixers, cover crops, deep roots and variety.
// Real field conditions: low topsoil organic matter (SSURGO < 2%) gives rotations with cover crops or
// legumes one extra point, because that is where they help most.
import { clamp, reason } from './helpers.js';

export function soilRule(crops, field) {
  const nFixers = crops.filter((c) => c.nitrogenFixing).length;
  const covers = crops.filter((c) => c.coverCrop).length;
  const deep = crops.filter((c) => c.rootDepth === 'deep').length;
  const unique = new Set(crops.map((c) => c.id)).size;
  const om = field?.soil?.organicMatterPct;
  const lowOm = om != null && om < 2;

  const score = clamp(nFixers * 2 + covers * 1.5 + deep * 0.5 + (unique - 1) + (lowOm && (nFixers || covers) ? 1 : 0));
  const reasons = [];
  if (nFixers) reasons.push(reason('reasons.nitrogen', { count: nFixers }));
  if (covers) reasons.push(reason('reasons.cover', { count: covers }));
  reasons.push(reason('reasons.variety', { count: unique }));
  if (lowOm) reasons.push(reason('reasons.lowOrganicMatter', { om }, ['USDA SSURGO']));
  return { score, reasons };
}
