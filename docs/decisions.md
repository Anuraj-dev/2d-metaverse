# Decisions — 2D Metaverse
> Append-only log of load-bearing choices and WHY. Newest at the bottom.
> Format: `## YYYY-MM-DD — <decision>` then a short **Why:** line.

## 2026-07-04 — `@metaverse/shared` is the single source of truth for every wire shape (inferred at adoption)
**Why:** Every socket/REST payload is a zod schema defined once in `shared/src`; the backend `safeParse`s it and the frontend imports the erased inferred type. A frontend/backend disagreement becomes a compile error, not a prod-only runtime bug. Never re-declare a payload in `backend/` or `frontend/`.

## 2026-07-04 — npm-workspaces monorepo on a single root lockfile, shared built first (inferred at adoption)
**Why:** Consumers resolve `@metaverse/shared` from its built `dist/`, so `npm run build:shared` must precede any consumer typecheck/build. The backend Docker image build context is the repo root because the image builds `shared` from source.

## 2026-07-04 — Repo-wide strict compiler standard, tests held to product bar (inferred at adoption)
**Why:** Every tsconfig has `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` on; `tsc -b` gates CI. No new `!` without a justifying comment; production `src/` is assertion-free. Prevents a class of latent bugs and keeps the three packages honest.

## 2026-07-04 — Frontend game logic is pure modules; WorldScene is glue (inferred at adoption)
**Why:** Game rules live in pure `frontend/src/game/*.ts` (no Phaser/net/DOM imports), each with a vitest file; `WorldScene.ts` only orchestrates. Makes rules unit-testable and keeps decision logic out of the scene.

## 2026-07-04 — Board games are server-authoritative in shared rules; arcade is client-trusted REST (inferred at adoption)
**Why:** Board tables (tic-tac-toe, Connect-4) are turn-based matches the server owns end-to-end via one pure rules impl in `shared/src/games/` used by both sides; illegal moves get a typed `board-error`. Arcade cabinets are single-player with client-reported high scores trusted at REST level (documented Phase-1 caveat). Two deliberately different trust models.

## 2026-07-04 — Zone-gated proximity audio, computed client-side (inferred at adoption)
**Why:** World voice is proximity audio gated by audio zone (one zone per `roomBounds` room interior) so there is no voice through walls. Zones are derived client-side from already-broadcast positions — no wire-format change, no server involvement. Any new aurally-private area must be authored as a `roomBounds` rect with a `roomId`.

## 2026-07-04 — Context system (docs/) adopted (inferred at adoption)
**Why:** A fresh agent orients from `docs/STATE.md` instead of scanning 310 files. The pre-existing 22k `CLAUDE.md` rulebook was preserved (router prepended), and `AGENTS.md` points Codex/opencode at both.

## 2026-07-04 — Room passwords replaced by admin knock/approve (PRD 14, #50)
**Why:** shared keys are annoying (typed every entry) and leak; Google-Meet model chosen instead — first-in is admin, knock → approve/deny (30s auto-deny), Free-Fire-style admin succession, allow-all toggle (door disappears; reappears with alert at capacity). Rejected: keeping keys as a bypass path (two parallel systems to maintain).

## 2026-07-04 — Legacy `space` map deleted; hostel reuses room IDs 1–3 (PRD 13, #49)
**Why:** one canonical world; freed IDs keep rooms contiguous 1–6 and `ROOM_*_KEY`-era seed rows meaningful. Rejected: numbering hostel rooms 7–9 (permanent gap for no benefit).

## 2026-07-04 — Stage voice: keyless, position-validated broadcast with confirm prompt (PRD 17, #53)
**Why:** stage should be spontaneous — stand still 2s on stage → confirm → server-wide voice (except private rooms); backend validates on-stage position before issuing publish token. STAGE_KEY removed. Rejected: key-gated broadcast (kills spontaneity) and auto-broadcast without confirm (accidental hot-mic).

## 2026-07-05 — Two-agent PR loop: Opus coder implements, Codex reviews, orchestrator merges
**Why:** Each PRD gets a FRESH Opus coder (xhigh, spawn-time frontmatter) on its own branch; Codex GPT 5.5 (medium) reviews via PR comments only and never edits code; the Fable orchestrator merges only on `✅ READY FOR MERGE` gated on a green `npm run build`. Separates implementation from review (independent adversarial check) and keeps each coder's context small. Alternative rejected: one agent self-reviewing (no independent check) or resuming a heavy coder across PRDs (context bloat).

