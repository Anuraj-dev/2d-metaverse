# 2D Metaverse — State
> **hyprverse**: a private student social world with spatial media, meeting rooms, stage, arcade, and board tables. · Last checkpoint: 2026-07-12

## 🚧 In progress / next
- ~~Production moderator configuration~~ **DONE 2026-07-12**: `MODERATOR_USER_IDS` set to the two operator-account UUIDs (chosen by Raja) in the box `.env`, synced to the `/metaverse/prod/env` SSM parameter (v6), and the compose env anchor now forwards the var (it previously silently dropped it). Backend recreated and healthy with the var live.
- Continue PRD 25 from the remaining frontier: #107, #117, #108, #118–#121, #124/#125, #127–#130, #131/#132. Re-evaluate dependencies against merged #138–#160 before starting.
- Non-blocking review follow-ups remain on the merged PRs: #148 stage go-live failure teardown, #152 invalid block target/cache eviction/whisper visibility, #153 report-to-action linkage, #156 reconnect re-anchor trust window, and deferred analytics hooks noted in PR bodies.

## Status
- **PRD 25 batch fully landed:** all 23 PRs #138–#160 are on `main`; final feature merge #160 is `39c22f3`, and final CI stabilization HEAD is `7a4186f`.
- Six stacked children that GitHub auto-closed (#146/#147/#148/#149/#150/#155) were landed as auditable local squash commits with the landing SHA commented on each PR. The nine surviving children were retargeted and merged without deleting parent branches mid-stack.
- Final campus generation was run after #140/#143/#150/#154; `campus.json` and `campus.geometry.json` exactly matched generated output.
- All 15 leftover feature branches were deleted from origin after every PR landed.
- Final Backend CI run `29179622916` is green (unit/typecheck/build, image, shell/alerter, Docker integration + smoke). Frontend CI run `29179463189` is green (lint/typecheck/unit/build/budget, Playwright E2E, Vercel deploy).
- Backend deploy run `29179669753` succeeded; `https://api.space.raja-dev.me/health/ready` reports `ok: true` at SHA `7a4186f`.

## Architecture map
- Wire contracts and shared rules -> `shared/src/`
- Backend API, sockets, moderation, authority FSMs -> `backend/src/`
- Frontend React/Phaser/media/UI -> `frontend/src/`
- Generated campus + geometry -> `frontend/scripts/gen_campus.py`, `frontend/public/assets/maps/campus.json`, `backend/assets/campus.geometry.json`
- Deploy and production operations -> `.github/workflows/`, `deploy/`
- Pilot design and implementation order -> `docs/specs/25-pilot-delivery.md`

## Stack & run
- Stack: TypeScript strict npm workspaces, React + Phaser, Express + Socket.IO, Postgres/Redis/LiveKit.
- Run: `npm install` then `docker compose up --build`; mock frontend: `cd frontend && npm run dev`.
- Test: CI is authoritative. Do not run full local build/test suites; only focused touched-file tests are permitted.

## Key decisions (top 3–5)
- `@metaverse/shared` owns every wire shape and shared runtime constant; consumers never redeclare contracts.
- Game rules and backend state transitions stay in pure modules; Phaser/socket handlers are side-effect shells.
- Server-authoritative geometry, movement, door/seat/board-seat proximity, and stage publishing now form one generated-manifest authority chain.
- Never delete a stacked base branch until every child is retargeted: GitHub closes children when their base disappears and may refuse reopening.
- Full local gates are prohibited on Raja's machine; GitHub CI is the verifier.

## Gotchas
- The prod compose `x-backend-environment` anchor must explicitly forward any new backend env var — `.env` values not listed there are silently dropped (this is how `MODERATOR_USER_IDS` was inert until 2026-07-12).
- The auth limiter is process/IP scoped; integration fixtures should use direct `createPlayer` except where REST auth itself is under test.
- Presence integration waits must match the intended player ID, not merely a people-count threshold; grace-timer occupants can linger.
- Generated campus artifacts must be regenerated with `cd frontend && python3 scripts/gen_campus.py`, never hand-merged.
- `gh pr edit --base` can fail on the deprecated Projects Classic GraphQL field; use `gh api repos/<owner>/<repo>/pulls/<n> -X PATCH -f base=main`.
