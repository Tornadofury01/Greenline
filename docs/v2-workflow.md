# Field Shift v2: two-terminal workflow and prompts

Source plan: `docs/fieldshift-v2.md` (Pranav's "Field Shift v2: Complete Design Plan"). Deadline: Sun Nov 15, 11:59 p.m. Central.

## Key architecture decision: one engine, written once, no server
- The **simulator engine, fit checks, optimizer and scoring are written in JavaScript in `/scoring`** (pure functions, no React/DOM), like today's scoring.
  - The **app** runs it live in the browser: the farm simulator works instantly and offline, no backend.
  - The **pipeline** runs the same code with Node to precompute every field's options, best plans and validation into `/shared`.
  - So the plan's rule "one engine for recommendation and simulator, so they always agree" holds by construction.
- **Python stays for data and trained models** (Earth Engine exports, data cube, Models A–D, Calibration E). Its outputs are JSON parameters per field that the engine reads (crop dates, stress sensitivity, year weights, yield settings).
- **No backend API for the submission.** "Any US field on demand" needs a server and Earth Engine at request time; for the submission, precompute Ellis County (+ the 2–3 extra test counties if they finish). The on-demand version is the "next step" on the project page.

## Who does what
| | Terminal A: app | Terminal B: data + engine |
|---|---|---|
| Folder | `Greenline` | `Greenline-data` (worktree) |
| Branch | `nikkibranch` (UI), then `v2-app` | `v2-engine` |
| Touches | `/app`, `/content/i18n` | `/pipeline`, `/scoring`, `/shared`, `/content/crops*.json`, `/docs` |
| Never touches | `/pipeline`, `/scoring` internals | `/app` screens |

Tell Pranav which parts you're taking so nobody builds the same thing twice.

## The contract (the handshake between terminals)
Terminal B writes `docs/v2-data-contract.md` and `shared/v2-sample/ec-251.json` **first** (step B0). Terminal A builds screens against that sample while B fills in real data. When B merges real data, the screens just work.

## Order and checkpoints
1. **A0 + B0 (start now, in parallel):** A finishes the UI; B saves the plan, writes the contract and sample, and starts the slow Earth Engine exports.
2. **B1–B5 (B, in order):** data cube → crop library + engine → models → options/fit checks/optimizer → validation + precompute.
3. **A1–A5 (A, in order):** Options screen → Best plans → Farm simulator → Field risks → Evidence/report.
4. **Merge:** B merges `v2-engine` → main; A pulls main into `v2-app`, swaps sample data for real, merges → main.
5. **Deploy and verify:** A deploys and checks the live site in incognito.

Safety rules:
- Tag the current submittable main as `v1.2-submittable` before any v2 merge, and keep it deployable.
- Every step ends with tests passing, a commit and a push.
- Cut order if time runs short (from the plan): Model D → multi-region test (keep 2–3 counties) → on-demand fields. Never cut: engine, fit checks, Ellis County validation.
- Never submit a claim the app doesn't do.
