# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary audience for design decisions (confirmed Nov 15 2026): **NASA Space Apps judges** seeing the app for the first time on desktop and phone. The design must make a strong first impression while still reading as a real tool.
End users the app is built for: dryland farmers in North Texas comparing crop rotations for a field, and the county extension agents who advise them. English and Spanish (formal *usted*).

## Product Purpose
Greenline is a mobile-first PWA for the Space Apps challenge "Field Shift: Adapting Farms with NASA Data". A farmer picks a field on a map; the app shows how that field has behaved (bare soil, drought years, soil water) from NASA and USDA Earth observation data, and scores rotation options for water, soil and drought risk. Success: a farmer or agent can see, in plain language, which rotation keeps the field covered and holds up in a bad year, and why.

## Positioning
Field-level evidence from real satellite and soil records (Landsat 8/9, NASA POWER, IMERG, SMAP, SRTM, SSURGO, CDL, PRISM) for real USDA field outlines, with every number traceable to a dataset receipt. It supports farmer judgment and local experts; it does not replace them.

## Operating Context
Opened from a public link (https://greenline-psi.vercel.app), no login, no backend. Works offline after first load. Used outdoors on phones and in demos on laptops. A handoff sheet prints for the county agent.

## Capabilities and Constraints
- Vite + React (JS), Leaflet, Recharts, vite-plugin-pwa. Static JSON data only.
- All user-facing text in `content/i18n/en.json` and `es.json`.
- Tap targets ≥ 44 px, plain language, works at 375 px.
- Raw GPS and typed addresses are never stored or sent (only the free Census geocoder sees typed text).

## Brand Commitments
Name: Greenline. Voice: plain, modest, specific; numbers come with their source.

## Evidence on Hand
Real per-field data for the study fields (`shared/fields/`, `shared/v2/`), field outlines, map layers, model results (`pipeline/MODELS.md`). No testimonials, users, or partner endorsements exist; do not invent any.

## Product Principles
1. Honest labels stay visible: "placeholder, model coming", "sample data for testing", low-confidence older-satellite years.
2. Uncertainty and sources are one tap away from every number (confidence, receipts, "How we know").
3. Privacy is a visible promise next to location tools: no GPS stored or sent.
4. The app advises, the farmer and county agent decide. No language that reads as instruction or guarantee.

## Accessibility & Inclusion
Bilingual en/es; readable outdoors (contrast); 44 px taps; no text under 12 px.
