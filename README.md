# 2D Metaverse

A Gather/Zep-style 2D metaverse: walk a styled office space, talk with proximity
audio, and enter key-gated meeting rooms with seated video calls.

This repository is an **npm-workspaces monorepo** with three packages:

```
.
├── shared/     @metaverse/shared — the wire contract (zod schemas, inferred types,
│               event-name + limit constants). Framework-free: no IO, no env reads.
├── backend/    metaverse-backend — Node + Express + Socket.IO + Postgres/Redis/LiveKit.
│               Imports the shared schemas for runtime validation.
└── frontend/   frontend — React + Phaser + Vite. Imports the shared inferred types
                (and event-name/limit constants).
```

## The one rule: payload shapes live in `shared/` only

Every socket event payload (client→server **and** server→client) and every REST
request/response shape is defined **exactly once**, as a zod schema in
`shared/src`. The backend imports those schemas and `safeParse`s them (runtime
validation); the frontend imports the **inferred types** (compile-time only —
type-only imports are erased, so zod never reaches the browser bundle) plus the
runtime event-name and limit constants.

There is no hand-mirrored contract file anymore. If the frontend and backend ever
disagree about a field, it is a **compile error**, not a prod-only runtime bug.

**Never re-declare a wire shape in `backend/` or `frontend/`.** Add it to `shared/`.

### How to add a new socket event, end-to-end

1. **`shared/src/constants.ts`** — add the event name to `CLIENT_EVENTS` or
   `SERVER_EVENTS` (and to `SERVER_EVENT_NAMES` if the client subscribes to it).
   Add any new limit to `LIMITS` / `RATE_LIMITS`.
2. **`shared/src/socket.ts`** (or `rest.ts`) — add the zod schema for the payload
   and export its inferred type. Wire it into `ClientToServerEvents` /
   `ServerToClientEvents`.
3. **`shared/src/*.test.ts`** — add valid/invalid fixtures beside the schema.
4. **`backend/src/socket.ts`** — import the schema; `safeParse` it in the handler
   exactly like the existing events.
5. **`frontend/src/net/net.ts`** — emit/handle using the shared event-name constant
   and inferred type. `tsc -b` now points at every consumer that needs updating.
6. Run `npm run build:shared` first (or the aggregate scripts below), then
   `npm run typecheck`.

## Workspace commands (run from the repo root)

```bash
npm install            # installs all three workspaces against the single root lockfile
npm run build:shared   # build @metaverse/shared (must precede consumer builds)
npm run build          # build shared → backend → frontend
npm run typecheck      # build shared, then typecheck all three
npm run lint           # lint all three
npm test               # build shared, then run every workspace's tests
```

Consumers resolve `@metaverse/shared` from its built `dist/`, so **shared must be
built before the backend or frontend typechecks/builds**. The aggregate scripts and
every CI job do this first; if you run a single workspace's `typecheck` directly,
run `npm run build:shared` beforehand.

Per-package details live in [`backend/README.md`](backend/README.md) and
[`frontend/README.md`](frontend/README.md).

## Running locally

```bash
cp .env.example .env
docker compose up --build      # postgres + redis + livekit + backend
cd frontend && npm run dev     # http://localhost:5173 (mock mode by default)
```

The backend serves REST + Socket.IO at `http://localhost:3001`.

## CI & deploy

- **Backend CI** (`.github/workflows/backend-ci.yml`): lints/typechecks/tests
  shared + backend, composes the full stack for integration + the contract smoke
  test, and — critically — the **Build production image** job builds the backend
  Docker image. That image build uses the **repository root as its context** (see
  `backend/Dockerfile`) because the backend depends on the `shared` workspace.
- **Frontend CI** (`.github/workflows/frontend-ci.yml`): builds shared, then
  lints/typechecks/tests/builds the frontend (with the gzipped-entry bundle budget),
  and runs the Playwright E2E suite against the composed backend.
- **Backend deploy**: builds/pushes an immutable ECR image (root context) and
  deploys via SSM to a single EC2 Docker-Compose host.
- **Frontend deploy (Vercel)**: the frontend is a workspace member that imports
  `shared`, so **the Vercel project's Root Directory must be the repository root**
  (root `vercel.json` drives the install/build: it installs the workspace and builds
  shared before the frontend). See [Vercel deployment](#vercel-deployment) below.

### Vercel deployment

The frontend deploys to Vercel, configured by the root [`vercel.json`](vercel.json):

- **Root Directory must be the repository root.** The frontend imports
  `@metaverse/shared`, which only resolves when the whole workspace is installed, so
  Vercel builds from the repo root — set the Vercel project's **Root Directory** to
  the repository root (this is a dashboard setting, not something `vercel.json` can
  override).
- **What `vercel.json` does.** `installCommand: npm ci` installs and hoists the
  workspace against the root lockfile; `buildCommand` then builds `shared` first
  (`npm run build:shared`) and compiles the frontend against it
  (`npm run build --workspace frontend`), publishing `frontend/dist`.
- **`main` auto-deploy is disabled on purpose** (`git.deploymentEnabled.main: false`).
  Production ships only through the frontend CI `deploy` job, which stamps the build
  with the git SHA (`VITE_GIT_SHA`); Vercel's own push-to-`main` deploy is turned off
  so there is a single production path. Branch/PR previews are unaffected.
