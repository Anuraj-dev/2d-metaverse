# 2D Metaverse — State
> **hyprverse**: a private student social world with spatial media, meeting rooms, stage, arcade, and board tables. · Last checkpoint: 2026-07-30

## 🚧 In progress / next
- **Arcade polish round LANDED on `main`** (Raja approved): `87ec652` faithful Snake port + Escape=pause + chrome polish, `3b69656` emoji-guard fix, `b7558a8` crisp snake board edges (#170). Main CI green (watch confirmed 2026-07-30 ~17:30). Working tree clean.
- Next: resume spec 27 line — tickets #163→#166 (`docs/specs/27-arcade-2.md`, GitHub #162), Opus 5 builds all (benchmark, log in `docs/benchmark.md`).
- Parked: remaining PRD 25 frontier (#107, #117, #108, #118–#121, #124/#125, #127–#132) and non-blocking review follow-ups on #148/#152/#153/#156.

## Status
- PRD 25 batch fully landed (#138–#160); PRD 26 moderator dashboard merged (#161); arcade polish round landed through `b7558a8`. Main CI green.
- Prod healthy: `https://api.space.raja-dev.me/health/ready` ok; FE auto-deploys via Vercel.
- This session's diff verified locally: 178/178 focused vitest, both tsc projects, scoped eslint — all green (full suites prohibited locally).
- Wall-break-at-500 snake concept was built then **rejected and fully reverted** (zero stale refs); `arcade_break.ogg` deleted.

## Architecture map
- Wire contracts and shared rules -> `shared/src/`
- Backend API, sockets, moderation, authority FSMs -> `backend/src/`
- Frontend React/Phaser/media/UI -> `frontend/src/`
- Arcade reducers -> `frontend/src/game/arcade/`; overlay/renderers -> `frontend/src/ui/arcade/` (snake helpers `ui/arcade/snake/`, flappy `ui/arcade/flappy/`, fullscreen door `ui/arcade/fullscreen.ts`); board stack -> `shared/src/games/` + `backend/src/boardMatch.ts`/`board-manager.ts`
- Generated campus + geometry -> `frontend/scripts/gen_campus.py` (cabinets/tables placed ONLY here)
- Deploy and production operations -> `.github/workflows/`, `deploy/`

## Stack & run
- Stack: TypeScript strict npm workspaces, React + Phaser, Express + Socket.IO, Postgres/Redis/LiveKit.
- Run: `npm install` then `docker compose up --build`; mock frontend: `cd frontend && npm run dev`.
- Test: CI is authoritative. Do not run full local build/test suites; only focused touched-file tests are permitted.

## Key decisions (top 3–5)
- `@metaverse/shared` owns every wire shape; game rules stay pure seeded reducers; managers are side-effect shells (full log: `docs/decisions.md`).
- Arcade UX (2026-07-30, three-model consult): Escape = pause menu (Resume/Restart/Quit), quit-confirm deleted, NO auto browser-fullscreen ever (full-bleed CSS shell, ⛶ opt-in); snake smoothness = renderer interpolation only, reducer untouched; input snap = forced early tick on legal turns.
- Spec 27 (2026-07-25): RACE not duel; Flappy kept, Snake reworked; merge-drop space theme; Opus 5 builds everything (benchmark).
- Full local gates are prohibited on Raja's machine; GitHub CI is the verifier.
- Never delete a stacked base branch until every child is retargeted.

## Gotchas
- Entry bundle budget is nearly full (~124.9/130 KB gzip) — all new arcade code must stay in lazy chunks; only tiny registry/settings bits may touch the entry.
- ControlBar is mounted last in `App.tsx` to layer over meeting overlays, but must stay hidden while `arcade` state is set — don't "fix" the ordering back.
- Snake reducer (`game/arcade/snake.ts`) bonus re-roll cadence deliberately matches Raja's original game.js (Sol disputed it; locked with a test) — don't "fix" it.
- Prod compose `x-backend-environment` anchor must explicitly forward any new backend env var — unlisted `.env` values are silently dropped.
- Generated campus artifacts must be regenerated with `cd frontend && python3 scripts/gen_campus.py`, never hand-merged.
