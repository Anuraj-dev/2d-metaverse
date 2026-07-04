# 2D Metaverse — Frontend

A Gather/Zep-style 2D metaverse: walk around a styled office space, talk with
**proximity audio**, and enter **key-gated meeting rooms** with seats and in-room
**video calls** (webcam bubbles above your avatar).

Built with **React + Phaser 3 + Vite + TypeScript**. Real-time game state runs over
**Socket.IO**; audio/video over **LiveKit**.

## Run locally

This is one workspace of an npm-workspaces monorepo. Install once from the repo
root and build the shared contract package before running:

```bash
npm install          # from the repo root — installs all workspaces
npm run build:shared # build @metaverse/shared (the frontend imports its types)
cd frontend
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
`npm test` run every workspace (shared, backend, frontend) — the typecheck/test
scripts build `@metaverse/shared` first (root `package.json`).

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
└── ui/            React HUD: chat, room admin/knock panel, video bubbles, media controls
```

Wire types (`Dir`, `PlayerState`, `ChatMessage`, `SpaceInfo`, …) and event-name /
limit constants come from the **`@metaverse/shared`** workspace package — the single
source of truth the backend validates against. There is no local `contract.ts`; the
frontend imports types (erased at build) and a few runtime constants from
`@metaverse/shared`.

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
| `game/proximity.ts` | distance → spatial-audio volume (falloff curve) |
| `game/audioZones.ts` | room rects → audio zones; (my zone, their zone, distance) → volume |
| `game/interactables.ts` | Tiled objects → interactable defs + hit test |
| `game/meetingUi.ts` | server meeting-lifecycle events → client meeting state + portal-in/out actions |
| `game/portalHandoff.ts` | Phase A/B portal handoff (reveal exactly once, either completion order) |
| `game/portalCinematic.ts` | Phase A generation guard + effect-injected sequence driver (`runPortalCinematic`): which async cinematic callbacks may still capture/finish/sleep, and the zoom→capture→finish wiring |
| `media/mediaLogic.ts` | room-name builders, track attach/surface/detach routing, zone-aware proximity-volume map |
| `media/soundMixer.ts` | channel gain math (master over music/sfx/ambient), master mute, ambient duck near voice, event→sound mapping, footstep cadence |
| `game/dayNight.ts` | hour-of-day → day/night tint colour + alpha (keyframed) |
| `game/arcade/prng.ts` | seeded mulberry32 PRNG (deterministic, serializable seed) |
| `game/arcade/snake.ts` | Snake tick/turn/eat/collision rules |
| `game/arcade/flappy.ts` | Flappy gravity/flap/pipe/collision rules |
| `game/arcade/game2048.ts` | 2048 slide+merge semantics (incl. no-move detection) |
| `game/boardTable.ts` | board-table view model: snapshot + selfId → grid/whose-turn/offer/spectator/status + click→move (rules themselves live in `@metaverse/shared`) |

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

### Audio model (proximity + zone isolation)

World voice is **proximity audio gated by zone** — you hear a nearby player only if
you share an *audio zone*.

- **Falloff** (`game/proximity.ts`): within a zone, volume scales linearly from `1`
  (touching) to `0` at the `AUDIO_CUTOFF` (200px) distance. Unchanged from before.
- **Zones** (`game/audioZones.ts`): each room interior is a named zone whose identity
  is the existing `roomId`; everything outside every room is the single `OUTDOOR_ZONE`.
  Zones are **derived at load time from the map's `roomBounds` rectangles**
  (`roomAreasFromObjects`) — the same rectangles the scene uses for room-entry
  detection, so there is *no second source of truth*: adding a room to a map's
  `roomBounds` layer auto-creates its audio zone.
- **The rule** (`zoneVolume`): volume is `0` across different zones and the normal
  falloff within a shared zone. It **composes with** the falloff — it gates, it does
  not replace it. Doorways are a **binary, immediate cutover at the threshold**: no
  muffling or attenuation-through-walls, so the world's audio feels physical.
