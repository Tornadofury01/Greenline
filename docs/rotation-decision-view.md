# Rotation decision view

Preview: http://localhost:5173/?field=ec-251&screen=plans

This pass refines the earlier local Plans/Compare merge. It uses the original Compare `.rot`, `.rot-main`, `.tile`, `.steps`, `.rot-toggle`, and `.rot-details` presentation. The old screen was inspected with `git show HEAD:app/src/screens/CompareRotations.jsx` without switching branches or reverting files. Current Plans and Options were also opened locally before editing.

## Default experience

- One set of decision cards: Best match, Current rotation, and a second distinct eligible rotation. There is no separate repeated lead card.
- Best match appears first on phones. Desktop shows Current / Best match / alternative side by side, with aligned return figures.
- Cards show ordered crop sequences, v2 annual return per acre after variable costs, supported ranges, one reason/tradeoff, and comparable water or bare-ground metrics when those metrics vary.
- The second alternative is labelled Higher estimated return, Stronger in bad seasons, Fewer bare days, or Fewer water-short seasons only when the stored values support that distinction from Best match. Otherwise it has a neutral eligible-alternative label.
- Placeholder yields, simulated water/cover, fixed-cost exclusions and management assumptions remain beside the headline values.
- View details contains the rationale, supporting v2 reasons and source names, tradeoffs, management, six score values, fit checks, confidence, placeholder dependencies, and local checks.
- The long rotation list is closed by default behind Browse all rotations. Its cards also keep technical detail collapsed.

## Existing data and priorities

`app/src/data/mergedPlans.js` calls the existing pure v2 `pickBestPlans` and `weightsFor` helpers on saved scores. Water maps to saveWater, erosion/soil to soil, and income to income. Duplicate mapped priorities are counted once. Existing single-priority precomputed selections are retained when eligible. No yields or financial simulations are rerun.

Only options satisfying stored soil/risk limits and all fit checks can be recommended. Dryland choices additionally exclude irrigation. Budget, equipment and buyers still require local confirmation; the saved contract does not support pretending those farm edits caused a fresh simulation. Cattle-feed value is not scored and is disclosed if that goal is selected.

Cyclic shifts, repeated copies of a cycle, and different management for the same crop cycle do not create duplicate rotation cards. When two eligible alternatives are unavailable, the page shows what is available and explains the gap. The secondary browser may show ineligible choices with a warning.

All headline returns come from `profit.returnAboveVariable`, in `usd/acre/year`. No v1 gross revenue is used. Unsupported units and invalid ranges are suppressed.

No scoring files, model files, shared data, precompute outputs, or data contracts were changed. There was therefore no data contract change to coordinate with the other terminal.

## Navigation and Simulator

Options and Compare tabs are removed. Legacy Options entry points open Browse all rotations within Plans. Compare entry points and Farm results open the decision cards. Field and farm state are preserved. The main Plans entry starts with Browse closed.

Exact suggested-plan handoff to Simulator is **not wired up**. Simulator initializes its own field baseline and management. No card is given a misleading Try in Simulator action. Explore more explicitly explains this and offers an accurately labelled baseline Simulator link. Simulator itself is unchanged.

## Verification

- All 300 field files checked, with original default recommendations and three mapped priority profiles (water + soil, income, soil). The UI selection matches the existing v2 picker, returns match the stored option, alternatives are eligible/distinct, and input data is not mutated.
- Existing files: 85 have distinct named recommendations, 215 have overlap, and 31 need the fallback alternative. All 300 provide two eligible alternatives for the tested default farm setup.
- Guards passed for absent alternatives, irrigation on dryland, cyclic shifts, repeated cycles, negative returns, invalid return units, and invalid ranges.
- Browser: ec-000 (distinct recommendation case) and ec-003 (overlap case), at 1440 and 375 px, English/Spanish, light/dark: 16 cases passed with no page errors.
- Verified headline return against the exact stored option; crops and reason are visible before details; phone recommendation/reason fit above the floating nav at 375 × 812; desktop return tiles align; no horizontal scroll before or after opening details.
- Verified evidence/local-check content, native keyboard details, Browse opening/closing and all stored rotations appearing, legacy Options/Compare URLs, Farm results, help return, and an actual priority change selecting the stored soil-priority recommendation.
- Verified selected field, crop sequence, tillage and budget choices survive navigation.
- Selftest passed. i18n passed (1,359 matching keys). Production build passed with the existing large JavaScript chunk warning.
- Original unrelated edited/untracked files were compared with a pre-pass zip: 32 files preserved byte-for-byte. Existing stashes are retained.

Checks: `node scripts/check-merged-plans.mjs` from `app/`. Browser scripts/screenshots are in the system temporary directory (`decision-verify.cjs`, `decision-ec-*.png`). All changes remain local; no commit, push or deployment.
