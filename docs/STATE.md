# 2D Metaverse — State
> **hyprverse**: a private student social world with spatial media, meeting rooms, stage, arcade, and board tables. · Last checkpoint: 2026-08-08

## 🚧 In progress / next
- PR #174 (`feat/restore-white-snake`) merged as `3701d473` from head `21e6dec`; no active work remains from this session.
- Resume spec 27 tickets #165–#166 (`docs/specs/27-arcade-2.md`, parent #162). Parked: remaining PRD 25 frontier (#107, #117, #108, #118–#121, #124/#125, #127–#132).
- Next concrete step: choose the next queued spec-27 ticket or a new user task.

## Status
- PRD 25 batch landed (#138–#160); moderator dashboard (#161); arcade polish (#170); flappy dino-ramp (#171); arcade juice/Snake rework (#167); Stellar Forge merge-drop (#168); campus art + board UI + HUD polish (#172); stage mic consent + board error timer (#173).
- Production `main` tip is `3701d473` (squash of #174). Prior: #173 `f317144`, #172 `ae8a803`, #168 `4dd72c0`, #167 `f766ec1` — all squash-merged with green CI (incl. E2E). No force-push; no direct main commits.
- PR #174 merged with green exact-head CI: frontend build, backend tests, Docker integration, production image, and E2E all passed; merge commit `3701d473`.
- Board SFX interest gate: place/outcome cues only for seated (incl. forfeit leaver) or nearby table spectators — campus bystanders stay silent (`boardSound` + App seated/near refs).
- Stage Go Live mic consent: pre-live `micOn` captured; stop/walk-off re-mutes in `finally` when the player had not already unmuted for proximity.
- Snake review fixes: versioned score namespaces avoid migration races; pure frame scheduling handles queued instant turns; reduced-motion disables Snake interpolation/pulses and terminal delay; bonus geometry, tick-based comparable scoring, near-full-board food placement, and full terminal FX timing are covered by focused tests.
- Snake rollout hardening: current clients submit `snake-v2` scores while legacy `snake` remains accepted; scored boards are fixed at 34×18; `npm audit` is clean after the lockfile refresh.
- Parked follow-up (non-blocking Opus note): Go Live's implied unmute still persists to sessionStorage across reload — consider not persisting stage-only unmute.

## Architecture map
- Wire contracts and shared rules -> `shared/src/`
- Backend API, sockets, moderation, authority FSMs -> `backend/src/`
- Frontend React/Phaser/media/UI -> `frontend/src/`
- Arcade reducers -> `frontend/src/game/arcade/`; overlay/renderers -> `frontend/src/ui/arcade/`
- Board rules -> `shared/src/games/`; match lifecycle -> `backend/src/boardMatch.ts` + `board-manager.ts`; client sound -> `frontend/src/game/boardSound.ts`; HUD -> `frontend/src/ui/board/*` + `BoardTablePanel.tsx`
- Generated campus + geometry -> `frontend/scripts/gen_campus.py`; per-district art -> `frontend/scripts/campus_decor/<district>.py`
- Deploy and production operations -> `.github/workflows/`, `deploy/`

## Stack & run
- Stack: TypeScript strict npm workspaces, React + Phaser, Express + Socket.IO, Postgres/Redis/LiveKit.
- Run: `npm install` then `docker compose up --build`; mock frontend: `cd frontend && npm run dev`.
- Test: CI is authoritative. Do not run full local build/test suites; only focused touched-file tests are permitted.

## Key decisions (top 3–5)
- `@metaverse/shared` owns every wire shape; game rules stay pure seeded reducers; managers are side-effect shells (full log: `docs/decisions.md`).
- HUD follows the selected compact pixel-paper reference: integrated chat, attached command tray, wooden noticeboard map, bottom-centre media bar, and help inside Settings.
- Stage has one live session: explicit `Go Live` enables microphone audio; camera joins/leaves through the global control; user-facing state is `LIVE` / `NOT LIVE` (2026-08-01).
- Campus art lives in per-district `campus_decor/` modules; `gen_campus.py` remains the structural author; empty floor is intentional; presenter zone stays prop-free.
- Merge gate: exact-head CI green (incl. E2E) plus the current PR's unresolved-review verdict; full local suites prohibited on Raja's machine.

## Gotchas
- A solid prop body is bottom-anchored and extends above its authored tile. Connectivity is not enough: E2E helpers walk straight swept corridors, so map changes require the real E2E job.
- `WorldScene` draws a fallback room table only when no authored solid occupies the seat centroid; preserve that guard.
- Generated campus artifacts must come from `cd frontend && python3 scripts/gen_campus.py`, never hand edits.
- LimeZu art is non-commercial-license only; buy the paid pack before monetisation.
- BootScene furniture key regex in `maps.test.ts` must allow hyphens (`arcade_merge-drop`).
- Board `board-update` is space-scoped — always gate SFX on seated/nearby interest (`boardSound` + App refs).
- Codex cloud review limits are normally exhausted; PR #174 was merged after its final pushed head passed the required CI checks.
- Production backend currently reports SHA `09f39f0`; its `snake-v2` acceptance was staged before the #174 frontend switch merged.