- **Wiring**: each client derives its own and every remote's zone locally from the
  already-broadcast positions (the scene stamps a `zone` onto each player in the
  `positions` payload). `mediaLogic.computeVolumes` then prices each subscribed remote
  with `zoneVolume`, and `livekit.ts` applies it to the `<audio>` elements. There is
  **no wire-format change and no new per-frame network traffic** — positions are
  already shared, and the server is not involved.
- Seated meetings are a separate, already-watertight path (a per-room LiveKit room with
  seat-gated tokens); this model governs only the open-world proximity layer.

**Trust model (v1).** Zone enforcement is **client-side**: each client mutes remotes
outside its zone locally. A modified client could ignore the volume it's told to apply
and still listen to a room it's standing outside of — the raw mic track is still
subscribed. This is an accepted v1 tradeoff (it needs no server or LiveKit topology
changes and adds zero latency). **Phase-2 privacy upgrade** (named, not built): move to
**server-enforced isolation** — the backend swaps a player between LiveKit rooms at
doorway crossings so the outside client never receives the track at all. Adopt it if the
client-trust caveat becomes unacceptable.

### Sound + polish pipeline (art & audio direction)

Graphics and audio polish (PRD 12) follow the same **pure-logic + thin-glue**
split, and every shipped asset is registered for licensing.

**Art & audio direction (keep style cohesion).** Top-down pixel art in the
current **Pipoya-compatible** family — no resolution/HD re-theme, no avatar
redraws. Furniture is a cohesive cool office palette; tilesets are re-skinned or
enriched, never re-laid-out (map coordinates, collision rects, `roomBounds` and
seats are preserved, and `game/maps.test.ts` cross-checks every tileset against
its on-disk PNG). Reject a style-mismatched asset rather than blending it. Audio
bar: **fewer, better, normalized** clips — no filler.

