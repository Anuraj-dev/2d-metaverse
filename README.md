<p align="center">
  <img src="frontend/public/favicon.svg" alt="2D Metaverse icon" width="88" height="88" />
</p>

<h1 align="center">2D Metaverse</h1>

<p align="center">
  A pixel-art campus where you walk around, talk with people nearby, and join seated meetings.<br />
  The server holds the game state, and LiveKit carries the voice and video.
</p>

<p align="center">
  <a href="https://space.raja-dev.me/">Live app</a>
  ·
  <a href="#running-it">Run it locally</a>
  ·
  <a href="#documentation">Docs</a>
</p>

You walk the campus with the arrow keys or WASD. Voices fade out over 200 pixels and stop at room walls. To enter a private room, you knock at its door, and someone inside lets you in.

The frontend is React and Phaser. The backend is Express and Socket.IO, with Postgres for accounts and Redis for live state. You need Node 22 or newer and Docker. Running it locally needs no third-party API keys.

## What you get

- **Voices fade with distance and stop at walls.** Each player joins the `world:<spaceId>` LiveKit room with the microphone only. Volume drops in a straight line from full at zero distance to silent at 200 pixels. Each room interior is its own audio zone, built from the map's `roomBounds` layer, so people on the other side of a wall hear nothing.
- **Knock to enter a private room.** A knock works only from the room's door. The server checks your last accepted position, so a knock from across the map is refused. Each player gets 5 knocks per room per minute. An admin approves or denies the knock, and it expires after 30 seconds. An admin can also open the room to everyone.
- **Seated meetings with video and screen share.** To sit in a room seat, you must be in that room, hold its access grant, and stand near the seat. When two or more seated people share a room, a 3 second countdown starts, and then the meeting begins. The backend issues a LiveKit token for the `room:<roomId>` call only to seated members with access.
- **A stage that only the presenter can broadcast from.** The token for the `stage:<spaceId>` room allows publishing only when the server's last accepted position for you is inside the presenter zone. Everyone else gets a subscribe-only token.
- **Server-checked movement.** The server checks each move against your last accepted position. Moves that cover more ground than you could walk, leave the map, or cross a wall are rejected. Rejected moves are neither saved nor broadcast, and the client receives `move-correction` to snap back. The server accepts at most one move every 40 milliseconds.
- **Two-player board tables.** Tic-tac-toe and Connect 4 are played at seated tables, and the server holds each match. Both players must accept an offer before a match starts. Standing up during a match forfeits it. A disconnect counts as a stand after a grace window. The move rules live in `shared/src/games`, which the backend and frontend both import.
- **Arcade cabinets with personal bests.** Snake, Flappy and Merge Drop run in the browser. A finished game posts its score to `POST /api/v1/arcade/scores`, and the server keeps your best score per game for the leaderboard. Scores come from the client, so the server does not replay them.
- **Reports, blocks and moderator tools.** Players can report a chat line or block another player. Accounts listed in `MODERATOR_USER_IDS` can list and dismiss reports, warn players, and suspend or unsuspend them. A suspended player gets no LiveKit token, so suspension silences voice and video too.

## Running it

| Mode | What you run | What you get |
| --- | --- | --- |
| Full stack | `docker compose up --build` from the repo root | Real accounts, rooms, voice and video, with the API on `http://localhost:3001` |
| Frontend only | `npm run dev` in `frontend/` | Simulated players on `http://localhost:5173`, with no backend |

### Start the backend stack

```sh
cp .env.example .env
docker compose up --build
```

Compose starts Postgres 17, Redis 8 and LiveKit v1.9.12. A one-shot `setup` service runs the migrations and seeds space `1` with its rooms, seats and map. The backend starts only after setup succeeds, and it listens on `http://localhost:3001`.

### Start the frontend

```sh
npm install
npm run build:shared
cd frontend
npm run dev
```

Open `http://localhost:5173`. Without a `frontend/.env.local` file, the app runs in mock mode with simulated players, so the backend can stay off. To use the Docker backend, create `frontend/.env.local` with these two lines:

```ini
VITE_USE_MOCK=0
VITE_SERVER_URL=http://localhost:3001
```

### Checks

```sh
npm test           # builds shared, then runs the tests in all three workspaces
npm run typecheck  # builds shared, then typechecks all three workspaces
npm run lint
```

## Configuration

The backend reads its settings from the environment. `.env.example` holds working local values. Production refuses to start while any development secret from that file is still in use.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | required | Postgres connection string. |
| `REDIS_URL` | required | Redis for presence, seats, rate limits and board state. |
| `JWT_SECRET` | required, at least 32 characters | Signs login tokens. |
| `JWT_TTL` | `7d` | How long a login token lasts. |
| `LIVEKIT_URL` | required | LiveKit WebSocket address that browsers connect to. |
| `LIVEKIT_API_URL` | derived from `LIVEKIT_URL` | HTTP address the backend uses to manage LiveKit rooms. |
| `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` | required | Sign LiveKit access tokens. |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated origins allowed to call the API. |
| `MODERATOR_USER_IDS` | empty, so no moderators | Comma-separated user IDs, each a UUID, with moderation access. |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy so rate limits see client IPs. |
| `MAP_JSON_URL` | `/assets/maps/campus.json` | Map file recorded for space `1` when setup seeds it. |
| `LOG_LEVEL` | `info` | Set to `debug` for development. |

## How it fits together

Every Socket.IO payload and REST body is a zod schema in `shared/src`. The backend parses incoming data with those schemas. The frontend imports only inferred TypeScript types and a few constants, so a field mismatch fails the build instead of failing in production.

The server decides what is real. Presence, seats, room access and match state live in Redis, and only server handlers change them. The frontend draws what the server reports. The meeting start rules live in `backend/src/meeting.ts`, and the board match rules live in `backend/src/boardMatch.ts`. Each is a pure state machine, wrapped by a manager that handles timers and broadcasts.

Production runs the frontend on Vercel and the backend on one EC2 host with Docker Compose. See [deploy/README.md](deploy/README.md).

## Documentation

- [Backend](backend/README.md): the REST and Socket.IO API, and the Docker setup.
- [Frontend](frontend/README.md): scenes, the audio model, the arcade and board table modules, and scripts.
- [Deployment](deploy/README.md): production hosting and the deploy pipeline.
- [Conventions](docs/conventions.md): the stack, commands, and naming rules.
- [Asset credits](frontend/ATTRIBUTIONS.md): the source and license of each shipped asset.

## Contributing

Start with [docs/conventions.md](docs/conventions.md). Put any new payload shape in `shared/`, and never redeclare it in `backend/` or `frontend/`. Before you open a PR, run `npm test`, `npm run typecheck` and `npm run lint`.

## License

MIT. See [LICENSE](LICENSE).
