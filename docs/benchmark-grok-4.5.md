# grok-4.5 capability benchmark — campus art restyle

> Live benchmark of **grok-4.5** (via the `grok` CLI, headless) as the sole implementer of the
> campus-wide art restyle. Requested by Raja 2026-08-01 ("spawn as much grok-4.5 agents as possible…
> benchmark them"). Orchestration, integration, verification and final judgement by Claude (driver);
> final code review by Opus 5 high.

## Setup

- **Implementer:** grok-4.5, headless CLI, `--permission-mode bypassPermissions`, one agent per file.
- **Reviewer:** Opus 5 (high) — Codex was at 100% usage and unavailable for this run.
- **Task shape:** unusually well-suited to fan-out. The work decomposes into N independent areas of a
  map that share no logic, only a coordinate space. A plug-in seam (`scripts/campus_decor/`) was built
  first so that one district = one file = one owner, with zero shared-file contention.
- **What we measure:** wall-clock per agent, first-pass correctness against the repo's authoritative
  guard, ability to self-correct given a precise failure list, ability to act on *subjective* art
  critique, and how much driver intervention was needed.

## Workload

| Wave | Agents | Job |
|---|---|---|
| 0 | 3 (+1 re-dispatch) | Shared foundations: sprite library 17→102, plug-in seam, offline render harness, prop catalog |
| 1 | 8 | One district art pass each — HQ hall, HQ rooms 4-6, hostel rooms 1-2, auditorium, arcade, cafe, coworking, plaza+park |
| 2 | 5 | Fix the 79 geometry violations the repo's map guard rejected |
| 3 | 2 | Act on the driver's *visual* critique (plaza composition, arcade emptiness) |
| 4 | 2 | Fix what the Opus 5 review found (E2E door corridors, auditorium seat pitch) |

**21 grok agent runs total.**

## Timings (wall-clock, parallel)

| Wave | Per-agent | Wave wall-clock |
|---|---|---|
| 1 | 412 / 413 / 458 / 461 / 468 / 478 / 481 / 559 s | **9 min 19 s** for all 8 |
| 2 | 34 / 107 / 121 / 135 / 155 s | **2 min 35 s** for all 5 |
| 3 | 211 / 363 s | **6 min 03 s** for both |
| 4 | 166 / 131 s | run sequentially |

Every run exited 0. No agent hung, crashed, or needed a respawn. Total grok wall-clock across all
five waves: **under 23 minutes** for what is a 104-file, +2653-line change.

## Result

| | Before | After |
|---|---|---|
| Furniture objects | 174 | **858** |
| Distinct sprites | ~12 (45% one chair) | **81** |
| Districts furnished | 1 (proof) | **9** |

Per-district after the review round (props / solid): plaza+park 191/150 · coworking 140/125 · HQ hall 123/67 ·
auditorium 98/72 · cafe 96/84 · arcade 71/16 · hostel 1-2 42/28 · HQ rooms 4-6 37/22 ·
hostel room 3 25/21 (the pre-existing Opus proof, untouched).

Frozen geometry preserved exactly: 37 seats, 6 doorZones, 6 roomBounds, 5 interactables,
4 board seats, 2 stage zones, 1 portal, spawn (60,44).

## Findings log

| Date | Wave / task | Run | Outcome | Notes on grok-4.5 performance |
|---|---|---|---|---|
| 2026-08-01 | W0 foundations | 3 agents, foreground | 2/3 complete; 1 killed by the tool's 10-min cap (exit 143) after producing 102 sprites + BootScene keys but before its catalog | Not a model failure — an orchestration mistake (foreground launch). Re-dispatched the missing catalog work alone; it completed. All later waves ran backgrounded. |
| 2026-08-01 | W1 eight districts | 8 agents, ~9 min | All 8 produced working, registered, coherent modules | **Strong on the creative half, weak on the adversarial half.** Every agent followed the locked art direction (LimeZu language, cream base, small accents), avoided the documented failure mode (room 3's oversized saturated rug), and iterated 5-8 render passes instead of handing back a first draft — the brief asked for that and they actually did it. Reports were honest and specific: several flagged bad sprites by name (`f_lz_floor_lamp_blue` reads as a bar stool, `f_lz_bin` reads as a headstone) and pushed back on the brief where it was wrong. |
| 2026-08-01 | W1 verification gap | — | **5 of 8 districts failed the repo's authoritative map guard: 79 violating props.** 3 clean (cafe, coworking, HQ rooms 4-6) | The headline weakness. Each agent wrote its *own* approximation of the collision-body rule and validated against that, rather than against the real one — so each was confident and wrong in its own way. Breakdown: 35 HQ hall, 26 plaza, 9 auditorium, 7 hostel 1-2, 2 arcade. Categories: solid bodies overlapping (chairs tucked under tables), bodies spilling onto stone path arteries, one on a seat tile, one over the agenda whiteboard prompt. **They were forbidden from running vitest (hard machine rule), which is a real constraint of this setup, not an excuse — but it means self-verification quality depended entirely on how good a checker each agent invented.** |
| 2026-08-01 | W2 fix round | 5 agents, ~2.5 min | **79 → 0 violations, one round, no re-dispatch** | Excellent once given (a) the exact violation list and (b) a checker that encodes the authoritative rule. Notably they fixed it *the right way*: 26 props were switched to `solid=False` rather than deleted, so prop count held at 798 and the density survived. Deleting props would have been the lazy pass. |
| 2026-08-01 | W2 escape | — | 1 defect survived: a plaza palm overlapping a legacy `f_plant_big` from `gen_campus` itself | Genuinely outside the per-district checker's visibility (cross-owner collision). Driver fixed it in one line. Cost of the parallel design, not a model failure. |
| 2026-08-01 | W4 review fixes | 2 agents, 166 s + 131 s | Both passed their gates first time | Post-review round. The E2E-corridor fix (P0) is the notable one: given the exact blocked corridors plus a runnable `sweep.py` oracle, the agent cleared all five legs in 166 s **without losing a single prop** (123 before, 123 after) — it moved and re-composed rather than deleting. Same pattern as W2: precise failure list + executable check = one-round fix. |
| 2026-08-01 | W3 art critique | 2 agents, ~6 min | Both acted correctly on subjective feedback | The interesting result. Given prose critique — "a purple living-room sofa on open stone reads as a bug"; "the east half is a uniform sprinkle of three props, it reads as litter not design"; "the arcade centre is a void" — both produced targeted, well-reasoned fixes. Plaza agent removed all indoor upholstery/appliance props from open paving and rebuilt the space as 16 named "places" (rest stops, notice-board corner, market nook, lamp promenade). Arcade agent doubled density to 71 props and, crucially, understood the technique it had been missing: non-solid props carry no collision, so the room centre could be filled safely. |

## Running impressions

**Where grok-4.5 was strong**

- **Instruction adherence under unsupervised parallel execution.** 21 runs, zero violations of the
  hard rules: no agent ran `git`, none ran a build or test suite, none touched a file it did not own,
  none added AI credits, none committed a raw asset pack. For overnight autonomous work this matters
  more than raw code quality.
- **Taste, when the direction is locked for it.** The art direction held across 8 independently-run
  agents with no cross-talk. Nobody invented a new visual language or blended in the deprecated
  furniture family. The districts look like one campus.
- **Honest reporting.** Reports were compact and self-critical, with real "what I deliberately did not
  do and why" sections. Several correctly identified that an apparently-empty area was empty *by
  constraint* (walkable arteries, spawn radius) rather than under-decorated — and said so instead of
  padding the space to look busy.
- **Acting on subjective critique.** Wave 3 is the strongest evidence: it converted prose art
  criticism into correct concrete changes, first try, both agents.
- **Speed.** ~23 minutes of grok wall-clock for the whole restyle, review fixes included.

**Where grok-4.5 was weak**

- **Self-verification is the failure mode.** 5 of 8 first-pass districts shipped geometry violations.
  The pattern is consistent and worth generalising: *grok-4.5 will confidently build and trust its own
  approximation of a rule rather than seek out the authoritative one.* All 79 violations came from
  hand-rolled body-collision math that was subtly wrong in 5 different ways.
- **The fix is cheap and total.** Hand it the real check as a runnable command and it goes to zero in
  one round, in minutes. **Operational conclusion: never let a grok fan-out self-certify. Give every
  agent an executable oracle, or plan on a mandatory fix wave.** The oracle is worth more than a
  better prompt.
- **No cross-agent awareness**, by construction. Parallel agents cannot see each other's collisions.
  Any shared-resource conflict has to be caught centrally.
- **It optimises for the check you give it, not the contract you meant.** The Opus 5 review's P0 is
  the clean example: every agent satisfied *connectivity* (the map stays one walkable component,
  which is what my checker measured) while breaking the *straight-line waypoint* contract the E2E
  suite actually depends on. No agent went looking for `e2e/helpers.ts` to find out what else
  constrained the space, even though `AGENTS.md` names that obligation. Assume a grok agent will
  satisfy the stated gate exactly and infer nothing beyond it — so the gate has to be complete.

**Versus the Opus 5 baseline in this repo** (see `benchmark.md`): the shapes of the weaknesses differ.
Opus 5's pattern here has been *nails pure logic and architecture, under-engineers UI runtime
lifecycle*. grok-4.5's is *produces good creative output fast, under-verifies against the real
contract*. Opus 5's misses tended to need several review rounds and occasionally a model escalation to
resolve; grok-4.5's cleared in a single round once the oracle was explicit — cheaper to correct, but
you must budget the round rather than hope for it.

**Cost/benefit for this class of work:** strongly positive. Bulk creative work over an
independently-partitionable space, with a mechanical correctness oracle available, is close to the
ideal shape for a grok fan-out. Work that needs one coherent mind over shared mutable state is not.
