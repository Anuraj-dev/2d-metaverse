# 2D Metaverse — State
> Gather/Zep-style 2D metaverse: walk a styled office campus, proximity voice/video, key-gated meeting rooms, arcade + board-game tables. · Last checkpoint: 2026-07-09

## 🚧 In progress / next
- **PR #76 (PRD 21, issue #66 — voice ramp + calm music) is OPEN, awaiting Codex review.** Local gates were green when the coder pushed. NEXT STEP: run the Codex review **without local gates** — judge from `gh pr diff 76` and gate the verdict on `gh pr checks 76` being green (see the new no-local-test-runs rule below). Then merge on Codex ✅ + green CI (Raja's broadened authorization covers it).
- After #76: dispatch **PRD 22 (#67, naming/wayfinding)** to a `sonnet-coder-high` agent, then the deferred **end-to-end browser test pass** (meetings, screen share, knock-in-meeting, help overlay) via a Sonnet scout + Chrome/maya tools.
- Close issue #65 (PRD 20 — shipped) and #68 (PRD 23 — shipped) on GitHub; permission classifier blocked the agent, Raja can close or explicitly authorize.
- CLAUDE.md cleanup still pending: model-delegation section expired 2026-07-06; note CLAUDE.md + `.claude/agents/opus-coder.md` have uncommitted local edits predating this session.

## Status
- **Shipped this session (2026-07-09):** PR #74 (meeting-countdown race fix — stale `stand`/`enter` no longer cancels a valid countdown; backend deployed to prod) and PR #75 (PRD 23 meeting experience: screen-share publish gated to meetings, focus-tile + filmstrip MeetingGrid w/ pure `game/meetingLayout.ts`, meeting-chat toggle + unread, decluttered top bar, BubbleLayer video-balls removed, knock/approval prompts visible over the meeting overlay, HelpOverlay z-index/corner fix). Main CI green, Vercel prod deployed.
- Two experiments active (memories: `sonnet-experiment`, `fable-coder-experiment`): Sonnet 5 high codes / Sonnet 5 low scouts in this repo; log cost+correctness vs Opus. First data point: PRD 21 coder ≈ Opus cost, verdict pending; low-effort scouts flaky on broad briefs.
- Zero open PRs besides #76. Issues open: #66 (in flight), #67 (next).

## Architecture map
- Wire contract (zod schemas + types + constants incl. AREA_NAMES) -> `shared/src/` (`socket.ts`, `rest.ts`, `constants.ts`, `games/`)
- Backend (Express + Socket.IO + Postgres/Redis/LiveKit) -> `backend/src/` (`app.ts`, `socket.ts`, `meeting.ts`/`meeting-manager.ts`, `boardMatch.ts`/`board-manager.ts`, `room-admin*.ts`, `stage.ts`, `logger.ts`)
- Frontend (React + Phaser + Vite) -> `frontend/src/` (`game/` pure modules incl. `meetingLayout`, `meetingChat`, `chatPanel`; `WorldScene.ts` glue; `media/` — `livekit.ts`, `mediaControls.ts`, `mediaLogic.ts` (ramp), `soundMixer.ts` (music scheduler); `ui/` — `MeetingGrid`, `MeetingOverlay`, `ControlBar`, `HelpOverlay`)
- Map/asset generation -> `scripts/gen_campus.py`, `frontend/scripts/` (`curate_audio.py`, `gen_landing_backdrop.py`)
- Deploy -> `deploy/`, `.github/workflows/`

## Stack & run
- Stack: TypeScript (strict, ~6.0.x lockstep), npm workspaces, single root lockfile.
- Run: `npm install` → `docker compose up --build` → `cd frontend && npm run dev` (:5173 mock). Backend :3001.
- Test/build: **CI ONLY — see Gotchas.** Coders may run single vitest files they touched; nothing more locally.

## Key decisions (top 3–5)
- **NO FULL LOCAL GATES (2026-07-09, hard rule):** full `npm install`/`build`/`test` runs (incl. codex /tmp exports) crashed Raja's PC. CI is the only verifier; codex reviews from `gh pr diff` + gates on `gh pr checks`. Memory: `no-local-test-runs`.
- **Merge authorization broadened (2026-07-09):** any PR in this repo may be merged once Codex posts `✅ READY FOR MERGE` AND all CI is green. Memory: `prd-queue-merge-authorization`.
- Two-agent PR loop: coder subagent implements per-task branch; Codex (GPT 5.5, `codex exec`, **foreground only** — background runs die silently) reviews via PR comments; orchestrator merges. Review-fix rounds: fresh Fable agent (standing consent).
- `@metaverse/shared` owns every wire shape; pure `game/*.ts` + backend FSMs own all rules; strict compiler repo-wide. Full log: `docs/decisions.md`.
- Privacy invariant (PRD 21): audio zone cuts at room boundaries stay INSTANT; the 500ms ramp only smooths in-zone distance falloff.

## Gotchas
- **NEVER run full local builds/test suites** (root `npm run build`/`npm test`, codex /tmp gate runs) — crashed Raja's PC 2026-07-09. CI is the gate.
- **Codex CLI**: account default model, `-c model_reasoning_effort=medium|high`, `--sandbox workspace-write -c sandbox_workspace_write.network_access=true`, FOREGROUND with generous timeout; sandbox can't switch git branches. Review = diff + CI checks only now.
- E2E flakes seen on #75 (both pre-existing, not regressions): per-IP auth limiter 429 hits the LAST spec as the serial suite grows (40 signups/15 min); `arcade.spec.ts` `near-interactable` 60s timeout under CI runner contention. Fix the first real failure, not cascade 429s.
- New agent defs (`.claude/agents/sonnet-coder-high.md`, `sonnet-scout-low.md`) load at session START — spawnable next session.
- Stacked PRs: merging+deleting a base branch auto-closes the child. Build shared first. Merging to main auto-deploys FE to Vercel prod. Backend Docker context is repo root. Every asset needs an ATTRIBUTIONS.md row. No `console.*` in backend/src.