*Pack evaluations (PRD 12 fix round 1):* **LimeZu Modern Interiors** was
evaluated and **rejected** — outline-less pastel-gradient rendering that clashes
with the flat-outlined Pipoya family (documented so it isn't re-litigated).
**Serene Village** is style-compatible (same outline/dither language) and
remains an approved future source, but the current enrichment ships entirely
from the already-attributed families: the Pipoya exterior sheet (grass
variants, flowers, stone plaza family, trees) and Top-Down Retro Interior
(door frame/leaf recomposed by `scripts/gen_door.py`).

**Sound architecture.** All gain/mute/duck/mapping *decisions* live in the pure
`media/soundMixer.ts` (channels `master → music / sfx / ambient`, master mute,
ambient ducking near voice, the event→sound table, footstep cadence) with
`soundMixer.test.ts` exercising them, playback mocked. `media/sfx.ts` is the thin
HTMLAudio glue: it plays one-shots at the mixer-computed gain, owns the music +
ambient loops, and handles browser **autoplay-unlock** (silent until the first
user gesture, `play()` rejections swallowed). `ui/SfxBridge.tsx` is headless
wiring: it maps net/bus events (presence, seat, door, portal, meeting) to clips
via the pure table, derives footsteps from the `positions` tick, and ducks the
ambient bed against LiveKit voice levels (`audio-volumes` is emitted on every
positions tick in production, not just under the E2E hook). The world loops are
**lifecycle-aware** (pure decisions in `loopTargets`): the outdoor ambience only
sounds while the local player's audio zone is outdoor, both loops fall silent
across a meeting (portal-in → portal-out), and every transition — duck, zone
crossing, meeting, sliders — **fades** (`fadeStep`, ~700ms) rather than
hard-cutting. Volumes persist through the existing
`ui/settings.ts` store; the Settings panel exposes master/music/effects/ambient
sliders + mute. **Game logic stays audio-agnostic** — it emits domain events; the
bridge decides what they sound like.

**Engine-side ambience is code, not assets** (`game/dayNight.ts` + WorldScene):
a camera-locked day/night tint driven by the local clock, drifting ambient motes
(particle emitter), and a slow foliage sway (tween). Layer these over tiles
before reaching for new art.

**Adding an asset.**

1. **Curate, don't bulk-import.** Extract source packs to a scratch dir, pick
   only the sheets/clips you use, and reject anything off-style.
2. **Optimize.** Sprites: pack/trim, keep PNGs small. Audio: transcode to Ogg
   Vorbis (`scripts/curate_audio.py` regenerates the whole soundscape from the
   owner-supplied Cozy pack — every event SFX is cut from real recorded
   material at documented timestamps, layered/filtered, peak-normalized; no
   synthesis). Keep loops short and seamless.
3. **Register attribution.** Add a row to **`ATTRIBUTIONS.md`** (asset → source →
   author → license). This is **required** — an unattributed asset must not ship.
4. **Wire it.** Tilesets go through the `maps.ts` registry (and are auto-checked
   by `maps.test.ts`); sounds are one row in `soundMixer.ts`' event table + a
   file under `public/assets/audio/`.
5. **Budget.** The CI bundle gate (`npm run size`) measures the **gzipped entry
   JS chunk**, not `public/` assets — but keep audio/art lean anyway for load
   time. If code polish ever pushes the entry chunk near the budget, raise it
   *consciously* in `scripts/bundle-budget.mjs` with a justifying comment, never
   silently.

### Meetings (portal transition + Meet-style grid)

Sitting down together turns a room into a meeting — no button hunt.

**Lifecycle rules** (authoritative: the pure trigger state machine
`backend/src/meeting.ts`, referenced from the root `CLAUDE.md` — the frontend
never re-derives them):

- The meeting starts when **every player inside the room zone is seated AND
  at least 2 are seated**. A solo sitter keeps today's behavior — no portal.
- Reaching that state starts a **cancelable ~3s countdown** ("Meeting
  starting…", stand up to abort). It cancels if anyone stands or enters the
  room unseated, and re-arms when the condition holds again.
- A **latecomer** who sits mid-meeting gets their own solo portal and joins in
  place. A participant who **stands (or clicks Leave, or drops past the
  reconnect grace)** portals out alone while the meeting continues; the **last
  leaver ends the meeting**.
- The server broadcasts the lifecycle room-scoped (`meeting-countdown`,
  `meeting-countdown-canceled`, `meeting-started`, `meeting-ended`,
  `meeting-participant-joined/-left` — shapes in `@metaverse/shared`);
  `game/meetingUi.ts` reduces them to what *this* client shows and does.

**Two-phase portal transition**, orchestrated by App's media-transition
sequencer:

- **Phase A (Phaser, `WorldScene.portalIn`)**: camera punch-in
  (`ZOOM × 2.4` over ~350ms) + slow fade toward the table, then ONE canvas
  frame is captured at the portal peak and the scene **sleeps**.
- **Phase B (React, `ui/MeetingOverlay.tsx`)**: a motion warp-burst expands
  from the seat and covers the viewport, then cross-fades into the grid.
- The pure handoff machine (`game/portalHandoff.ts`) reveals the grid exactly
  once, only when BOTH phases signalled — no gap and no double-flash whichever
  side finishes first. Phase A is an awaitable, cancelable sequencer operation:
  the queued op holds the media queue until the cinematic completes or a
  portal-out cancels it, and WorldScene's portal-generation guard makes an
  abandoned cinematic's callbacks inert (never a late snapshot or a late
  `scene.sleep()` after the player already left). The self seat morphs into the self tile via a motion
  `layoutId` for spatial continuity.

**Meet surface** (`ui/MeetingGrid.tsx`): LiveKit's React components
(`GridLayout`/`ParticipantTile`/`VideoTrack`) — not raw `<video>` elements —
give responsive tiles, active-speaker emphasis and screen-share tiles. The
custom tile adds username nameplates and, when a camera is off (or media is
unavailable entirely), the participant's **in-game pixel sprite**
(`ui/PixelAvatar.tsx`, same deterministic `charForPlayer` mapping the world
uses). Media routing is unchanged: the grid **upgrades the existing seat-gated
per-room LiveKit connection** (`media/livekit.ts` `roomVideo`) — no new token
semantics; with no media the grid falls back to roster-only tiles. The heavy
meeting chunk (motion + LiveKit components) is lazy-loaded so the entry bundle
stays inside its budget.

**Resource policy**: the captured frame — blurred + darkened — IS the world
for the meeting's duration; the Phaser scene is asleep (no render loop), so an
hour-long meeting doesn't cook a laptop. With `update()` stopped, socket
movement emission pauses too (the Socket.IO transport heartbeat keeps the
connection alive); world audio is already disconnected while seated. Portal-out
wakes the scene, resets the camera, and restores everything. A socket blip
during a meeting reconnects within the seat-grace window and the client stays
in the meeting — a blip never ejects you to the world.

### Arcade cabinets (mini-games, PRD 11)

Solid arcade cabinets stand in the campus plaza. Walking next to one shows the
usual interact hint; pressing **E** opens a full-screen overlay hosting the
game. The world scene **sleeps** underneath (the same pattern meetings use) and
**Escape** closes instantly. The overlay pauses the game when the tab loses
visibility or the window loses focus, and it takes keyboard focus robustly on
open (blurring any lingering input — e.g. the chat field — so its focus
can't swallow the game's keys via the scene's `isTyping` guard).

**Architecture — pure rules, thin renderers, audio-agnostic:**

- **Rules** live in pure modules under `src/game/arcade/` — `snake.ts`,
  `flappy.ts`, `game2048.ts`, plus a seeded PRNG (`prng.ts`). Plain values in,
  plain values out; no Phaser/net/DOM imports. Randomness flows through the
  serializable `rngSeed` in each state, so *a given seed + input script always
  reproduces a run* (asserted by determinism tests). Each module lands with its
  vitest file in the same commit.
- **Renderers** are thin React components (`src/ui/arcade/`): one per game, they
  own a canvas/DOM surface, run the module's tick/reduce on a loop, draw the
  returned state, and report score/game-over upward. No game *rules* in a
  renderer or the scene. The overlay (`ArcadeOverlay.tsx`) and its game modules
  are **lazy-loaded** — a separate chunk, so snake/flappy/2048 never bloat the
  entry bundle.
- **Sound stays out of game logic:** games emit domain events on `eventBus`
  (`arcade-point`, `arcade-over`, `arcade-flap`); `open-arcade` opens the
  overlay. The sound mixer's event→clip table decides the blip (see *Sound +
  polish pipeline*) — the games never touch audio.
- **High scores** are one REST resource (`/api/v1/arcade/scores`), shapes in
  `@metaverse/shared`. The overlay shows your best + a top-N leaderboard per
  cabinet. **Scores are client-reported and trusted at this level** — there is
  no server-side play validation, so the leaderboard is best treated as
  cosmetic; hardening (server replay/authoritative sim) is out of scope for
  Phase 1.

**To add a new arcade game** (module contract): create `src/game/arcade/<game>.ts`
exporting `init<Game>(seed) → State`, a per-tick/per-input reducer
(`<game>Tick`/`<game>Input`/`move<Game>`) that is pure and deterministic given
`rngSeed`, plus its `.test.ts` (transition table + a determinism test). Add the
id to `ARCADE_GAMES` in `@metaverse/shared`. Write a thin renderer in
`src/ui/arcade/` implementing `ArcadeGameProps` (`seed`, `paused`, `onScore`,
`onGameOver`) and register it in `ArcadeOverlay`'s `GAMES` map. Place a cabinet
by editing `scripts/gen_campus.py` (a solid `furn(...)` sprite + an
`interactType="arcade"` interactable carrying a `game` payload) and regenerate
the map — never hand-edit `campus.json`. Add a cabinet sprite via
`scripts/gen_arcade_sprites.py` (+ BootScene key + an ATTRIBUTIONS row).

### Board-game tables (two-player, server-authoritative, PRD 11 phase 2)

Two board-game tables (tic-tac-toe, Connect-4) sit in the SW campus plaza. Each
has two opposite seats: walk up to a seat and press **E** to sit down. Once both
seats are taken, each player gets a **match offer** — click *Accept match* in the
HUD panel; when both accept, the match starts. Click a cell (tic-tac-toe) or a
column (Connect-4) on your turn to play. Standing up (or disconnecting) forfeits
a live match to the opponent. Passers-by who walk up to a table in progress see
the same board panel read-only (spectating). The world does **not** sleep — you
stay seated in-world while the panel floats over the HUD.

Unlike the arcade cabinets, board tables are **two-player and server-authoritative**:

- **Rules are ONE pure implementation in `@metaverse/shared`** (`games/board.ts`,
  `ticTacToe.ts`, `connect4.ts`, `rules.ts`) — imported by both the backend
  (validation) and this frontend (rendering + click→move). Plain values in/out,
  deterministic, no deps. The backend is authoritative; the client is never
  trusted for the board.
- **The match lifecycle** is a pure state machine on the backend
  (`backend/src/boardMatch.ts`) + a side-effect shell (`board-manager.ts`), modeled
  on the meeting machine. The server broadcasts an authoritative `board-update`
  snapshot on every change and rejects illegal/out-of-turn moves with a typed
  `board-error`.
- **Seats reuse the sit mechanics but are their own map layer** (`board_seats`) and
  `WorldScene.boardSeats` array — public plaza seats, ungated by room entry, so they
  never trigger meetings or the minimap room list. The scene emits `near-board-seat`
  / `board-sat` / `board-stood` on the bus; `App.tsx` keeps the per-table snapshots
  and renders the lazy `ui/BoardTablePanel.tsx`.
- **Client-side decisions** (view model, whose turn, offer prompt, spectator display,
  grid click → move index) live in the pure `game/boardTable.ts` (+ vitest). Sounds
  go through the `soundMixer` event→clip table (`board-sat`/`board-move`/`board-win`).

**Test coverage.** Board rules are covered exhaustively by the shared-package unit
tests (`shared/src/games/*.test.ts`) and the match lifecycle by the backend socket-seam
integration tests. There is **no board-table Playwright E2E**: the phase-2 scenario
drove two avatars from the shared spawn to opposite plaza seats, and that in-world
navigation was persistently CI-flaky (damped `walkTo` stalling short of the tight seat
rects under two-Phaser-loop CPU contention) with no reliable no-sleep wait — so it was
dropped rather than papered over with sleeps/retries. Re-add it only with a robust,
event-driven seat approach.

**To add a new board-game table:** (1) add the pure rules in `shared/src/games/`
(`create`/`applyMove`/win/draw + exhaustive `*.test.ts`), register the game id in
`BOARD_GAMES` and wire it into `rulesFor`; (2) add the table to the `BOARD_TABLES`
registry in `shared/src/constants.ts` (id + game) and to the `board-update` grid
sizing in `game/boardTable.ts`; (3) author its two opposite seats + solid table
sprite in `scripts/gen_campus.py` (`board_table(...)`), regenerate the map, and
extend the board-tables assertions in `game/maps.test.ts`; (4) the socket events,
manager, and panel are game-agnostic — no changes needed there.

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
`seat-sit / seat-stand → seat-update` (+ room-scoped meeting lifecycle:
`meeting-countdown`, `meeting-countdown-canceled`, `meeting-started`,
`meeting-ended`, `meeting-participant-joined/-left`).
REST: `/api/v1/{signup,signin,space/:id,livekit/token}`.
LiveKit rooms: `world:<spaceId>` (mic-only, proximity) and `room:<roomId>` (cam+mic,
seat-gated). Event names and payload shapes are defined in `@metaverse/shared`.

## CI

GitHub Actions runs lint, typecheck, unit tests, a production build (with a
bundle budget and a no-test-hook assertion), and the Playwright E2E suite
against the composed backend stack on every push and PR.
