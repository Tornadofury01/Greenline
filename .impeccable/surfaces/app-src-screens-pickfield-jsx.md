---
version: 1
slug: "app-src-screens-pickfield-jsx"
primary_target: "app/src/screens/PickField.jsx"
related_targets: ["app/src/components/Header.jsx","app/src/components/BottomNav.jsx"]
---

Scope: the map / pick-a-field screen plus the shared app shell (top bar, bottom tabs). Mode: operate. First of a page-by-page redesign; the user reviews after each page.
Audience: Space Apps judges first, then North Texas farmers and county agents. Job: find a field and open its record. Constraints: PRODUCT.md principles (honest labels, sources one tap away, no GPS stored, advice not instruction), en/es, 44 px taps, 375 px.
User pins: warm light ground, editorial serif display, deep green ink, modelled on moncalisse.com and apc-pallets.nl (craft bar also eloqwnt.com, traced.life, williamsgptech.com). Tailwind + Motion allowed. No generic card grids.

## Direction contract
THESIS: The study area is a county plat book. Each field is a parcel lettered with its number and acres; picking one turns to its plat page. Refuses the category default of a dark satellite map with floating rounded cards and a glowing selection.
OWN-WORLD: Atlas paper (#F3EEE1) with warm black ink, the aerial photo printed onto the paper (greyscale, multiplied), a forest-green shell (#12382B) for primary actions and the active tab, a clerk's highlighter wash (#E9C74A) only on the picked parcel, survey-red dashed county line. Gloock for display lettering, Archivo (wide, tabular figures) for labels and data. Square corners, 1 px ink rules, double neatline around the map sheet. No shadows except the mobile sheet lift.
STORY: The visitor sees 300 real USDA field outlines lettered like an atlas, understands the data is field by field, taps one, reads its record (acres, crop this year, soil, slope with sources), and continues.
FIRST VIEWPORT: Desktop: 64 px paper top bar (wordmark left, tabs, EN/ES right), map sheet fills the left inside a neatline with search top-left, north arrow to Dallas top-right, zoom/frame/key stack bottom-right; a 440 px plat-page column on the right holds the record and the forest Continue button at its foot. Mobile: map full, record as a bottom sheet, paper tab bar.
FORM: candidate 4 of 7 (county plat book), seed:cb225314e87771a8. Raises: tabular figures for every number (from ikeda-datamatics); a changed value holds its mark until seen (from the gate board); one parcel owns the view when picked (from the vertical feed). Signature move: the picked parcel is inked in with a pen-draw outline and highlighter wash while the plat-page title morphs to its number.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
