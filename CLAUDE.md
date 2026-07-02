# Model delegation (temporary, until 2026-07-06)

Raja is using Fable 5 as the primary model in this project until 2026-07-06. While that's active:

- Token-heavy, unproductive tasks should be delegated to Sonnet 5 via a subagent instead of being done directly by Fable. This includes: reading/exploring the codebase and Claude-in-Chrome browser use/testing.
- Use the Agent tool to hand these off rather than burning Fable's context on them.
- **Code review is the exception — do not delegate it to a Sonnet 5 subagent.** Review is delegated to Codex GPT 5.5, acting as the Reviewer Agent in the two-agent PR loop. Reviewer Agent conduct (see project memory `reviewer-agent-conduct`): report findings to the Coder via PR comments only — never edit code, patch configs, or apply fixes directly. Gate every `✅ READY FOR MERGE` approval on a green `npm run build` (`tsc -b && vite build`), not just `npm test` — tests can pass on code the build rejects.
- After 2026-07-06 (or once Raja switches back off Fable), this delegation rule no longer applies — revert to normal behavior.

# Production topology

- **Frontend**: hosted on Vercel, auto-deployed to production by the `deploy` job in `.github/workflows/frontend-ci.yml` on every push to `main` (after lint/typecheck/test/build/budget pass). Requires `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` repo secrets.
- **Backend**: a single EC2 box running Docker Compose (`deploy/docker-compose.prod.yml`). `Backend deploy` builds/pushes an immutable ECR image and runs `deploy/deploy-remote.sh` via SSM. The deploy script gates on the migrate+seed `setup` container's exit code before switching the backend image, and alerts + rolls back on health-check failure.
- **Alerting**: a `alerter` container on the box watches the Docker events stream and posts container crashes/restart-loops/unhealthy states to Telegram (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` from SSM). See `deploy/README.md`.
- **Version stamps**: the running git SHA is visible in the app's Settings panel (`build <sha>`, injected via `VITE_GIT_SHA`) and in the backend `/health/live` + `/health/ready` responses (`sha`, baked into the image via the `GIT_SHA` build arg).

# Logging conventions

- **Backend**: never use `console.*` in `backend/src` — log through pino (`backend/src/logger.ts`). Create per-module child loggers with `childLogger({ module: "..." })`; inside request handlers use the request-bound logger (`res.locals.log`, or `requestLog(res, fallback)` from `request-logger.ts`) so lines carry the `requestId`; socket code logs through the per-connection child logger (bound with `socketId`, and `playerId`/`spaceId` after join). Pass errors as `{ err }` so pino serializes the stack. `LOG_LEVEL` env controls verbosity (`debug` in dev, `info` in prod).
- **Frontend error beacon**: `frontend/src/errorBeacon.ts` ships uncaught errors/unhandled rejections to backend `POST /client-errors` (installed in `main.tsx`, real-backend mode only). Reports appear in backend logs as `module: "client-error"` with the client's build `sha`. Rate-limited server-side (10/min/IP) and client-side (session cap + dedupe) — telemetry must never break the game.
- **Rotation**: all compose services use the `json-file` driver, `max-size: 10m` × `max-file: 3`, via the shared `x-logging` anchor. Add it to any new compose service.

# Backend test conventions

- Unit vs integration split: `npm test` (backend) must stay service-free; `npm run test:integration` requires Postgres + Redis (`docker compose up -d postgres redis`), uses Redis logical DB 1, and runs files sequentially.
- Testability seams: boot the real app via `createApp()`/`createServer()` (src/app.ts) on an ephemeral port — never call route/socket handlers directly; config assertions go through the pure `parseConfig(env)` (src/parse-config.ts); the migration runner takes an overridable migrations dir.
- Isolation: integration tests must never assume clean state — per-run usernames (deleted afterwards), `flushDb` on the dedicated Redis DB, and throwaway Postgres schemas for migration tests.
