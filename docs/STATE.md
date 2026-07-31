# 2D Metaverse — State
> **hyprverse**: a private student social world with spatial media, meeting rooms, stage, arcade, and board tables. · Last checkpoint: 2026-08-01

## 🚧 In progress / next
- **Flappy dino-ramp round LANDED on `main`** (PR #171, squash `c0015d9`, CI green incl. E2E, Raja playtested + approved): continuous Dino-style difficulty ramp, 10-points-per-pipe scoring, 100-point milestone chime, F-key fullscreen in the arcade overlay (both games).
- Next: resume spec 27 line — tickets #163→#166 (`docs/specs/27-arcade-2.md`, GitHub #162), Opus 5 builds all (benchmark, log in `docs/benchmark.md`).
- Parked: remaining PRD 25 frontier (#107, #117, #108, #118–#121, #124/#125, #127–#132) and non-blocking review follow-ups on #148/#152/#153/#156.

## Status
- PRD 25 batch fully landed (#138–#160); PRD 26 moderator dashboard merged (#161); arcade polish (#170) + flappy dino-ramp (#171) landed. Main CI green.
- Flappy difficulty is now ONE continuous ramp (no menu): `t = min(1, score/400)` lerps speed 160→196, gap 245→158, spacing 330→272, plateau = the old tuning; physics untouched; `POINTS_PER_PIPE = 10`. Raja's normal runs ≈ 280 on the new scale.
- Prod healthy: `https://api.space.raja-dev.me/health/ready` ok; FE auto-deploys via Vercel.
- Verified this session: focused vitest only (flappy 18/18, ArcadeOverlay 27/27) + both frontend tsc projects; full suites stayed in CI per rule.

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
- Flappy has NO difficulty menu by design (Dino-style single ramp, Raja's call 2026-08-01) — don't add easy/normal/hard tiers back; tune `RAMP_END_SCORE`/start/end knobs in `game/arcade/flappy.ts` instead. No NEW flappy tests without asking (Raja's explicit instruction); existing ones must stay green.
- `grok` CLI dispatches are blocked by the permission classifier in this harness mode — needs a Bash allow rule before routing work to grok.
- Prod compose `x-backend-environment` anchor must explicitly forward any new backend env var — unlisted `.env` values are silently dropped.
- Generated campus artifacts must be regenerated with `cd frontend && python3 scripts/gen_campus.py`, never hand-merged.
