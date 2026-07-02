# 2D Metaverse — Frontend

A Gather/Zep-style 2D metaverse: walk around a styled office space, talk with
**proximity audio**, and enter **key-gated meeting rooms** with seats and in-room
**video calls** (webcam bubbles above your avatar).

Built with **React + Phaser 3 + Vite + TypeScript**. Real-time game state runs over
**Socket.IO**; audio/video over **LiveKit**.

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
```

In **development**, the app runs in **mock mode** (`VITE_USE_MOCK=1`) — fully
standalone with simulated players, so no backend is needed. To use the real backend:

```bash
cp .env.example .env.local
# set VITE_USE_MOCK=0 and VITE_SERVER_URL=http://localhost:3001
```

## Production / hosting (Vercel etc.)

Mock mode is **development-only**. A production build ignores `VITE_USE_MOCK` and
**requires** a backend URL — without it the app shows a clear "Misconfigured"
screen instead of simulating a world. Hosting must set:

```
VITE_USE_MOCK=0
VITE_SERVER_URL=https://api.example.com
```

The JWT travels in the Socket.IO **handshake** (`auth: { token }`); `join` carries
only `{ spaceId }`. A `connect_error` (e.g. a rejected token) returns the player to
sign-in.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run lint` | ESLint (app + tests; `@vitest/eslint-plugin` rules on `src/**/*.test.ts(x)`) |
| `npm run typecheck` | `tsc -b` — app, node, **e2e, and unit tests** (`tsconfig.test.json`) |
| `npm test` | Vitest unit tests |
| `npm run build` | Typecheck + production build |
| `npm run size` | Bundle-budget check (gzipped entry chunk) |

Root convenience: from the repo root, `npm run lint` / `npm run typecheck` /
`npm test` run the frontend and backend commands back to back (root `package.json`).

## Type safety (strict baseline)

Every frontend tsconfig project (`app`, `node`, `e2e`) compiles under the **same
strict contract as the backend**: `strict`, `noUncheckedIndexedAccess`, and
`exactOptionalPropertyTypes` are all on. `tsc -b` gates the build, so a missing
tile/frame/record lookup or an unannotated parameter is a **compile error**, not a
runtime surprise. Keep it that way — never relax a flag or add a laxer tsconfig
(see the repo-wide standard in the root `CLAUDE.md`).

**No new `!` without justification.** Non-null assertions (`x!`) are a review smell:
prefer a narrowing guard, an early return, or a schema-derived type. The rare
genuinely-unavoidable assertion (e.g. a Phaser lifecycle guarantee) must carry a
comment explaining why it is safe. Frontend **production (non-test) source under
`src/` currently has zero non-null assertions**. Test files are strict-typechecked
too — unit tests via `tsconfig.test.json` (folded into `tsc -b`), e2e specs via
`tsconfig.e2e.json` — so they get the same treatment: prefer a narrowing guard, and
for guaranteed test-harness values like `window.__testHook` use a helper that throws
descriptively rather than a bare `!`.

### Test linting (`@vitest/eslint-plugin`)

`npm run lint` runs vitest hygiene rules over `src/**/*.test.ts(x)`:
`no-focused-tests` (**error** — a committed `.only` can never silently shrink CI),
`expect-expect`, `no-conditional-expect`, `no-standalone-expect` (errors), and
`no-disabled-tests` (**warn**). **`.skip`-justification convention:** a skipped test
must carry a comment on the line above saying *why* and *when it comes back* (e.g.
`// SKIP: flaky under jsdom timers — re-enable after #123`), so disabled tests are
visible debts, not invisible ones.

**Required-loud vs optional-soft.** When a strict-mode `| undefined`/`| null`
forces a decision, classify the value first:

- **Required** (the app is invalid without it — a map's declared tilesets, the
  `ground`/`walls` layers, the `#root` element): validate it and **throw a
  descriptive error**. Refusing to build an invalid world beats limping along in a
  silently broken one (e.g. tolerating a missing `walls` layer would let players
  walk through every wall with no signal).
- **Optional** (the app is fully functional without it — decor layers, a nearby
  interactable, a keyboard in a headless config): use a soft guard (`if`, `?.`,
  `??` fallback) and degrade gracefully.

Never use a soft guard to swallow a required-asset failure.

## Controls

- **WASD / arrows** — move
- Walk to a meeting-room door → enter the room **key**
- Step onto a chair → **E** to sit / stand
- Mic & camera toggles appear while seated

## Architecture

```
src/
├── game/          Phaser scene (glue) + pure game-logic modules, avatar anims, event bus
├── net/           Socket.IO client + a standalone mock (VITE_USE_MOCK)
├── media/         LiveKit transport (livekit.ts) + pure media logic (mediaLogic.ts)
├── ui/            React HUD: chat, room-key modal, video bubbles, media controls
└── contract.ts    Shared event/payload types the backend mirrors
```

### Scene-as-glue + pure modules (the enforced convention)

The direction is **scene-as-glue**: game rules live in pure modules — plain values
in, plain values out, **no Phaser, net, or DOM imports** — so they run in
millisecond-fast vitest with no game boot, and `WorldScene.ts` orchestrates them
(asset loading, tilemap/sprite creation, Phaser + net event wiring, per-frame calls
into the modules).

**Extracted and tested today:**

| Module | Responsibility |
| --- | --- |
| `game/movement.ts` | input state → velocity / facing / moving flag |
| `game/zones.ts` | position → door / seat / room-area / stage containment + room-exit detection |
| `game/seatDoor.ts` | sit/stand + door open/close state machines (with illegal transitions) |
| `game/interaction.ts` | interact-key priority: stand > interact > sit |
| `game/interpolation.ts` | remote target → smoothed step + moving flag |
| `game/throttle.ts` | move-send / positions-emit cadence |
| `game/proximity.ts` | distance → spatial-audio volume |
| `game/interactables.ts` | Tiled objects → interactable defs + hit test |
| `media/mediaLogic.ts` | room-name builders, track attach/surface/detach routing, proximity-volume map |

