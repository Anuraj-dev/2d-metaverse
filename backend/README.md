# 2D Metaverse backend

Node/TypeScript backend implementing the REST and Socket.IO contract in `plan.html`. PostgreSQL stores users and map metadata, Redis stores presence/seat state, and LiveKit supplies world audio and private-room audio/video.

## Run locally with Docker

From the repository root:

```bash
cp .env.example .env
docker compose up --build
```

The API and Socket.IO server are at `http://localhost:3001`; LiveKit signaling is at `ws://localhost:7880`. The setup container applies migrations and seeds space `1`, rooms `1`–`6`, their map coordinates, and their seats.

Private rooms have no join keys — access is admin-gated at runtime (PRD 14): the first arrival becomes the room admin, and later visitors knock at the door for approval. The auditorium stage is also keyless (PRD 17): going on air is gated by a server-validated on-stage position plus a 2s stillness confirm, not a presenter key.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV`, `PORT` | Runtime mode and listen port. |
| `LOG_LEVEL` | Pino log level (`fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`). Default `info`; use `debug` for chatty local development. |
| `DATABASE_URL`, `REDIS_URL` | Postgres and Redis connection strings. |
| `JWT_SECRET`, `JWT_TTL` | Auth token signing secret and lifetime. |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins. |
| `LIVEKIT_URL`, `LIVEKIT_API_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit client URL, server-to-server URL, and credentials. |
| `KNOCK_TIMEOUT_MS` | How long a pending door knock waits for admin approval before auto-denying (default `30000`). |
| `MAP_JSON_URL` | Path/URL the client loads the map from. |
| `TRUST_PROXY` | `true` behind the production Nginx proxy. |
| `GIT_SHA` | Build stamp surfaced in `/health/live` and `/health/ready` (baked into the image at build time). |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Consumed by the deploy watchdog/alerter, not the backend itself (see `deploy/README.md`). |

## Logging

All backend logs are structured JSON (pino) on stdout — Docker's `json-file` driver collects and rotates them (see `deploy/README.md`). There are no log files inside the container.

Every line carries:

