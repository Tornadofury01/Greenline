# Merged Plans page

Local preview: http://localhost:5173/?field=ec-251&screen=plans

## Behavior

- Uses the exact `bestPlans.bestBalance.optionId` from the selected field's v2 file.
- The lead shows ordered rotation years, annual return per acre after variable costs, the supported low–high range and a v2 reason tied to a selected Farm priority (or a passing field-fit check).
- The compact comparison contains the saved current USDA baseline, Best match and one different eligible crop cycle. Recommendation names that overlap do not produce duplicate alternative cards.
- Alternatives must pass all fit checks, satisfy the stored soil/risk limits and differ from both the current and recommended crop cycles. Rotating the start year of an otherwise identical cycle does not qualify.
- Uses the existing Compare `.rot`, `.rot-main`, `.tile`, `.steps`, `.rot-toggle` and `.rot-details` presentation and current theme tokens.
- Management, full scores/reasons, field fit, confidence and placeholder-slot details are collapsed by default.
- Explore more links to the existing Simulator for custom rotations and weather scenarios. Simulator is otherwise unchanged.
- Return values are never taken from the legacy gross-revenue model. Fixed costs are not deducted from these values. Placeholder yields and simulated water/cover inputs remain labelled beside the numbers.
- Farm choices remain in memory during navigation. The page explicitly states that changing them does not recalculate the saved v2 analysis; the current comparison card identifies its USDA crop-history baseline.
- Options now lists every stored v2 option (28 for ec-251), rather than only the top three. Option labels continue through AA, AB, etc.; the dollar range supports negative values.

## Navigation

- Removed the Compare tab from desktop and mobile More navigation.
- Farm results and History's weather entry open Plans.
- Existing `setScreen('compare')` calls normalize to Plans without resetting field or farm state.
- `CompareRotations.jsx` re-exports Plans as a compatibility entry.
- Deep links support `?field=ec-251&screen=plans` and the old `screen=compare`.
- Help return labels include Plans.

## Verification

- Opened and captured both original screens locally before editing.
- Chromium layout/interaction checks: ec-000 (all three named recommendations distinct) and ec-003 (all three names overlap), at 1440 px and 375 px, English and Spanish, light and dark: 16 cases.
- Confirmed recommendation, exact v2 return and reason are visible before details; no horizontal scrolling, no separate Compare tab, and no legacy gross revenue on Plans.
- Opened/closed management and score details for Current and Alternative, and verified the compact Best match opens the lead's single details section.
- Checked Explore more, both Simulator links, legacy Compare URL, Farm results, help return and History's 2011 weather entry. Confirmed selected field, rotation, tillage and irrigation choices survive navigation.
- Keyboard Enter toggles native details. Recommendation/reason fit above the floating nav at 375 × 812.
- Checked all 28 ec-251 Options render, with the final option labelled AB.
- No browser page errors in the completed checks.
- `npm run selftest`: passed.
- `npm run i18n`: passed, 1,324 matching keys.
- `node scripts/check-merged-plans.mjs`: passed across 300 fields, including 85 with distinct recommendation names, 215 with overlap, and 31 requiring the distinct eligible fallback. All 300 have an eligible alternative. Includes unsupported-return and absent-alternative guards.
- `npm run build`: passed; the existing large JavaScript chunk warning remains.

Test source: `app/scripts/check-merged-plans.mjs`. Browser screenshots and test scripts are in the system temporary directory (`greenline-ui-qa`, `plans-ec-003-*.png`), outside the checkout.

All changes are local. No commit, push, deploy, scoring-rule change, model change or stash operation was performed. Existing uncommitted documents and satellite prototype assets were verified byte-for-byte against a pre-edit local backup.
