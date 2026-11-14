// App settings in one place.
//
// DEMO_FIELD_ID: the field the "Load the demo field" button opens, and the one precached for offline use.
// Change this ONE line to switch demo fields. It must be an id in /shared/fields/index.json
// (e.g. 'ec-251', 'ec-230'). If that file is missing, the app falls back to the fake sample field.
// You can also override it without editing code: VITE_DEMO_FIELD_ID=ec-230 in app/.env.local
// vite.config.js imports DEFAULT_DEMO_FIELD_ID too (to precache that field), so this line is the only place to change.
// ec-251: 100 acres of Houston Black clay, cropped all 18 USDA years (corn, sorghum, cotton, wheat).
export const DEFAULT_DEMO_FIELD_ID = 'ec-251';
export const DEMO_FIELD_ID = import.meta.env?.VITE_DEMO_FIELD_ID || DEFAULT_DEMO_FIELD_ID;