- `level` (pino numeric: 30 info, 40 warn, 50 error, 60 fatal), `time`, `msg`
- `service: "backend"` and `sha` (the running image's git SHA)
- `module` where relevant (`http`, `socket`, `db`, `redis`, `media`, `migrate`, `seed`, `client-error`)

Correlation ids:

- **REST**: every request gets a `requestId` (also echoed in the `X-Request-Id` response header — ask a user for it when they report an error). One completion line per request with `method`, `path`, `status`, `durationMs`. 5xx log at error level; `/health/*` is demoted to debug so it never spams. New route code should log through the request-bound child logger (`res.locals.log` via `requestLog(res, fallback)`), never the root.
- **Socket.IO**: each connection gets a child logger with `socketId` (plus `userId`/`username` from the handshake). After a successful `join` it is re-bound with `playerId` and `spaceId`, so a player's whole session greps as one thread. Connections, joins, disconnects (with reason), and handler failures (with the event name) are logged.
- **Client errors**: browser crashes POSTed to `/client-errors` are logged at error level with `module: "client-error"`, the client's `sha`, `url`, `userAgent`, and optional scene `context` — nothing is persisted beyond the log stream.

Reading production logs (`docker compose logs backend` emits the raw JSON):

```bash
# follow, pretty-ish
docker logs -f metaverse-backend-1 | jq -r '[.time, .level, .msg] | @tsv'

# only errors and worse
docker logs metaverse-backend-1 | jq 'select(.level >= 50)'

# trace one request across the stack
docker logs metaverse-backend-1 | jq 'select(.requestId == "PASTE-X-REQUEST-ID")'

# all frontend crash reports (check .sha for stale-bundle bugs)
docker logs metaverse-backend-1 | jq 'select(.module == "client-error")'

# one player's socket session
docker logs metaverse-backend-1 | jq 'select(.playerId == "PLAYER-UUID")'
```

## Running the tests

There are two vitest suites plus the CI smoke test:

- **Unit** — `npm test`. Service-free (no Postgres/Redis needed); covers pure modules (`parse-config`, `password`, `seat-key`, `request-logger`, `client-errors`). This is what CI's `test` job runs.
- **Integration** — `npm run test:integration`. Boots the real app in-process on an ephemeral port (via `createApp()`/`createServer()` in `src/app.ts`) and exercises REST over HTTP, sockets via `socket.io-client`, the Redis Lua scripts under parallel contention, the repository against the real schema, and the migration runner against a fixture directory. **Requires Postgres and Redis**:

  ```bash
  docker compose up -d postgres redis   # from the repo root
  cd backend && npm run test:integration
  ```

  Connection env (defaults target the dev compose): `DATABASE_URL` (`postgres://metaverse:metaverse@localhost:5432/metaverse`) and `REDIS_URL` (`redis://localhost:6379/1` — logical DB 1, so test state never touches a dev server on DB 0). The suite fails fast with instructions if either service is unreachable. Isolation: each run migrates+seeds idempotently, flushes the dedicated Redis DB, uses per-run usernames it deletes afterwards, and runs the migration tests in a throwaway Postgres schema — so back-to-back runs are safe and no manual cleanup is needed.
- **Smoke** — `npm run smoke` against a fully composed stack (`http://localhost:3001` or `SMOKE_URL`).

In CI, the `test` job (no services) runs lint + typecheck + unit tests + build; the Docker `integration` job composes the full stack, runs `npm run test:integration` against the published `5432`/`6379` host ports, then the smoke test. The dev compose host-port mappings are overridable via `POSTGRES_HOST_PORT`/`REDIS_HOST_PORT` if they clash locally.

## Lint & typecheck

- `npm run lint` — ESLint over `src` + `test` (flat config, `eslint.config.js`). The baseline is `typescript-eslint`'s **type-checked** recommended set (mirrors the frontend). Two enforced conventions on top:
  - **`no-console` errors in `src`** (the `src/logger.ts` module is the one exception) — mechanically enforcing the pino logging convention, so a stray `console.log` fails CI, not review.
  - **Vitest hygiene on `test/**`** (`@vitest/eslint-plugin`): `no-focused-tests` errors — a committed `.only` can never silently shrink the suite CI reports as green; `expect-expect`, `no-conditional-expect`, `no-standalone-expect` error; `no-disabled-tests` warns.
  - The type-checked `no-unsafe-*`/`no-explicit-any` family is relaxed **for test files only** (they assert over inherently-`any` JSON and socket payloads) — production `src` keeps the full baseline.
- `npm run typecheck` — `tsc -p tsconfig.json --noEmit` (production `src`). Lint's type info comes from `tsconfig.eslint.json`, which additionally covers `test/`.
- **`.skip`-justification convention:** a skipped test must carry a comment on the line above saying *why* and *when it comes back* (e.g. `// SKIP: needs LiveKit stub — re-enable after #123`), so disabled tests stay visible debts.
- Root convenience: from the repo root, `npm run lint` / `npm run typecheck` / `npm test` run every workspace (shared, backend, frontend); the typecheck/test scripts build `@metaverse/shared` first (root `package.json`).

## Product analytics operator seam

Product analytics is stored in `analytics_events`. Pre-auth sign-in outcomes are
server-generated, anonymous records with only a coarse result. Authenticated
client events enter through `POST /api/v1/analytics/events`; the server derives
the actor from the JWT, stamps time, deduplicates the client event UUID, and
accepts only event schemas exported by `@metaverse/shared`. The foundation ships
only an `ingestion-probe` verification event; feature events remain owned by
their later slices. Records expire after 90 days (sign-in outcomes after 7 days).
The backend prunes expired rows on startup and every six hours through the
indexed `expires_at` path, independently of traffic; shutdown stops that job.
Both operator queries also exclude rows whose expiry has passed.

There is intentionally no public analytics read endpoint. Operators query with
database credentials from the EC2/SSM operator path:

```sh
psql "$DATABASE_URL" -f backend/analytics/summary.sql
psql "$DATABASE_URL" -f backend/analytics/export.sql > analytics-export.csv
```

The export contains event UUID, allowlisted name/properties, server-derived actor
UUID when authenticated, server timestamp, and expiry only. Do not join or add
usernames, passwords, JWTs, IP addresses, chat/transcripts, precise coordinates,
device identifiers, SDP, or raw error context. Extend the shared discriminated
union and its privacy tests before emitting a new feature event. The summary
excludes `ingestion-probe`, so deployment checks never become a pilot KPI.

## Contract details

- REST routes exactly follow `/api/v1/signup`, `/signin`, `/space/:id`, `/analytics/events`, and `/livekit/token`.
- Socket event names, socket/REST payload schemas, and shared limits are defined once in the **`@metaverse/shared`** workspace package (`shared/src`). The backend imports those zod schemas and `safeParse`s them exactly as before; there is no hand-mirrored contract file. Add a new event/shape in `shared/`, never here — see the root `README.md`.
- LiveKit world room: `world:<spaceId>` (for example `world:1`). Tokens can publish microphone only.
- LiveKit private room: `room:<roomId>` (for example `room:1`). A private token is issued only while the caller owns a seat. Standing or disconnecting removes the participant from LiveKit.
- Socket.IO reconnect recovery has a four-second grace period so brief network changes do not create leave/join churn.

## Development without Docker for Node

Start PostgreSQL and Redis (Docker is fine), copy `backend/.env.example` to `backend/.env`, then, **from the repository root** (this is an npm-workspaces monorepo — install once at the root):

```bash
npm install                            # installs all workspaces (root lockfile)
npm run build:shared                   # build @metaverse/shared first
cd backend
npm run db:migrate
npm run db:seed
npm run dev
```

Use `npm run typecheck`, `npm test`, and `npm run build` (each builds `shared` first via the root scripts, or run `npm run build:shared` yourself) before deployment.

## AWS EC2 deployment requirements

Use an Elastic IP and DNS names such as `api.example.com` and `livekit.example.com`. Set production secrets in `.env`, including a random JWT secret and random LiveKit key/secret. Set `NODE_ENV=production`, `TRUST_PROXY=true`, `CORS_ORIGINS` to the frontend origin, `LIVEKIT_URL=wss://livekit.example.com`, and keep `LIVEKIT_API_URL=http://livekit:7880` for server-to-server cleanup.

Use `deploy/nginx.conf.example` with Let's Encrypt. For production, enable LiveKit's embedded TURN server after the `TURN_DOMAIN` certificate exists:

```bash
docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d --build
```

The EC2 security group must allow:

- TCP 80 and 443 for HTTP/TLS and signaling
- TCP 7881 for ICE/TCP fallback
- UDP 50000-50100 for LiveKit media
- UDP 3478 and TCP 5349 for TURN (when using the AWS override)

Do not expose PostgreSQL or Redis publicly. LiveKit uses external-IP discovery for EC2 NAT. The AWS override mounts Let's Encrypt certificates read-only and enables TURN/UDP plus TURN/TLS; plain signaling TLS does not replace TURN.

The current single-host setup matches the plan. Before horizontal backend scaling, add the Socket.IO Redis adapter; Redis already holds shared presence and seats, but Socket.IO broadcasts are currently process-local.
