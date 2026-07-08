# Old context — 2D Metaverse
> ⚠️ Reconstructed from the codebase, README, CLAUDE.md, and git history when the context system was
> adopted on 2026-07-04. This is a best-effort summary of what the project is and how far it had progressed
> BEFORE per-session tracking began. It is NOT a record of exact past sessions or decisions — those weren't
> captured. Treat specifics as inferred, not authoritative.

## What this project is
A Gather/Zep-style 2D metaverse: users walk a styled top-down office campus (pixel art, Pipoya-compatible),
talk over proximity audio, enter key-gated private meeting rooms with seated video calls (LiveKit), watch
auditorium/stage broadcasts, and play mini-games (arcade cabinets + two-player board tables). It's an
npm-workspaces monorepo of three packages — `shared` (the zod wire contract), `backend` (Node/Express/
Socket.IO with Postgres/Redis/LiveKit), and `frontend` (React + Phaser + Vite).

## How far it had progressed
Mature and CI-gated at adoption — 42 commits, full production topology (frontend on Vercel, backend on a
single EC2 Docker-Compose host with ECR images, health-gated deploys, and a Telegram watchdog). The history
shows an early auth/socket-hardening + HUD phase, then a large campus build-out (multi-tileset map, 12
avatars, private rooms, interactables, stage broadcast), then a systematic 12-PRD resilience/quality
overhaul: shared zod contract package, full strict-mode parity, backend + frontend + E2E test suites, pino
logging + client error beacon, deploy resilience, zone-aware audio, meeting lifecycle + portal/grid, a
graphics/sound polish pass, and finally mini-games (arcade cabinets, then server-authoritative board tables).

## Notable structure / entry points
- `shared/src/` — `socket.ts`, `rest.ts`, `constants.ts`, `games/` (board rules). The single wire-shape source.
- `backend/src/` — `app.ts`/`createApp()`/`createServer()`, `socket.ts`, `meeting.ts` + `meeting-manager.ts`, `boardMatch.ts` + `board-manager.ts`, `logger.ts`, `parse-config.ts`.
- `frontend/src/` — `game/` pure logic modules (+ vitest), `WorldScene.ts` orchestrator, `media/` (soundMixer, livekit, mediaLogic), `net/`, `ui/`, `e2e/testHook.ts`.
- `scripts/gen_campus.py`, `scripts/gen_arcade_sprites.py`, `frontend/scripts/gen_audio.py` — asset/map generation.
- `deploy/`, `.github/workflows/backend-ci.yml` + `frontend-ci.yml` — CI/deploy.
- Per-package detail lives in `backend/README.md` and `frontend/README.md`; the operating rulebook is `CLAUDE.md`.

## Inferred stack & tooling
TypeScript (strict everywhere, ~6.0.x kept in lockstep across packages), npm workspaces on a single root
lockfile, Vite + Phaser + React (frontend), Express + Socket.IO + Postgres + Redis + LiveKit (backend), zod
(shared contract), pino (backend logging), vitest (unit), Playwright (E2E), Docker Compose + ECR + EC2 +
SSM (backend deploy), Vercel (frontend deploy), Telegram (alerting).
