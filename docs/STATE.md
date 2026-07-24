# 2D Metaverse — State
> **hyprverse**: a private student social world with spatial media, meeting rooms, stage, arcade, and board tables. · Last checkpoint: 2026-07-25

## 🚧 In progress / next
- **Arcade 2.0 (spec 27) ready to implement.** Spec = GitHub [#162](https://github.com/Anuraj-dev/2d-metaverse/issues/162); tickets #163 (juice+Snake rework) → #164 (merge-drop flagship) → #165 (race mode) → #166 (leaderboard meta), all `ready-for-agent`. Pointer doc: `docs/specs/27-arcade-2.md`. **Next step: dispatch an Opus 5 coder on #163** (fresh agent per ticket, feature branch, PR, never merges).
- **Opus 5 capability benchmark is live**: Opus 5 implements ALL spec-27 tickets (UI + backend — deliberate override of the Sol-backend routing). Orchestrator logs every dispatch/review round in `docs/benchmark.md` (coders never touch docs).
- Review protocol for spec-27 PRs: Sol high first pass, Sol medium re-reviews, PLUS `@codex review` cloud-trigger comment right after `gh pr create` (Codex cloud experiment window 2026-07-24→27; log in `~/Anuraj-Dev/CODEX_REVIEW_EXPERIMENT_LOG.md`; never reply `@codex` on its own review comment).
- Parked: remaining PRD 25 frontier (#107, #117, #108, #118–#121, #124/#125, #127–#132) and the non-blocking review follow-ups on #148/#152/#153/#156 — Raja chose to do the arcade line first.

## Status
- PRD 25 batch fully landed (#138–#160); PRD 26 moderator dashboard merged (#161). CI green both pipelines.
- Prod healthy: `https://api.space.raja-dev.me/health/ready` ok at SHA `7a4186f`; FE auto-deploys via Vercel; `MODERATOR_USER_IDS` live.
- Arcade today (what spec 27 replaces/extends): Snake+Flappy procedural-canvas cabinets w/ client-trusted REST scores; TTT+Connect-4 board tables (flat CSS, borrowed sounds). 2048 was retired.

## Architecture map
- Wire contracts and shared rules -> `shared/src/`
- Backend API, sockets, moderation, authority FSMs -> `backend/src/`
- Frontend React/Phaser/media/UI -> `frontend/src/`
- Arcade reducers -> `frontend/src/game/arcade/`; overlay/renderers -> `frontend/src/ui/arcade/`; board stack -> `shared/src/games/` + `backend/src/boardMatch.ts`/`board-manager.ts` (the pattern spec 27's race manager copies)
- Generated campus + geometry -> `frontend/scripts/gen_campus.py` (cabinets/tables placed ONLY here)
- Deploy and production operations -> `.github/workflows/`, `deploy/`

## Stack & run
- Stack: TypeScript strict npm workspaces, React + Phaser, Express + Socket.IO, Postgres/Redis/LiveKit.
- Run: `npm install` then `docker compose up --build`; mock frontend: `cd frontend && npm run dev`.
- Test: CI is authoritative. Do not run full local build/test suites; only focused touched-file tests are permitted.

## Key decisions (top 3–5)
- `@metaverse/shared` owns every wire shape; game rules stay pure seeded reducers; managers are side-effect shells (full log: `docs/decisions.md`).
- Spec 27 (2026-07-25): RACE not duel (first-to-goal, no dead waiting); Flappy kept, Snake reworked; merge-drop = space theme (IP-safe, Tetris-likes rejected); anti-cheat = plausibility checks only; Opus 5 builds everything (benchmark).
- Full local gates are prohibited on Raja's machine; GitHub CI is the verifier.
- Never delete a stacked base branch until every child is retargeted.

## Gotchas
- Entry bundle budget is nearly full (~124.9/130 KB gzip) — all new arcade code must stay in lazy chunks; only tiny registry/settings bits may touch the entry.
- Prod compose `x-backend-environment` anchor must explicitly forward any new backend env var — unlisted `.env` values are silently dropped.
- Generated campus artifacts must be regenerated with `cd frontend && python3 scripts/gen_campus.py`, never hand-merged.
- Auth limiter is process/IP scoped; integration fixtures use direct `createPlayer` except when REST auth itself is under test.
- Merge-drop determinism: fixed timestep + seeded spawns, avoid non-deterministic math — race fairness and reducer tests depend on it.
