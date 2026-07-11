# 2D Metaverse — State
> Gather/Zep-style 2D metaverse (app name: **hyprverse**): walk a styled office campus, proximity voice/video, admin-gated meeting rooms, arcade + board-game tables. · Last checkpoint: 2026-07-11 (analytics foundation slice)

## 🚧 In progress / next
- **Approved direction (PR #88) and PRD 25 implementation architecture (PR #89) are merged.** Hyprverse is a private **Student Social World** for one bounded community: arrive, find familiar students, talk or join meetings, play or gather, continue together, and return. PRD 25 defines the acceptance model, fixed findings, 42 dependency-ordered vertical slices, TDD seams, review/CI/deploy gates, and final Maya verification. Missions, crews, progression, economies, academic platforms, and new game breadth remain deferred.
- **The complete live tracker graph is parent #90 with native sub-issues #91–#132 and 130 native blocking edges.** PRs #134, #135, and #137 shipped #91, #92, and #96. #99's isolated analytics-foundation branch now has the privacy-bounded shared contract, anonymous server-emitted sign-in outcomes, authenticated rate-limited ingestion, server timestamps, idempotency/conflict handling, 7/90-day retention, migration, and operator SQL seam; independent review, CI, merge, and production verification remain. #93 and #99 are the live ready frontier.
- CLAUDE.md cleanup still pending: model-delegation section expired 2026-07-06.
- QA leftovers: throwaway prod accounts `qa-fable-p1/p2`, `qascout1x/2x`, `probe_x`, `probe_y1`, `qa-strategy-mrf9bvaz-kp3z`; latest strategy screenshots/raw browser reports are in `/tmp/metaverse-ux-audit/` (session-local).

## Status
- **Phase B 2026-07-11:** PR #134 / #91 merged as `1f7c368`; Backend CI and deployment passed, both API health endpoints report that SHA, and the production `/rtc/v1/validate` probe passed. PR #135 / #92 merged as `4d4a31f`; PR #137 / #96 merged as `c89089d`. #99 is implemented on its isolated branch with focused shared-contract and real-API tests and awaits its draft PR gate.
- **Phase A 2026-07-11:** merged the owner direction and independently reviewed pilot-delivery spec; published GitHub parent #90, 42 native child issues (#91–#132), and 130 native dependency edges. Queue labels expose only #91–#93. Next implementation priority is #91/#92, with #93 following as reviewer capacity allows.
- **Research/design 2026-07-10:** completed repo/product architecture audit, production desktop/mobile/game QA, student-problem and competitor research, three strategic directions, weighted decision matrix, recommendation, and initiative portfolio in `docs/product-v2-strategy.md`. Current critical facts: no product analytics; portrait world has no touch controls; mic/cam default on; public chat lacks safety controls; absolute movement/physical actions are too client-trusted. The missing academic domain belonged to the superseded Study Guilds thesis and is not an MVP defect. Latest inspected GitHub CI/deploy runs were green; no full local gates were run. No GitHub issues were created.
- **Shipped 2026-07-09 (this session):**
  - **PR #83** (PRD 24, #81): zep-style signage (plaques + ground labels, `gen_signs.py`/wooden sprites deleted) + area focus dim (`game/areaDim.ts`).
  - **PR #84** (PRD 24.1, Raja's visual feedback): ALL plaques removed; new `floorName` sign kind — big bold names painted on the floor inside each area, fading out (~300ms) when the player is inside (pure `focusAreaId`/`floorNameHidden` in `areaDim.ts`); Mandakini direction added at plaza; arcade dim fixed via authored full-interior `arcade_zone` map object (old cabinet-bbox `arcadeAreaRect` deleted; HUD map uses the zone too). Raja approved the look ("fine, refine later").
  - **PR #85** (#78): LiveKit server v1.9.1 → **v1.9.12** (`/rtc/v1` added in v1.9.10; v1.9.12 stable patch) + deploy pull now includes `livekit`. Deployed; `/rtc/v1/validate` returns 400 (path exists) — retry loop gone.
  - **PR #86** (#80): prod URLs documented in `deploy/README.md` + STATE gotcha.
  - **PR #87** (#79): Settings ↔ fullscreen map mutually exclusive (event bus: `map-open` / new `settings-open`, open-transition-only); meeting ControlBar no longer overlaps filmstrip (`--control-bar-safe` CSS reservation on `.meeting-stage`).
  - Also merged earlier: PR #82 (help overlay). Overnight: #76 (PRD 21 audio), #77 (PRD 22 naming).
- All merges codex-gated (✅ + green CI); #85 codex-authored, driver-verified. Prod FE + BE current with main.
- **Sonnet experiment PAUSED** (Raja, 2026-07-09): coding → Opus (`opus-coder*`), review/heavy backend/deploy → codex (**medium effort — Raja pinned, no high**), scouts/browser → Sonnet medium. Resume only on Raja's word.

## Architecture map
- Wire contract (zod schemas + types + constants incl. AREA_NAMES, `roomDisplayName`, `areaIdForRoom`) -> `shared/src/` (`socket.ts`, `rest.ts`, `constants.ts`, `games/`)
- Backend (Express + Socket.IO + Postgres/Redis/LiveKit) -> `backend/src/` (`app.ts`, `socket.ts`, `meeting.ts`/`meeting-manager.ts`, `boardMatch.ts`/`board-manager.ts`, `room-admin*.ts`, `stage.ts`, `seed.ts`, `logger.ts`)
- Frontend (React + Phaser + Vite) -> `frontend/src/` (`game/` pure modules incl. `areaDim.ts`; `WorldScene.ts` glue incl. `buildSigns`/`buildFloorName`; `media/`; `ui/` — `MeetingGrid`, `Settings`, `Minimap`, `ChatBox`, `HelpOverlay`)
- Map/asset generation -> `frontend/scripts/` (`gen_campus.py` — signs layer (groundLabel/floorName) + `arcade_zone` + board-table placement, `curate_audio.py`)
- Deploy -> `deploy/`, `.github/workflows/` · Prod: FE **https://space.raja-dev.me** (Vercel), BE EC2 compose (`api.space.raja-dev.me`, LiveKit `livekit.space.raja-dev.me` — server v1.9.12)

## Stack & run
- Stack: TypeScript (strict, ~6.0.x lockstep), npm workspaces, single root lockfile.
- Run: `npm install` → `docker compose up --build` → `cd frontend && npm run dev` (:5173 mock). Backend :3001.
- Test/build: **CI ONLY — see Gotchas.** Coders may run single vitest files they touched; nothing more locally.

## Key decisions (top 3–5)
- **NO FULL LOCAL GATES (2026-07-09, hard rule):** full `npm install`/`build`/`test` runs crashed Raja's PC. CI is the only verifier; codex reviews from `gh pr diff` + gates on `gh pr checks`. Memory: `no-local-test-runs`.
- **Merge authorization (re-confirmed twice 2026-07-09):** full authority to merge once codex ✅ + green CI — including prod-deploying merges. The permission classifier may still block `gh pr merge`; Raja's explicit go in-session unblocks it.
- **Signage direction (Raja, 2026-07-09):** NO dark plaque signs anywhere; wayfinding = ground direction labels (text+arrow) + floor-painted area names that fade when you're inside. Approved as-is; refinements later.
- Two-agent PR loop: coder subagent per-task branch; Codex (`codex exec`, foreground, **medium effort**) reviews via PR comments; orchestrator merges. Codex may also implement deploy-critical changes (driver verifies diff).
- `@metaverse/shared` owns every wire shape AND display name; pure `game/*.ts` + backend FSMs own all rules; strict compiler repo-wide.

## Gotchas
- **NEVER run full local builds/test suites** — crashed Raja's PC 2026-07-09. CI is the gate.
- **Codex CLI**: account default model, `-c model_reasoning_effort=medium` (Raja pinned medium), `--sandbox workspace-write -c sandbox_workspace_write.network_access=true`, FOREGROUND with generous timeout. Codex may leave uncommitted working-tree edits if it commits via `gh` — check `git status` after codex implementation runs.
- **`gh` has two accounts** — merge fails with a GraphQL permissions error if `24f2008153` is active; `gh auth switch -u Anuraj-dev` first.
- **Permission classifier** sometimes blocks `gh issue` ops and prod-deploying `gh pr merge` — Raja's explicit in-session authorization unblocks them (issue close worked 2026-07-09 after his go).
- **Browser QA of the world**: Claude-in-Chrome tabs are hidden → Phaser's rAF pauses; drive prod with headless Playwright (fake media). Prod URL is only `space.raja-dev.me` (CORS blocks `*.vercel.app`; `2d-metaverse.vercel.app` is an UNRELATED third-party project).
- E2E flakes (pre-existing): per-IP auth limiter 429 on the last spec (hit #83 — rerun/push fixes); `arcade.spec.ts` `near-interactable` timeout under contention.
- **Parallel coders MUST get isolated worktrees** (Agent tool `isolation: worktree` works cleanly — used for #87). Worktrees have no `node_modules`; coders symlink from the main checkout to run single vitest files.
- Stacked PRs: merging+deleting a base auto-closes the child. Build shared first. Merging to main auto-deploys FE (Vercel) + chains backend deploy off Backend CI (`workflow_run`; `deploy/**` IS in its path filters). Backend Docker context is repo root. Every asset needs an ATTRIBUTIONS.md row. No `console.*` in backend/src.
