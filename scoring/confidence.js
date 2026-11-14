// CONFIDENCE: how much should the farmer trust this score?
// Based on how much field data we have and how familiar the crops are on this field.
import { reason } from './rules/helpers.js';

export function confidenceFor(crops, field, cropLibraryVerified) {
  let points = 0;
  const reasons = [];

  const climateYears = field.climateYearly.length;
  if (climateYears >= 15) { points++; reasons.push(reason('confidence.longClimate', { count: climateYears })); }
  else reasons.push(reason('confidence.shortClimate', { count: climateYears }));

  const histYears = field.cropHistory.length;
  if (histYears >= 8) { points++; reasons.push(reason('confidence.goodHistory', { count: histYears })); }

  const grown = new Set(field.cropHistory.map((h) => h.crop));
  const growing = crops.filter((c) => c.id !== 'fallow');
  const newShare = growing.filter((c) => !grown.has(c.id)).length / Math.max(1, growing.length);
  if (newShare <= 0.34) { points++; reasons.push(reason('confidence.familiarCrops')); }
  else if (newShare > 0.66) { points--; reasons.push(reason('confidence.newCrops')); }
  else reasons.push(reason('confidence.someNewCrops'));

  if (!cropLibraryVerified) reasons.push(reason('confidence.placeholderTraits'));

  const level = points >= 3 ? 'high' : points >= 2 ? 'medium' : 'low';
  return { level, reasons };
}