## 2026-07-05 — Parallel PRDs run in separate git worktrees, overlapping ones rebase before merge
**Why:** To ship faster, independent PRDs (#51 speech-ducking, #53 stage-voice) ran concurrently in worktrees under `$CLAUDE_JOB_DIR/tmp` rather than serially. Overlap on `shared/src/socket.ts` + e2e helpers is kept trivial by append-only schema edits; the second-to-merge rebases onto the first. Alternative rejected: strict serialization (slower) or long-lived divergent branches (painful merges).

## 2026-07-05 — Agent effort is set at spawn time, not via prompt text
**Why:** Prompt wording like "Effort: high" is a no-op; reasoning effort must be pinned in the agent definition frontmatter (`reasoningEffort:`) or a spawn-time `effort` option. Standing levels: Opus coders xhigh, Sonnet helpers medium. Coders also delegate token-heavy reading/browser work DOWN to Sonnet subagents (tiered delegation) to save the driver's context/cost.

## 2026-07-05 — Codex reviewer runs the local ChatGPT-account CLI with the default model
**Why:** The `codex` CLI on this box authenticates as a ChatGPT account, which rejects the `gpt-5.5-codex` model id (400). Reviews run `codex exec` with the account default model + `-c model_reasoning_effort=medium`, sandboxed `--sandbox workspace-write -c sandbox_workspace_write.network_access=true` (the auto-mode classifier blocks `--dangerously-bypass-approvals-and-sandbox`).

## 2026-07-07 — UX overhaul locked as six PRDs (18–23, issues #63–68), grilled with Raja
**Why:** One decision set, six shippable slices in priority order (emoji/typography → landing → HUD → audio → naming → meetings) instead of a mega-PRD, matching the one-subsystem PRD cadence. Load-bearing calls: UI-chrome emojis replaced by lucide + a CI emoji-grep guard (regression-proof), user chat content untouched; one self-hosted rounded sans app-wide (rejected pixel-font headings and CDN fonts); landing hero becomes a pixel-campus diorama with an explicit quality-bar fallback to a static shot (rejected multi-section marketing site); chat becomes a persistent bottom-left panel reusing the EXISTING world/room channels (no new wire shapes) and ONE global media control bar bottom-center replaces the seated-only + meeting-duplicate controls (rejected per-surface bars); voice volume ramps ~500ms for same-zone distance changes but zone/door cuts stay INSTANT (privacy invariant, explicitly tested — rejected smoothing everything); music switches to 2–3 curated calm tracks with Minecraft-style multi-minute silence gaps at lower default volume (testers muted the constant loop; curation not composition per locked audio direction); display naming via a shared `AREA_NAMES` registry (Mandakini rooms 1–3, Cauvery rooms 4–6, Stage, Game Arcade) with in-world banners/signs authored in gen_campus.py — wire ids unchanged; board tables relocate into the arcade hall which deliberately stays non-roomBounds (ungated, no meeting trigger); fullscreen map is view-only with click-to-locate (rejected click-to-teleport as a movement/cheat hazard); screen share is meetings-only via LiveKit publish, most-recent share wins the focus tile, no server arbitration.

## 2026-07-07 — One media-control surface: all publishers behind one fan-out, prefs win everywhere
**Why:** PRD 20's global bar promised "exactly one mute button". Codex review caught the stage publisher (PRD 17) outside the new fan-out — on-air players' bar buttons controlled nothing they were publishing. Locked: `media/mediaControls.ts` fans mic/cam to EVERY publisher (worldAudio, roomVideo, stageVideo — future publishers must join it), and every publish/(re)connect replays `mediaPrefs` instead of coming up hot. Prefs-win semantics chosen over "Go Live implies intent to be heard": going on-air with a muted pref yields on-air-but-muted, controllable from the bar; the alternative (auto-unmute on Go Live) was rejected as a privacy surprise, noted as a possible follow-up.

## 2026-07-07 — Stacked PRs: don't delete the base branch before retargeting the child
**Why:** PRD 20 shipped as stacked PRs (#71 base main, #72 based on #71's branch). Squash-merging #71 with `--delete-branch` made GitHub AUTO-CLOSE #72 (it does not retarget), and reopen is refused once the head is force-pushed — the child had to be recreated as #73 (rebased from the recorded fork point with `git rebase --onto main <forkpoint>`). Rule going forward: either retarget the child PR to main BEFORE deleting the base branch, or skip `--delete-branch` until the child is retargeted.

## 2026-07-09 — EXPERIMENT: within ONE PRD, fan work out to multiple sub-agents only when the PRD is large AND cleanly separable
**Why:** Raja is running a repo experiment to test whether splitting a single PRD's implementation across multiple sub-agents (not just the one coder) is more token-efficient and higher quality. Rule to follow: for a LARGE PRD, the coder may dispatch multiple agents *within that one PRD* — but ONLY when the work genuinely decomposes into independent, low-overlap chunks (separate files/subsystems). If the slices are tightly coupled (shared files like `App.tsx`/`App.css`/a single transport module, or a design that must stay coherent), do NOT split — multiple agents then re-load overlapping context and step on each other, which is token-HUNGRY and slower, the opposite of the goal. Token-heavy *reading/exploration* still routes DOWN to Sonnet scouts as before; this is specifically about parallelising *implementation*. Reporting requirement: whenever multiple agents are run for one PRD, the coder must state at the end whether it was efficient or not, so the experiment can be judged case by case.

## 2026-07-09 — No full local build/test runs; CI is the only verifier
**Why:** Parallel agent gate-runs (root `npm run build`/`npm test` + codex re-running install/build/test on a /tmp export per review) crashed Raja's PC. Alternative rejected: throttled/serialized local runs — still redundant with CI, which already runs the full matrix. Coders may run only the single vitest files they touched; codex reviews from `gh pr diff` and gates verdicts on `gh pr checks` (the "Lint · Typecheck · Test · Build" job is the build gate).

## 2026-07-09 — Merge authorization broadened to all PRs (Codex ✅ + green CI)
**Why:** Raja extended the PRD-queue grant to any current/future branch to keep the loop hands-off; the double gate (Codex verdict + full CI incl. E2E) stays mandatory.

## 2026-07-09 — Sonnet-5 experiment (this repo): high codes, low scouts
**Why:** Test cost-efficiency + correctness vs Opus coders. Agent defs `.claude/agents/sonnet-coder-high.md` / `sonnet-scout-low.md`; log per task in memory `sonnet-experiment`. Early signal: coder cost ≈ Opus, low-effort scouts flaky on broad exploration briefs.

## 2026-07-09 — Browser QA runs on headless Playwright, not Claude-in-Chrome
**Why:** Claude-in-Chrome automates background tabs (`visibilityState: hidden`), which pauses Phaser's rAF loop — avatars can't move, so world interactions are untestable. Headless Playwright pages (repo's own tooling, fake media devices) against prod work identically to the e2e suite. Also: prod is reachable ONLY via https://space.raja-dev.me — backend CORS rejects the `*.vercel.app` deployment URLs, and `2d-metaverse.vercel.app` is an unrelated third-party app (rejected: testing via Vercel URLs).

## 2026-07-09 — Signage: no plaque signs; floor-painted fading names
**Why:** Raja rejected facade plaques (occlude avatars, block doors, visual noise). Wayfinding is now ground direction labels (text+arrow) + bold area names painted on interior floors that fade out when the player is inside that area (containment reused from areaDim — no second registry). Alternative rejected: sprite/plaque signage of any kind.

## 2026-07-09 — LiveKit server pinned v1.9.12 (not latest major line jump)
**Why:** prod v1.9.1 predates the /rtc/v1 signaling path (added v1.9.10; v1.9.10 has a panic bug, v1.9.11/12 fix it) that livekit-client 2.19 requires. v1.9.12 = smallest safe jump with identical config keys; deploy script now pulls livekit so pin bumps actually roll out.

## 2026-07-11 — Hyprverse is a private Student Social World for one launch community
**Why:** Raja's original goal is a coherent campus where online students find familiar people, talk or meet, and play together. Study-first positioning was too narrow, while game-first positioning would create an expensive content treadmill. Launching with one reachable community concentrates presence and lets the basic social loop be validated before public discovery, academic workflows, missions, crews, progression, or economies are built. The canonical direction and MVP boundary are in `docs/product-direction.md`.

## 2026-07-11 — Pilot delivery is a dependency graph of reviewed vertical slices
**Why:** Privacy, safety, access, authority, reliability, and measurement defects can invalidate pilot results, while the arrival, media, world, and game work overlaps in a few coordination hotspots. PRD 25 sequences narrow end-to-end slices, keeps full verification in CI, requires independent review per slice, chooses usable phone portrait and landscape controls for the pilot, generates server geometry from the authored map, and preserves the existing shared-contract, state-machine, media-isolation, and server-authoritative board architecture.
