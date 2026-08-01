# 2D Metaverse — State
> **hyprverse**: a private student social world with spatial media, meeting rooms, stage, arcade, and board tables. · Last checkpoint: 2026-08-01

## 🚧 In progress / next
- Campus art restyle and the approved pixel-paper HUD are implemented locally on `art/hostel-room-proof`, with the final dirty changes not yet committed or pushed.
- Two older Arcade 2.0 PRs are banked and now conflict with `main`: #167 first, then #168. A separate conflict worker is merging current `main` into #167; #168 must wait because the branches overlap arcade/media surfaces.
- After #167 and #168 are reviewed, green, and merged: merge updated `main` into `art/hostel-room-proof`, resolve its generator/map overlap, push, open the campus/UI PR, request cloud Codex review, and merge only after current-head review plus all required CI including E2E.
- Then resume spec 27 tickets #165–#166 (`docs/specs/27-arcade-2.md`, parent #162). Parked: remaining PRD 25 frontier (#107, #117, #108, #118–#121, #124/#125, #127–#132).

## Status
- PRD 25 batch landed (#138–#160); moderator dashboard (#161); arcade polish (#170); flappy dino-ramp (#171). Production `main` was healthy before the banked-PR reconciliation.
- Campus polish: per-district decoration modules, curated furniture, decluttered walkways/rooms, clear presenter platform, modern seating, sparse structural greenery, deterministic regenerated campus map/geometry, and central placement legality tests.
- HUD polish: compact pixel-paper chat with slash-command discovery, thin themed scrollbar, independently collapsible muted/blocked management that appears only when populated, selected cream speech bubble, wooden noticeboard fullscreen map, bottom-centre controls/help placement, and consistent room/admin/chat surfaces.
- Stage broadcast now has one presenter-only `Go Live` action: it starts microphone audio, the global camera control adds/removes video on that same session, and status is `LIVE` / `NOT LIVE`. The duplicate on-air/video panels are gone.
- Fresh focused verification at 15:09: six frontend files, 83/83 tests passed; touched-file ESLint had 0 errors and 3 existing `ChatBox` hook-dependency warnings; `git diff --check` passed; localhost:5174 returned HTTP 200. Earlier 14:45 focused backend/frontend strict builds and bundle budget also passed; CI remains authoritative for full/E2E gates.

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
- Campus art lives in per-district `campus_decor/` modules; `gen_campus.py` remains the structural author; placement legality is enforced centrally.
- Full local gates are prohibited on Raja's machine; current-head cloud review plus green GitHub CI (including E2E) are the merge gates.

## Gotchas
- PRs #167 and #168 are sibling branches, not a clean stack. Reconcile/merge #167 before resolving #168, then update the campus branch from the resulting `main`.
- A solid prop body is bottom-anchored and extends above its authored tile. Connectivity is not enough: E2E helpers walk straight swept corridors, so map changes require the real E2E job.
- `WorldScene` draws a fallback room table only when no authored solid occupies the seat centroid; preserve that guard.
- Generated campus artifacts must come from `cd frontend && python3 scripts/gen_campus.py`, never hand edits.
- LimeZu art is non-commercial-license only; buy the paid pack before monetisation.
- Entry bundle was 98.9/130 KB gzip at the prior strict-build checkpoint; new arcade code stays lazy-loaded.