**Still living in the scene** (not yet extracted — fair game for future PRDs):
locked-room position rollback (`keepLockedRoomsClosed`), portal payload validation
and teleporting (`triggerInteractable`), Tiled object-layer parsing for
doors/seats/furniture (`parseObjects`), chat-bubble/nameplate rendering, camera
`locate` panning, and the minimap `world-info` snapshot. The scene is still large;
the convention constrains where *new* logic goes — it doesn't claim the extraction
is finished.

The media layer splits the same way: `media/livekit.ts` is the **transport**
(livekit-client connection plumbing — Room construction, connect/disconnect, event
wiring), and `media/mediaLogic.ts` holds the **decisions**. The transport's
subscribe/unsubscribe handlers route through `subscribeAction`/`unsubscribeAction`
(via the single `wireTrackRouting` helper), so the unit tests exercise the same
values the handlers consume.

The React↔Phaser boundary is the typed `game/eventBus.ts`; App-shell media
sequencing (`App.tsx`) is covered with React Testing Library + jsdom.

**Where new game logic goes:** any new gameplay rule (audio zones, portal triggers,
mini-game rules, …) is written as a pure module with its tests, and the scene only
gains a call site. "Logic in the scene" is a review smell — put it in a pure module.

### Tests

All tests run in a single vitest step (jsdom) — no extra pipeline stages.

```bash
npm test          # run once
npm run test:watch
```

Pure modules use plain vitest (table-driven / transition-matrix style; see
`movement.test.ts`, `seatDoor.test.ts`). Component/app-shell tests use React
Testing Library, stub the Phaser canvas + heavy children, and assert media-manager
calls and rendered HUD state — never Phaser internals or private fields.

### E2E tests (Playwright)

The E2E suite (`e2e/*.spec.ts`) drives the **built** frontend in real Chromium
against the docker-composed backend stack — real signup, real sockets, real
map, real doors. It is the PR-blocking `e2e` job in `frontend-ci.yml` and the
named regression net for the "doors broken in prod" incident class.

**Run locally** (from the repo root, then `frontend/`):

```bash
# 1. Boot the backend stack (CORS must allow the preview origin)
CORS_ORIGINS=http://localhost:5173,http://localhost:4173 \
GIT_SHA=$(git rev-parse HEAD) docker compose up -d --build

# 2. Build the frontend with the test hook + matching SHA
cd frontend
VITE_E2E_HOOK=1 VITE_USE_MOCK=0 VITE_SERVER_URL=http://localhost:3001 \
VITE_GIT_SHA=$(git rev-parse HEAD) npm run build

# 3. Run the suite (starts `vite preview` on :4173 itself)
npm run e2e          # headless
npm run e2e:headed   # watch the browser live
```

Notes for local runs: `GIT_SHA`/`VITE_GIT_SHA` must be the same commit or the
version-compat scenario will (correctly) fail; the backend's per-IP auth
limiter allows 40 signup/signin calls per 15 min, so after several full runs
`docker compose restart backend` resets it. Tear down with
`docker compose down -v` when done.

**How the test hook works.** `src/e2e/testHook.ts` exposes the event bus and
minimal game state (`nearDoor`, `nearSeat`, `currentRoomId`, `seated`, latest
`positions`/`world-info` payloads, a bounded event log, and `waitForEvent`) on
`window.__testHook`. It is only imported behind `import.meta.env.VITE_E2E_HOOK
=== "1"` in `main.tsx`; that flag is statically replaced at build time, so
production builds tree-shake the module out entirely. CI asserts the prod
bundle contains no `__testHook` (see the "Assert prod bundle has no E2E hook"
step), and the suite's global setup refuses to run against a hook-less build.

**Assertion policy.** Game state is asserted through the bus hook and the DOM
HUD (chat transcript, modals, Settings SHA) — never by reading pixels off the
Phaser canvas. Movement is driven by keyboard events and by steering
`move-axis` off `positions` ticks (`walkTo` in `e2e/helpers.ts`), with
waypoints verified against the map's collision data.

**Flake policy.** No arbitrary sleeps — every wait is a bus event or DOM
condition (`waitForFunction` on hook state, `expect(locator)` on the HUD).
Scenarios run serially (one shared live world). CI retries: 1, failures still
reported; local retries: 0 so a flaky wait fails loudly and gets fixed, not
retried away. If a scenario flakes, fix the wait condition — do not add
sleeps or retries.

**Artifacts.** On failure Playwright keeps traces + screenshots under
`frontend/test-results/` (and an HTML report in `frontend/playwright-report/`
in CI); the CI job uploads both as the `playwright-artifacts` artifact. View a
trace with `npx playwright show-trace <path to trace.zip>`.

### Backend contract (Socket.IO)

`join → init`, `move → player-moved`, `chat`, `room-enter → room-enter-result`,
`seat-sit / seat-stand → seat-update`. REST: `/api/v1/{signup,signin,space/:id,livekit/token}`.
LiveKit rooms: `world:<spaceId>` (mic-only, proximity) and `room:<roomId>` (cam+mic,
seat-gated). See `src/contract.ts`.

## CI

GitHub Actions runs lint, typecheck, unit tests, a production build (with a
bundle budget and a no-test-hook assertion), and the Playwright E2E suite
against the composed backend stack on every push and PR.
