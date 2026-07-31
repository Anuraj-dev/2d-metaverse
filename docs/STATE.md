# 2D Metaverse — State
> **hyprverse**: a private student social world with spatial media, meeting rooms, stage, arcade, and board tables. · Last checkpoint: 2026-08-01

## 🚧 In progress / next
- **Campus art restyle done, on branch `art/hostel-room-proof` (4 commits, `71ef02d`..`01abd9c`), NOT pushed and NOT merged — awaiting Raja's look.** Furniture 174 → 858 objects, 12 → 81 distinct sprites, all 9 districts furnished. Opus 5 reviewed; its P0 (E2E door corridors) and P1 (double-drawn room tables) are fixed.
- Next: Raja eyeballs it in the browser (`cd frontend && npm run dev`, mock mode), then push + PR so CI (incl. the PR-blocking E2E job) runs. Nothing local can prove E2E — it needs the docker stack.
- Then: resume spec 27 line — tickets #163→#166 (`docs/specs/27-arcade-2.md`, GitHub #162), Opus 5 builds all (benchmark in `docs/benchmark.md`).
- Parked: remaining PRD 25 frontier (#107, #117, #108, #118–#121, #124/#125, #127–#132) and non-blocking review follow-ups on #148/#152/#153/#156.

## Status
- PRD 25 batch landed (#138–#160); PRD 26 moderator dashboard (#161); arcade polish (#170); flappy dino-ramp (#171). Main CI green.
- Art restyle (branch only): new `frontend/scripts/campus_decor/` plug-in seam — one district = one module = one owner, so districts can be worked in parallel without touching the 950-line generator. 102 LimeZu prop cutouts (was 17), prop catalog at `docs/art/limezu-catalog.md`, offline renderer `frontend/scripts/render_region.py`.
- Verified on the branch: `maps.test.ts` 42/42, both frontend tsc projects clean, regeneration deterministic (twice → same md5), every seat/door/board-seat/interactable reachable from spawn with a real 18×14 body, E2E waypoint corridors swept clear.
- Prod healthy: `https://api.space.raja-dev.me/health/ready` ok; FE auto-deploys via Vercel from `main`.

## Architecture map
- Wire contracts and shared rules -> `shared/src/`
- Backend API, sockets, moderation, authority FSMs -> `backend/src/`
- Frontend React/Phaser/media/UI -> `frontend/src/`
- Arcade reducers -> `frontend/src/game/arcade/`; overlay/renderers -> `frontend/src/ui/arcade/`; board stack -> `shared/src/games/` + `backend/src/boardMatch.ts`/`board-manager.ts`
- Generated campus + geometry -> `frontend/scripts/gen_campus.py` (structure, cabinets, tables); per-district art passes -> `frontend/scripts/campus_decor/<district>.py`
- Deploy and production operations -> `.github/workflows/`, `deploy/`

## Stack & run
- Stack: TypeScript strict npm workspaces, React + Phaser, Express + Socket.IO, Postgres/Redis/LiveKit.
- Run: `npm install` then `docker compose up --build`; mock frontend: `cd frontend && npm run dev`.
- Test: CI is authoritative. Do not run full local build/test suites; only focused touched-file tests are permitted.

## Key decisions (top 3–5)
- `@metaverse/shared` owns every wire shape; game rules stay pure seeded reducers; managers are side-effect shells (full log: `docs/decisions.md`).
- Campus art lives in per-district `campus_decor/` modules, never in `gen_campus.py` — the generator stays the structural author (2026-08-01).
- Arcade UX (2026-07-30): Escape = pause menu, no auto browser-fullscreen, snake smoothness via renderer interpolation only.
- Spec 27 (2026-07-25): RACE not duel; Opus 5 builds everything (benchmark).
- Full local gates are prohibited on Raja's machine; GitHub CI is the verifier.

## Gotchas
- **A solid prop's collision body is `0.8w × 0.55h`, bottom-anchored — NOT its tile.** A 32×32 prop claims ~3 cols × 2 rows. The player body is 18×14. `maps.test.ts` "campus furniture plausibility" is the only authority on placement legality.
- **Connectivity is not enough for the E2E suite.** `e2e/helpers.ts` waypoints are straight-line segments walked with no pathfinding, so the whole swept corridor must be clear. Re-verify them whenever the map changes (AGENTS.md says so; it was missed once and caught in review).
- `WorldScene` draws a fallback round table at each room's seat centroid **only if** the map authors no solid there — don't remove that guard or every furnished room gets two stacked tables.
- Entry bundle budget is nearly full (~124.9/130 KB gzip) — new arcade code must stay in lazy chunks.
- ControlBar is mounted last in `App.tsx` but must stay hidden while `arcade` state is set — don't "fix" the ordering back.
- Snake reducer bonus re-roll cadence deliberately matches Raja's original game.js — don't "fix" it.
- Flappy has NO difficulty menu by design (Raja's call 2026-08-01). No NEW flappy tests without asking.
- `grok` CLI needs a `Bash(grok:*)` allow rule in `.claude/settings.json` (added 2026-08-01) or the permission classifier blocks every dispatch.
- LimeZu art is **non-commercial licence only** — fine for a personal project; buy the ~$1.20 paid pack before any monetisation. Now a campus-wide dependency, not one room's.
- Prod compose `x-backend-environment` anchor must explicitly forward any new backend env var.
- Generated campus artifacts must be regenerated with `cd frontend && python3 scripts/gen_campus.py`, never hand-merged.
