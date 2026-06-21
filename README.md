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

By default the app runs in **mock mode** (`VITE_USE_MOCK=1`) — fully standalone with
simulated players, so no backend is needed. To use the real backend:

```bash
cp .env.example .env.local
# set VITE_USE_MOCK=0 and VITE_SERVER_URL=http://localhost:3001
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run typecheck` | `tsc -b` |
| `npm test` | Vitest unit tests |
| `npm run build` | Typecheck + production build |

## Controls

- **WASD / arrows** — move
- Walk to a meeting-room door → enter the room **key**
- Step onto a chair → **E** to sit / stand
- Mic & camera toggles appear while seated

## Architecture

```
src/
├── game/          Phaser scenes, avatar anims, proximity math, event bus
├── net/           Socket.IO client + a standalone mock (VITE_USE_MOCK)
├── media/         LiveKit world audio (proximity) + room video; local camera
├── ui/            React HUD: chat, room-key modal, video bubbles, media controls
└── contract.ts    Shared event/payload types the backend mirrors
```

### Backend contract (Socket.IO)

`join → init`, `move → player-moved`, `chat`, `room-enter → room-enter-result`,
`seat-sit / seat-stand → seat-update`. REST: `/api/v1/{signup,signin,space/:id,livekit/token}`.
LiveKit rooms: `world:<spaceId>` (mic-only, proximity) and `room:<roomId>` (cam+mic,
seat-gated). See `src/contract.ts`.

## CI

GitHub Actions runs typecheck, unit tests, and a production build on every push and PR.
