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
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc -b` |
| `npm test` | Vitest unit tests |
| `npm run build` | Typecheck + production build |
| `npm run size` | Bundle-budget check (gzipped entry chunk) |

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

### Scene-as-glue + pure modules (the enforced pattern)

`WorldScene.ts` is deliberately thin **glue**: it loads assets, builds the tilemap
and sprites, wires Phaser/net events, and each frame samples input/positions and
**delegates every decision to a pure module**. Nothing decision-shaped lives in the
scene. The pure modules take plain values in and return plain values out — **no
Phaser, net, or DOM imports** — so they run in millisecond-fast vitest with no game
boot:

| Module | Responsibility |
| --- | --- |
| `game/movement.ts` | input state → velocity / facing / moving flag |
| `game/zones.ts` | position → containing door / seat / room-area / stage |
| `game/seatDoor.ts` | sit/stand + door open/close state machines (with illegal transitions) |
| `game/interpolation.ts` | remote target → smoothed step + moving flag |
| `game/proximity.ts` | distance → spatial-audio volume |
| `game/interactables.ts` | Tiled objects → interactable defs + hit test |
| `media/mediaLogic.ts` | room-name builders, track routing, proximity-volume map |

The media layer mirrors this split: `media/livekit.ts` is the **transport**
(livekit-client connection plumbing — Room construction, connect/disconnect, event
wiring), and `media/mediaLogic.ts` holds the **decisions** (which room name to
request, what to attach vs surface, each remote's volume), tested against plain
fixtures.

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

### Backend contract (Socket.IO)

`join → init`, `move → player-moved`, `chat`, `room-enter → room-enter-result`,
`seat-sit / seat-stand → seat-update`. REST: `/api/v1/{signup,signin,space/:id,livekit/token}`.
LiveKit rooms: `world:<spaceId>` (mic-only, proximity) and `room:<roomId>` (cam+mic,
seat-gated). See `src/contract.ts`.

## CI

GitHub Actions runs typecheck, unit tests, and a production build on every push and PR.
