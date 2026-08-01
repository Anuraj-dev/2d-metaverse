# 2D Metaverse — State
> **hyprverse**: a private student social world with spatial media, meeting rooms, stage, arcade, and board tables. · Last checkpoint: 2026-08-01

## 🚧 In progress / next
- Campus art + HUD branch `art/hostel-room-proof` is reconciled with main after #167 and #168; next is push, open the campus/UI PR, exact-head Codex review, and green CI (incl. E2E) before squash-merge.
- Then resume spec 27 tickets #165–#166 (`docs/specs/27-arcade-2.md`, parent #162). Parked: remaining PRD 25 frontier (#107, #117, #108, #118–#121, #124/#125, #127–#132).

## Status
- PRD 25 batch landed (#138–#160); moderator dashboard (#161); arcade polish (#170); flappy dino-ramp (#171); arcade juice/Snake rework (#167); Stellar Forge merge-drop cabinet (#168).
- Production `main` includes #167 (`f766ec1`) and #168 (`4dd72c0`). Stellar Forge is live on main with pause/fullscreen, authoritative `newBest`, live shake/reduced-motion, and board foley preserved.
- Campus polish (local branch, reconciled): per-district `campus_decor/` decoration, curated LimeZu furniture, decluttered walkways/rooms, clear presenter platform, modern seating, Stellar Forge cabinet at (82,96), deterministic regenerated campus map/geometry.
- HUD polish: compact pixel-paper chat with slash-command discovery, thin themed scrollbar, independently collapsible muted/blocked management, cream speech bubble, wooden noticeboard fullscreen map, bottom-centre controls/help, consistent room/admin/chat surfaces.
- Stage: one presenter-only `Go Live` starts microphone audio; global camera adds/removes video on the same session; status is `LIVE` / `NOT LIVE`.
- Focused validation after main merge: frontend 185/185, backend stage+geometry 18/18, ESLint 0 errors (3 existing ChatBox hook warnings), emoji check, generator double-run deterministic, `git diff --check` clean. Full build/E2E delegated to GitHub CI.

## Architecture map
- Wire contracts and shared rules -> `shared/src/`
- Backend API, sockets, moderation, authority FSMs -> `backend/src/`
- Frontend React/Phaser/media/UI -> `frontend/src/`
- Arcade reducers -> `frontend/src/game/arcade/`; overlay/renderers -> `frontend/src/ui/arcade/`; board stack -> `shared/src/games/` + `backend/src/boardMatch.ts`/`board-manager.ts`
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
- Campus art lives in per-district `campus_decor/` modules; `gen_campus.py` remains the structural author; placement legality is enforced centrally. Stellar Forge cabinet is structural (gen_campus), not decor.
- Full local gates are prohibited on Raja's machine; current-head cloud review plus green GitHub CI (including E2E) are the merge gates.

## Gotchas
- A solid prop body is bottom-anchored and extends above its authored tile. Connectivity is not enough: E2E helpers walk straight swept corridors, so map changes require the real E2E job.
- `WorldScene` draws a fallback room table only when no authored solid occupies the seat centroid; preserve that guard.
- Generated campus artifacts must come from `cd frontend && python3 scripts/gen_campus.py`, never hand edits.
- LimeZu art is non-commercial-license only; buy the paid pack before monetisation.
- BootScene furniture key regex in `maps.test.ts` must allow hyphens (`arcade_merge-drop`).
- Entry bundle was 98.9/130 KB gzip at a prior strict-build checkpoint; new arcade code stays lazy-loaded.
