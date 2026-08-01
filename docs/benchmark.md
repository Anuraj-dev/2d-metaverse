# Opus 5 capability benchmark — Arcade 2.0

> Live benchmark of **Claude Opus 5** as the sole implementer (UI + backend) of the Arcade 2.0
> feature line (spec 27). Maintained by the orchestrator; updated after every dispatch, review
> round, and merge. Requested by Raja 2026-07-25.

## Setup

- **Implementer:** Opus 5 coder subagents for every phase — frontend (canvas renderers, juice,
  overlay UI) AND backend (race relay, plausibility checks, streak/leaderboard REST) — overriding
  the normal "heavy backend → GPT Sol" routing for the duration of this feature line.
- **Reviewer:** GPT Sol (high effort first pass, medium re-reviews) + `@codex review` cloud
  trigger per the active Codex-cloud experiment (2026-07-24 → 2026-07-27 window).
- **What we measure per task:** review rounds to approval, finding counts/severity (P0/P1/P2),
  build/CI failures, escalations or respawns needed, subjective quality of UI output
  (game-feel/polish) and backend design, token/time cost where visible.

## Workload (planned phases)

| Phase | Work | Domain |
|---|---|---|
| 1 | Juice overhaul: Snake rework (speed settings, levels, art) + Flappy/board-panel juice + board sound identity | Frontend/canvas |
| 2 | Merge-drop flagship (space theme: asteroid→…→sun), deterministic physics reducer + renderer | Frontend-heavy + pure logic |
| 3 | Race mode (1–N players, first-to-goal, progress relay) on Snake + Merge-drop | Backend sockets + frontend HUD |
| 4 | Leaderboard meta-layer: weekly reset, daily challenge seed, streaks + plausibility-check score validation | Backend REST/Postgres + HUD |

## Findings log

<!-- One entry per dispatch/review round. Newest last. -->

| Date | Phase / task | Agent run | Review rounds | Findings (sev) | Outcome | Notes on Opus 5 performance |
|---|---|---|---|---|---|---|
| 2026-07-25 | P1 #163 juice + Snake rework + board animations | opus-coder-high, fresh, dispatch 1 (~325k tok, ~50 min) | Sol high round 1: **CHANGES REQUIRED** | 5×P1 + 3×P2 | fix round 1 dispatched (fresh Fable agent, reusing coder's worktree) | Strong first shot: 33 files +2747/−145, 392/392 focused tests, entry bundle **shrank** 124.9→97.7 KB, ASCII-authored levels, honest deviation flags. But ALL 5 P1s live in the renderer/overlay layer (run lifecycle, keyboard capture, settings liveness, async races) — pure-reducer layer came back clean. Pattern: Opus 5 nails pure logic + architecture, under-engineers UI runtime lifecycle. Cloud review found 3 (subset, lower severity). |
| 2026-07-25 | P1 #163 fix round 1 | Fable fix agent (~169k tok, ~21 min, reused coder worktree) | Sol medium round 2 dispatched | 8/8 findings addressed in one commit (`882053d`) | Sol round 2: **CHANGES REQUIRED** — 6/8 resolved; 1×P1 + 2×P2 remain, all in the personal-best rework (POST-before-GET ordering poisons the baseline; race test omits that ordering; late response emits arcade-best post-unmount). Fix round 2 (same Fable agent resumed, ~6 min): request-identity rework in `6e61504` — monotonic reqId + fetch/submit tagging, fetch-only deferred settlement, aliveRef unmount gating; 3 new ordering tests each proven to fail against the prior commit. Sol round 3: **CHANGES REQUIRED** — 1×P1 + 1×P2, still the personal-best cluster (deferred decision not run-generation-aware: restart with run-1 requests pending can settle run 2 against a pre-run-1 baseline; run-1's submit — run 2's correct baseline — wrongly excluded). Two failed fix rounds on the same cluster by the same Fable agent → per process rule 2, escalated to a DIFFERENT model with fresh context: opus-coder-high + SIMPLIFY mandate. Opus fix round 3 (~109k tok, ~10 min): DELETED the fetch/submit axis entirely — PendingBest half-open reqId window `[prev-submit, own-submit)` is the run generation; restart clears the per-run record; stash-verified both new tests fail on the prior commit. Escalation vindicated on mechanics — but Sol round 4: **CHANGES REQUIRED** (2×P1: unversioned `knownBestRef` poisons the immediate path; late-failing prior submit orphans the window; window mechanics themselves confirmed sound). 3 failed fix attempts on one cluster → orchestrator invoked process rule 11 and questioned the architecture: client-side pre-run-baseline inference is unfixable by construction. Round 5 (opus agent resumed): authorized wire change — submit response carries server-atomic `newBest`; the entire client inference machinery (KnownBest/PendingBest/windows) gets deleted. | Fix quality high on driver read-through: submission decoupled from death-freeze presentation, celebration decided only from authoritative data (event-driven, not effect-derived), monotonic run id as React key. 3 sensible documented deviations from reviewer's suggested direction (live prop instead of remount for a11y toggle; callbacks not effects due to React-compiler lint; corrected a pre-existing invalid test fixture the new validation exposed). 86/86 focused tests. |
| 2026-07-25 | P2 #164 merge-drop flagship | opus-coder-high, fresh, dispatch 1 (~239k tok, ~60 min + 1 stall/resume) | Sol high round 1: **CHANGES REQUIRED** | 1×P1 Sol + 1×P1 owner + 2×P2 | fix round 1 done (fresh Fable, ~197k tok, ~27 min): 4 commits — deterministic sweep-and-prune broad phase + baked canvas layers, 5-phase pressure ramp (blind play ends 4.2–5.6 min), pure edge-triggered tapLatch module, campus copy regen; 108/108 focused tests. Sol medium round 2: **CHANGES REQUIRED** — ramp/caching/copy/tap-accounting confirmed sound, but 1×P1 (frozen broad-phase candidate set not a safe superset across relaxation passes — Sol built a concrete 3-body counterexample where a mid-solve correction creates a contact the frozen list never visits, diverging replays) + 1×P2 (key aliases collapse to one boolean; releasing A cancels a held ArrowLeft). Fix round 2 dispatched (same Fable agent resumed; mandate: recollect per pass unless a cumulative-correction bound is provable, solver-equivalence tests vs brute force). | Stalled once at browser-verification loop (watchdog); resumed and finished cleanly. Verlet fixed-timestep physics, 1200-tick determinism proof, honest risk flag on its untested tap latch — which Sol then confirmed buggy (phase-dependent). Sol's P1: O(n²)×7 pair scans/tick + per-frame gradient recreation (no broad phase) = long-session degradation. Owner P1 (Raja play-tested the preview): no difficulty curve, runs never end. Pattern repeats: pure logic + architecture excellent; runtime perf envelope + game-feel tuning not considered. Cloud review on same diff: **zero findings** ("Bravo"). |

## Running impressions

_(updated as evidence accumulates — UI strengths/weaknesses, backend strengths/weaknesses,
comparison against prior Sonnet/Opus-4.8 experience in this repo)_

- Nothing yet.
