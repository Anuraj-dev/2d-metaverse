# Spec 27 — Arcade 2.0

**Canonical spec:** GitHub issue [#162](https://github.com/Anuraj-dev/2d-metaverse/issues/162)
(published via /to-spec, 2026-07-25). This file is the repo-convention pointer + decision record.

## One-line

Rebuild the arcade into the most polished, replayable corner of the campus: juice everything,
rework Snake, add a space-themed merge-drop flagship, add 1–N first-to-goal race mode, and wrap
it all in a weekly/daily/streak leaderboard meta-layer.

## Tickets (PR train, dependency order)

| # | Ticket | Blocked by |
|---|--------|------------|
| [#163](https://github.com/Anuraj-dev/2d-metaverse/issues/163) | P1 Juice overhaul + Snake rework (speed tiers, levels, sprite art) + board-table animations/sounds | — |
| [#164](https://github.com/Anuraj-dev/2d-metaverse/issues/164) | P2 Merge-drop flagship (space theme, deterministic fixed-timestep physics) | — (land after #163) |
| [#165](https://github.com/Anuraj-dev/2d-metaverse/issues/165) | P3 Race mode (1–N, first-to-goal, board-manager-pattern relay) on Snake + merge-drop | #163, #164 |
| [#166](https://github.com/Anuraj-dev/2d-metaverse/issues/166) | P4 Leaderboard meta (weekly reset, daily seed, streaks, plausibility checks) | #163, #164 |

## Locked decisions (from the 2026-07-25 brainstorm/grilling with Raja)

- **Race, not duel** — matches end the instant someone reaches the goal; nobody ever waits dead.
  Solo = race the clock. All-dead ⇒ most progress wins.
- **Flappy stays** (mechanics untouched, juiced). **Snake as-is judged trash** — too fast, no
  settings, no levels; rework is P1, not optional polish.
- **Merge theme: space** (pebble → asteroid → moon → planets → gas giant → sun). Original name,
  no fruit/watermelon references (IP). Tetris-likes rejected outright (litigation history).
- **Anti-cheat: plausibility checks only** (ceilings, pace, monotonicity). Replay verification
  explicitly out of scope.
- **Opus 5 implements everything** (UI + backend) as a capability benchmark →
  [`docs/benchmark.md`](../benchmark.md), updated by the orchestrator each dispatch/review round.
  Review: Sol high first pass, Sol medium re-reviews, + `@codex review` cloud trigger while the
  cloud-review experiment window is open.
- Server load: negligible (<1% of the box) for everything in scope; drawing/stroke games excluded
  partly for this reason.
- Wire shapes only in `@metaverse/shared`; game rules only in pure seeded reducers; cabinets only
  via the campus generator; sounds only via the event→clip table — per standing conventions.
