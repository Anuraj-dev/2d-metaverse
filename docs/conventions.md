# Conventions — 2D Metaverse

> The authoritative, detailed rulebook is the repo-root `CLAUDE.md` (monorepo layout, the shared-contract
> rule, logging, compiler standard, and each subsystem's how-to). This file is the quick-reference; when in
> doubt, `CLAUDE.md` wins.

## Stack
- **Monorepo**: npm workspaces — `shared/` (`@metaverse/shared`), `backend/` (`metaverse-backend`), `frontend/` (`frontend`). Single root `package-lock.json`.
- **shared**: zod schemas + inferred types — the wire contract. Framework-free (no IO, no env).
- **backend**: Node + Express + Socket.IO + Postgres + Redis + LiveKit. pino logging.
- **frontend**: React + Phaser + Vite. Imports shared inferred types + runtime constants.

## Run the app (from repo root)
- `npm install` — installs all three workspaces against the root lockfile.
- `cp .env.example .env && docker compose up --build` — postgres + redis + livekit + backend.
- `cd frontend && npm run dev` — http://localhost:5173 (mock mode by default). Backend REST + Socket.IO at :3001.

## Build / verify (from repo root)
- `npm run build:shared` — MUST precede any consumer typecheck/build.
- `npm run build` — shared → backend → frontend.
- `npm run typecheck` — build shared, then typecheck all three.
- `npm run lint` — lint all three.
- `npm test` — build shared, then every workspace's tests (frontend/shared vitest, backend unit).
- `npm run test:integration` (backend) — needs Postgres + Redis (`docker compose up -d postgres redis`), Redis logical DB 1, sequential.
- E2E: Playwright, chromium-only, against the BUILT frontend (`vite preview` :4173) + composed backend. See `frontend/README.md` → E2E.

## Non-negotiable conventions (see CLAUDE.md for the full text)
- **Wire shapes live in `shared/` only.** Never re-declare a payload in backend/frontend.
- **Strict everywhere.** `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` on in every tsconfig, tests included. No new `!` without a justifying comment; prod `src/` is assertion-free.
- **Backend logging** through pino (`backend/src/logger.ts`) — never `console.*` in `backend/src` (ESLint enforces).
- **Frontend game rules** are pure modules under `frontend/src/game/*.ts` (no Phaser/net/DOM), each with a vitest file in the same commit. `WorldScene.ts` is glue only.
- **Board rules** are one pure impl in `shared/src/games/`, used by both backend (authoritative) and frontend (render). Never re-derive.
- **Audio** decisions live in `frontend/src/media/soundMixer.ts`; game logic is audio-agnostic (emits events on `eventBus`).
- **Every shipped asset** needs a row in `frontend/ATTRIBUTIONS.md`. Never commit raw asset zips/packs.
- **Commit messages / PRs**: conventional commits; no AI/Claude/Anthropic credits (global rule).

## CI / deploy
- Backend CI: lint/typecheck/test shared+backend, integration + contract smoke, build prod Docker image (context = repo root).
- Frontend CI: build shared, then lint/typecheck/test/build frontend (gzipped-entry bundle budget), Playwright E2E. `deploy` job auto-ships to Vercel on push to `main`.
- Backend deploy: immutable ECR image (root context) → SSM → single EC2 Docker-Compose host; gated on setup-container exit code, health-check rollback + Telegram alert.
