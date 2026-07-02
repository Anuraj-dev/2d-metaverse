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

# Compiler standard (repo-wide, non-negotiable)

- **Both packages compile strict.** Every tsconfig project in the repo — backend (`backend/tsconfig.json`) and all frontend projects (`frontend/tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.e2e.json`, `tsconfig.test.json`) — has `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` on. Never turn a flag off, and never add a new tsconfig (or override) that compiles code under a weaker standard. `tsc -b` gates the build in CI, so a violation fails the pipeline.
- **Test code is held to the same bar as product code.** Unit tests (`frontend/src/**/*.test.ts(x)`) are strict-typechecked via `frontend/tsconfig.test.json` (wired into `tsc -b`), e2e specs via `tsconfig.e2e.json`. Both packages lint their test files with `@vitest/eslint-plugin` (`no-focused-tests` **errors** — a committed `.only` can never silently shrink CI; `expect-expect`, `no-conditional-expect`, `no-standalone-expect` error; `no-disabled-tests` warns). Write new tests to the same standard: no type escapes, and a `.skip` needs a justification comment (see each README's *.skip-justification convention*). The backend now has ESLint too — `typescript-eslint` type-checked baseline on `src` + `test`, with `no-console` erroring in `src` (logger module exempt), mechanically enforcing the pino convention above.
- **TypeScript stays in lockstep across packages** (same major — currently `~6.0.x` in both `frontend` and `backend`). Bump them together and re-verify `typescript-eslint` compatibility; don't let the two halves diverge.
- **No new `!` (non-null assertion) without a justifying comment.** Prefer a narrowing guard, an early return, or a type derived from the net/contract layer. A genuinely-unavoidable assertion (e.g. a Phaser lifecycle guarantee) must carry a one-line comment saying why it's safe. Frontend **production (non-test) source under `src/`** is currently assertion-free — keep it that way. Test files are strict-typechecked too (unit tests via `tsconfig.test.json`, e2e via `tsconfig.e2e.json`): guaranteed test-harness values like `window.__testHook` use a throwing guard, not `!` — follow that pattern rather than reintroducing bare assertions.

# Backend test conventions

- Unit vs integration split: `npm test` (backend) must stay service-free; `npm run test:integration` requires Postgres + Redis (`docker compose up -d postgres redis`), uses Redis logical DB 1, and runs files sequentially.
- Testability seams: boot the real app via `createApp()`/`createServer()` (src/app.ts) on an ephemeral port — never call route/socket handlers directly; config assertions go through the pure `parseConfig(env)` (src/parse-config.ts); the migration runner takes an overridable migrations dir.
- Isolation: integration tests must never assume clean state — per-run usernames (deleted afterwards), `flushDb` on the dedicated Redis DB, and throwaway Postgres schemas for migration tests.

# Frontend game-logic conventions (scene-as-glue + pure modules)

- **Enforced convention for all new gameplay code (a direction, not a completed state):** game rules go in pure modules under `frontend/src/game/*.ts` (and `media/mediaLogic.ts`) — plain values in, plain values out, **no Phaser / net / DOM imports** — each landing with its vitest file in the same commit. `WorldScene.ts` is the orchestrator: asset/sprite/tilemap setup, Phaser+net event wiring, and per-frame calls into those modules. Putting *new* decision logic in the scene is a review smell — extract it. See `frontend/README.md` → *Scene-as-glue + pure modules* for the module map.
- Extracted and tested today: `movement`, `zones` (containment + room-exit detection), `seatDoor`, `interaction` (interact-key priority), `interpolation`, `throttle`, `proximity`, `interactables`, `maps` (game) and `mediaLogic` (media — room names, track attach/surface/detach routing, proximity volumes). Extend these rather than duplicating. **Known logic still in the scene** (extraction candidates — don't grow the list): locked-room position rollback, portal payload validation/teleport, Tiled object parsing, chat-bubble rendering, camera locate, world-info snapshot.
- The LiveKit split is transport (`livekit.ts`, thin, untested beyond types) vs logic (`mediaLogic.ts`, pure, tested); the transport's track handlers must route through `subscribeAction`/`unsubscribeAction` (`wireTrackRouting`) — no inline attach-vs-surface branches.
- Test style: table-driven / transition-matrix (incl. illegal transitions) for pure modules; React Testing Library + jsdom for React and the `App.tsx` media-transition chain — stub the Phaser canvas + heavy HUD children and assert media-manager calls + rendered HUD state, never Phaser internals or private fields. Everything runs in the single `npm test` (vitest/jsdom) step — no new pipeline stages.
- The `game/eventBus.ts` typed bus is the Phaser↔React contract seam (and the future E2E hook); assert scene→React interactions through it.

# E2E conventions (Playwright)

- The E2E suite lives in `frontend/e2e/` and runs chromium-only against the BUILT frontend (`vite preview`, port 4173) + the docker-composed backend stack. It is PR-blocking (`e2e` job in `frontend-ci.yml`). Full local-run recipe: `frontend/README.md` → *E2E tests (Playwright)*.
- **Assert through the bus hook + DOM HUD only.** `window.__testHook` (`frontend/src/e2e/testHook.ts`) exposes the event bus and minimal game state; it exists only in builds made with `VITE_E2E_HOOK=1` and must stay tree-shaken out of production bundles (CI greps the prod dist for `__testHook`). Never read pixels off the Phaser canvas, and never assert network internals already covered by the backend/smoke suites.
- **No arbitrary sleeps.** Every wait is a bus event or DOM condition (`waitForFunction` on hook state, `expect(locator)`). Movement waits ride the `positions` tick. If a scenario flakes, fix the wait condition — do not add sleeps or bump retries (CI retries stay at 1, local at 0).
- Scenarios run serially (`workers: 1`): all tests share live space "1", so parallel workers physically interfere. Each test signs up a fresh user (the room-key rate limit is per player+room, keeping tests isolated; the auth limiter is per-IP — restart the backend container if local iterating hits it).
- LiveKit assertions stop at "token fetched, connection attempted" with fake media devices (chromium flags in `playwright.config.ts`); media quality is out of scope.
- Map waypoints in `frontend/e2e/helpers.ts` are verified straight-line segments against the walls layer + solid furniture; re-verify against the map JSON when the maps change.
