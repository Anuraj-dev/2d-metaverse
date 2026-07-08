# 2D Metaverse — State
> Gather/Zep-style 2D metaverse (app name: **hyprverse**): walk a styled office campus, proximity voice/video, key-gated meeting rooms, arcade + board-game tables. · Last checkpoint: 2026-07-09 (overnight autonomous run)

## 🚧 In progress / next
- **PRD queue is EMPTY — PRDs 18–23 all shipped and prod-verified.** Next: triage the QA findings below with Raja and pick the next PRD.
- **QA findings to file/fix** (classifier blocked `gh issue create`; Raja to file or authorize):
  1. **[Medium] Prod LiveKit server older than client SDK** — every client 404s on `wss://livekit.space.raja-dev.me/rtc/v1` + `/rtc/v1/validate` ("v1 RTC path not found… Retrying"); SDK falls back to legacy `/rtc` (voice/share DID work) but it's a per-session retry loop and one SDK bump from breakage. Fix: upgrade LiveKit server on EC2 or pin the client SDK.
  2. [Low] Settings panel and fullscreen Campus map (M) stack/overlap when both open.
  3. [Low] Meeting control bar overlaps bottom-center filmstrip tiles while a screen share is focused (1280×800).
  4. [Docs] Prod frontend URL undocumented — it's **https://space.raja-dev.me** (only origin backend CORS allows; `*.vercel.app` URLs get CORS-blocked; `2d-metaverse.vercel.app` is an UNRELATED third-party app). Add to deploy/README.md.
- Close issues #65, #66 (PR #76), #67 (PR #77), #68 on GitHub — permission classifier blocks the agent from closing/creating issues; Raja closes or adds a settings allowance.
- CLAUDE.md cleanup still pending: model-delegation section expired 2026-07-06.
- QA leftovers: throwaway prod accounts `qa-fable-p1/p2`, `qascout1x/2x`, `probe_x`, `probe_y1`; 3 stale hyprverse tabs open in Raja's Chrome; screenshots in the session scratchpad `shots/`.

## Status
- **Shipped this session (overnight 2026-07-09):** PR #76 (PRD 21 audio feel — 500ms in-zone ramp, instant zone cuts, calm music w/ silence gaps) and PR #77 (PRD 22 naming & wayfinding — shared AREA_NAMES + `roomDisplayName()`, generator-authored banners/signposts/Board-Games sign, board tables moved into Game Arcade, named toast/chat-tab/knock/admin surfaces, seed derives names from shared). Both codex-reviewed (1 blocking finding on #77: seed name literals — fixed by a Fable fix agent, re-approved) and merged on ✅ + green CI. FE auto-deployed (Vercel) + backend deployed (workflow_run chain) — prod runs `4acf21f`.
- **Full prod browser E2E pass done (2026-07-09): ALL PASS** — signup/world, PRD 22 naming everywhere, board tables (sit/offer/accept/moves) in arcade, meetings (countdown/grid/chat-toggle/unread/screen-share end-to-end), knock naming, help overlay, audio settings. Only findings: the 4 items above.
- **Sonnet experiment PAUSED** (Raja, 2026-07-09 evening): coding → Opus 4.8 medium (`opus-coder`), review/heavy backend → codex, scouts/browser → Sonnet **medium** (never `sonnet-scout-low`). Resume only on Raja's word. Data so far: PRD 21 Sonnet-high coder ≈ Opus cost; PRD 22 Opus-medium coder: 178k tok/120 tools, 1 codex finding, 1 fix round.
- Zero open PRs. Open issues: #65–#68 (all shipped, awaiting close).

## Architecture map
- Wire contract (zod schemas + types + constants incl. AREA_NAMES, `roomDisplayName`) -> `shared/src/` (`socket.ts`, `rest.ts`, `constants.ts`, `games/`)
- Backend (Express + Socket.IO + Postgres/Redis/LiveKit) -> `backend/src/` (`app.ts`, `socket.ts`, `meeting.ts`/`meeting-manager.ts`, `boardMatch.ts`/`board-manager.ts`, `room-admin*.ts`, `stage.ts`, `seed.ts`, `logger.ts`)
- Frontend (React + Phaser + Vite) -> `frontend/src/` (`game/` pure modules; `WorldScene.ts` glue incl. `buildSigns`; `media/` — `livekit.ts`, `mediaLogic.ts` (ramp), `soundMixer.ts`; `ui/` — `MeetingGrid`, `RoomToast`, `ChatBox`, `HelpOverlay`)
- Map/asset generation -> `frontend/scripts/` (`gen_campus.py` — signs layer + board-table placement, `gen_signs.py`, `curate_audio.py`)
- Deploy -> `deploy/`, `.github/workflows/` · Prod: FE **https://space.raja-dev.me** (Vercel), BE EC2 compose (`api.space.raja-dev.me`, LiveKit `livekit.space.raja-dev.me`)

## Stack & run
- Stack: TypeScript (strict, ~6.0.x lockstep), npm workspaces, single root lockfile.
- Run: `npm install` → `docker compose up --build` → `cd frontend && npm run dev` (:5173 mock). Backend :3001.
- Test/build: **CI ONLY — see Gotchas.** Coders may run single vitest files they touched; nothing more locally.

## Key decisions (top 3–5)
- **NO FULL LOCAL GATES (2026-07-09, hard rule):** full `npm install`/`build`/`test` runs crashed Raja's PC. CI is the only verifier; codex reviews from `gh pr diff` + gates on `gh pr checks`. Memory: `no-local-test-runs`.
- **Merge authorization:** any PR merges once Codex posts `✅ READY FOR MERGE` AND CI is green (broadened 2026-07-09; overnight full-control grant used for #76/#77).
- Two-agent PR loop: coder subagent per-task branch; Codex (`codex exec`, **foreground only**) reviews via PR comments; orchestrator merges. Review-fix rounds: fresh Fable agent (standing consent).
- `@metaverse/shared` owns every wire shape AND every display name (AREA_NAMES/`roomDisplayName` — seed, UI, generator all derive from it); pure `game/*.ts` + backend FSMs own all rules; strict compiler repo-wide.
- Privacy invariant (PRD 21): audio zone cuts at room boundaries stay INSTANT; the 500ms ramp only smooths in-zone falloff.

## Gotchas
- **NEVER run full local builds/test suites** — crashed Raja's PC 2026-07-09. CI is the gate.
- **Codex CLI**: account default model, `-c model_reasoning_effort=medium|high`, `--sandbox workspace-write -c sandbox_workspace_write.network_access=true`, FOREGROUND with generous timeout.
- **`gh` has two accounts** — merge fails with a GraphQL permissions error if `24f2008153` is active; `gh auth switch -u Anuraj-dev` first.
- **Permission classifier blocks the agent from `gh issue create`/`close`** — hand issue ops to Raja or add a settings rule.
- **Browser QA of the world**: Claude-in-Chrome tabs are hidden → Phaser's rAF pauses, avatars can't move; drive prod with headless Playwright pages (fake media) instead. Prod URL is only `space.raja-dev.me` (CORS).
- E2E flakes (pre-existing): per-IP auth limiter 429 on the last spec as the serial suite grows; `arcade.spec.ts` `near-interactable` timeout under runner contention.
- Stacked PRs: merging+deleting a base auto-closes the child. Build shared first. Merging to main auto-deploys FE (Vercel) and chains the backend deploy off Backend CI (`workflow_run`). Backend Docker context is repo root. Every asset needs an ATTRIBUTIONS.md row. No `console.*` in backend/src.
