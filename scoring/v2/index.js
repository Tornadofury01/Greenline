// Public entry of the v2 option builder (pure JS; the app and Node import the same files).
export { analyzeField, pickBestPlans } from './analyzeField.js';
export { weightsFor, weightedTotal, gradeOf, scoreOption } from './scores.js';
export { materialize, DEFAULT_CHOICES } from './plans.js';
export { buildReportCard } from './reportCard.js';
export * as V2 from './constants.js';
