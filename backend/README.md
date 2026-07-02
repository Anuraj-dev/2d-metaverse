# 2D Metaverse backend

Node/TypeScript backend implementing the REST and Socket.IO contract in `plan.html`. PostgreSQL stores users and map metadata, Redis stores presence/seat state, and LiveKit supplies world audio and private-room audio/video.

## Run locally with Docker

From the repository root:

```bash
cp .env.example .env
docker compose up --build
```

The API and Socket.IO server are at `http://localhost:3001`; LiveKit signaling is at `ws://localhost:7880`. The setup container applies migrations and seeds space `1`, rooms `1`–`6`, their map coordinates, and their seats.

Default development room keys are `1234`, `4321`, `3333`, `4444`, `5555`, and `6666` for rooms 1–6. The auditorium stage uses a separate `STAGE_KEY` (dev default `stage-presenter-123`). Never use any of these defaults in production — production seeding refuses to run unless `ROOM_1_KEY` through `ROOM_6_KEY` are all set.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV`, `PORT` | Runtime mode and listen port. |
| `DATABASE_URL`, `REDIS_URL` | Postgres and Redis connection strings. |
| `JWT_SECRET`, `JWT_TTL` | Auth token signing secret and lifetime. |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins. |
| `LIVEKIT_URL`, `LIVEKIT_API_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit client URL, server-to-server URL, and credentials. |
| `ROOM_1_KEY` … `ROOM_6_KEY` | Join keys for the six private rooms (required in production). |
| `STAGE_KEY` | Presenter key for the auditorium stage broadcast. |
| `MAP_JSON_URL` | Path/URL the client loads the map from. |
| `TRUST_PROXY` | `true` behind the production Nginx proxy. |
| `GIT_SHA` | Build stamp surfaced in `/health/live` and `/health/ready` (baked into the image at build time). |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Consumed by the deploy watchdog/alerter, not the backend itself (see `deploy/README.md`). |

## Contract details

- REST routes exactly follow `/api/v1/signup`, `/signin`, `/space/:id`, and `/livekit/token`.
- Socket event names and payloads mirror `frontend/src/contract.ts`.
- LiveKit world room: `world:<spaceId>` (for example `world:1`). Tokens can publish microphone only.
- LiveKit private room: `room:<roomId>` (for example `room:1`). A private token is issued only while the caller owns a seat. Standing or disconnecting removes the participant from LiveKit.
- Socket.IO reconnect recovery has a four-second grace period so brief network changes do not create leave/join churn.

## Development without Docker for Node

Start PostgreSQL and Redis (Docker is fine), copy `backend/.env.example` to `backend/.env`, then:

```bash
cd backend
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Use `npm run typecheck`, `npm test`, and `npm run build` before deployment.

## AWS EC2 deployment requirements

Use an Elastic IP and DNS names such as `api.example.com` and `livekit.example.com`. Set production secrets in `.env`, including a random JWT secret, random LiveKit key/secret, and non-default room keys. Set `NODE_ENV=production`, `TRUST_PROXY=true`, `CORS_ORIGINS` to the frontend origin, `LIVEKIT_URL=wss://livekit.example.com`, and keep `LIVEKIT_API_URL=http://livekit:7880` for server-to-server cleanup.

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
