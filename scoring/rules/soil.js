// IMPROVE SOIL: points for nitrogen-fixers, cover crops, deep roots and variety.
import { clamp, reason } from './helpers.js';

export function soilRule(crops) {
  const nFixers = crops.filter((c) => c.nitrogenFixing).length;
  const covers = crops.filter((c) => c.coverCrop).length;
  const deep = crops.filter((c) => c.rootDepth === 'deep').length;
  const unique = new Set(crops.map((c) => c.id)).size;

  const score = clamp(nFixers * 2 + covers * 1.5 + deep * 0.5 + (unique - 1));
  const reasons = [];
  if (nFixers) reasons.push(reason('reasons.nitrogen', { count: nFixers }));
  if (covers) reasons.push(reason('reasons.cover', { count: covers }));
  reasons.push(reason('reasons.variety', { count: unique }));
  return { score, reasons };
}
