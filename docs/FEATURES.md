# Feature guide — hyprverse (2D metaverse)

> Plain-language guide to every user-facing feature: what it is, how to reach it in the app, and current
> status. Written for Raja (the operator). Snapshot date: **2026-07-12** — the full PRD-25 pilot batch
> (#138–#160) is deployed to production.

## Table of contents

1. [Auth / signup](#1-auth--signup)
2. [Avatar movement](#2-avatar-movement)
3. [Campus map, rooms, locked rooms, room keys](#3-campus-map-rooms-locked-rooms-room-keys)
4. [Doors, seats, interactables](#4-doors-seats-interactables)
5. [Proximity voice/video + audio zones](#5-proximity-voicevideo--audio-zones)
6. [Chat](#6-chat)
7. [Meetings](#7-meetings)
8. [Stage (go-live)](#8-stage-go-live)
9. [Arcade cabinets](#9-arcade-cabinets)
10. [Board-game tables](#10-board-game-tables)
11. [Minimap / locate](#11-minimap--locate)
12. [Presence / social arrival](#12-presence--social-arrival)
13. [Settings panel](#13-settings-panel)
14. [Day/night ambience + sound mixer](#14-daynight-ambience--sound-mixer)
15. [Accessibility](#15-accessibility)
16. [Analytics ingestion](#16-analytics-ingestion)
17. [Error beacon](#17-error-beacon)
18. [Safety / moderation system](#18-safety--moderation-system)
19. [Where things stand / what's next](#19-where-things-stand--whats-next)

---

## 1. Auth / signup

**What it is:** Username/password signup and sign-in issuing a JWT used for every subsequent REST call and
the socket handshake.

**How to use it:** The landing screen asks for a username + password; new users hit signup, returning ones
sign in. Both routes are `POST /api/v1/signup` and `POST /api/v1/signin`, payload validated against
`credentialsSchema` in `shared/src/rest.ts`. On success the backend returns `{ token }`; the frontend stores
it and attaches it as `Authorization: Bearer <token>` on REST calls and as a socket auth field.

**Status & caveats:** Live. The sign-in route is rate-limited per IP (`backend/src/auth.ts`) — hammering it
locally during dev/testing can trip the limiter; restart the backend container if you get locked out.

---

## 2. Avatar movement

**What it is:** Server-authoritative movement — the client predicts locally for responsiveness, but the
server is the source of truth and can correct a client that's drifted or trying to cheat.

**How to use it:** Arrow keys / WASD to walk around the campus map. No UI — it's the default control scheme.

**Status & caveats:** Live. Movement bounds/speed constants live in `shared/src/constants.ts`
(`MOVEMENT`); server-side validation is in `backend/src/movement.ts`. When the server disagrees with the
client's predicted position it emits a `move-correction` event and the client snaps back — this is normal
and usually invisible unless there's real network jitter.

---

## 3. Campus map, rooms, locked rooms, room keys

**What it is:** A single generated campus map (`frontend/public/assets/maps/campus.json`, mirrored
server-side as `backend/assets/campus.geometry.json`) with named rooms, some of which are locked and
require a room key to enter.

**How to use it:** Walk up to a room entrance; if it's locked, you're prompted for a room key (a short
string) — enter the correct key to unlock/enter. Room keys are per-room, shared knowledge (e.g. handed out
by an instructor), not per-user secrets.

**Status & caveats:** Live. The map is **generated, never hand-edited** — `frontend/scripts/gen_campus.py`
is the only legitimate way to change room layout, collision, or seats; both the frontend map JSON and the
backend geometry manifest come from the same generation run so client and server never disagree about
walls/doors. Room-key attempts are rate-limited per player+room.

---

## 4. Doors, seats, interactables

**What it is:** Interactive map objects — doors that open/close, seats you can sit in (private-room seats,
board-table seats, meeting-room seats), and other interactables (e.g. arcade cabinets).

**How to use it:** Walk up to an object; a prompt/highlight appears, press the interact key to use it (sit,
open a door, start a cabinet game). Only the nearest/most relevant interactable is offered when several are
in range.

**Status & caveats:** Live. Pure decision logic (which target wins when several interactables are nearby,
door/seat state transitions) lives in `frontend/src/game/interactables.ts`, `seatDoor.ts`, and
`interaction.ts` — `WorldScene.ts` just wires Phaser input to those modules and to socket events. Server
validates seat/door state changes; the client is not trusted for final state.

---

## 5. Proximity voice/video + audio zones

**What it is:** Spatial voice/video chat over LiveKit — the closer two avatars are, the louder each other's
audio; video tiles appear for nearby players.

**How to use it:** No explicit toggle — proximity audio/video activates automatically as you approach other
players in the same audio zone. Browser mic/camera permission is requested on first use.

**Status & caveats:** Live. **No voice through walls**: `frontend/src/game/audioZones.ts` derives one audio
zone per room interior from the map's `roomBounds` rectangles (zone id = room id) plus a single `OUTDOOR`
zone for everything else; volume is 0 across zones and normal distance falloff within a zone — a hard
cutover at the doorway, not muffling. Zones are computed **client-side** from broadcast positions — this is
a **documented trust caveat** (server does not currently enforce zone membership; a modified client could
in theory ignore the zone gate). Any new enclosed area that should be private must be authored with a
`roomBounds` rect + `roomId` in the map generator — there's no separate registry to update.
Transport (`frontend/src/media/livekit.ts`) is a thin, mostly-untested LiveKit wrapper; the actual
attach/detach/volume logic is the tested pure module `mediaLogic.ts`.

---

## 6. Chat

**What it is:** Room-scoped text chat, with block/mute/report actions reachable from the same panel (see
[§18](#18-safety--moderation-system)).

**How to use it:** Chat panel is part of the main HUD (`frontend/src/ui/ChatBox.tsx`); type and send.
Messages are broadcast to players in range/room via socket events defined in `shared/src/socket.ts`.

**Status & caveats:** Live. Message length and rate limits are shared constants (`shared/src/constants.ts`)
enforced on the backend — the client can't bypass them by editing local code, since the server re-validates
every message with the same zod schema.

---

## 7. Meetings

**What it is:** Auto-starting meeting rooms — when everyone in a meeting-room's seat zone is seated and
there are at least 2 people, a countdown arms; when it elapses, the meeting starts and the world "portals"
those players into a focused meeting view.

**How to use it:** Sit down in any seat inside a meeting room with at least one other person also seated.
A countdown appears; if everyone stays seated it starts automatically. A late arrival who sits joins in
place. Standing up (or disconnecting past a grace window) leaves the meeting; the last person leaving ends
it.

**Status & caveats:** Live. All start/join/leave/end rules live in exactly one pure state machine,
`backend/src/meeting.ts` (exhaustively tested in `backend/test/meeting.test.ts`) — never re-derived in
socket handlers or frontend. `backend/src/meeting-manager.ts` is the side-effect shell (countdown timers,
per-room serialization, broadcasts). The frontend only reacts to broadcast events:
`frontend/src/game/meetingUi.ts` maps them to portal-in/portal-out, and `frontend/src/game/portalHandoff.ts`
aligns the two-phase visual reveal.

---

## 8. Stage (go-live)

**What it is:** A stage area where a designated presenter can "go live" (ON AIR) to broadcast to the room,
distinct from ordinary proximity voice.

**How to use it:** Walk to the stage, use the go-live control to start broadcasting; other players in the
space see an ON AIR indicator and receive the presenter's stream regardless of proximity.

**Status & caveats:** Live, and recently hardened (PR #159, `b60c21c` "harden stage authorization") — the
server now authorizes who is allowed to publish to the stage rather than trusting client claims, closing a
gap where any client could previously assert presenter status. A non-blocking follow-up (stage go-live
failure teardown, from PR #148 review) is still tracked as an open item — see [§19](#19-where-things-stand--whats-next).

---

## 9. Arcade cabinets

**What it is:** Single-player mini-games playable at map-placed arcade cabinets: **Snake** and **Flappy**
(a third game, **2048, has been retired** and is no longer offered).

**How to use it:** Walk up to a cabinet and interact; a lazy-loaded overlay (`ArcadeOverlay`) opens over the
game world (which sleeps underneath, same pattern as meetings). Escape closes it instantly. Score is
submitted when the run ends, and a high-score list is shown.

**Status & caveats:** Live. Game rules are pure, deterministic modules in `frontend/src/game/arcade/`
(`snake.ts`, `flappy.ts`, plus a shared seeded PRNG) — no `Math.random`, everything replayable from a seed.
High scores are a REST resource (`arcade*Schema` in `shared/src`, canonical game-id list `ARCADE_GAMES`),
best-per-user in Postgres, rate-limited. **Documented trust caveat: scores are client-reported and trusted
at this level** — there is no server-side replay/validation of arcade play in this phase.

---

## 10. Board-game tables

**What it is:** Two-player, **server-authoritative** turn-based games at public plaza tables:
**tic-tac-toe** and **Connect-4**. Distinct subsystem from arcade cabinets — not client-trusted, not REST.

**How to use it:** Sit at a board table seat (no room-entry gating, these are public plaza seats); when both
seats are filled, both players get an offer to start, and accepting begins the match. A floating panel
(`ui/BoardTablePanel.tsx`) shows the board; clicking a cell sends a move. Spectators walking up see the same
panel read-only. Standing or leaving forfeits; both seats empty resets to waiting.

**Status & caveats:** Live. Rules are one shared, pure implementation in `shared/src/games/`
(`board.ts`, `ticTacToe.ts`, `connect4.ts`, `rules.ts`) used by **both** backend and frontend — the server
never trusts a client-submitted board state, only a move index it validates itself. The match lifecycle is
a pure machine, `backend/src/boardMatch.ts` (exhaustively tested), with `backend/src/board-manager.ts` as
the side-effect shell (serialized dispatch, disconnect-grace forfeit timer, Redis-mirrored state with TTL).
Moves are server-validated socket events (`board-sit`/`board-stand`/`board-accept`/`board-move`); illegal or
out-of-turn moves get a typed `board-error` back to the sender.

---

## 11. Minimap / locate

**What it is:** A minimap showing the campus layout and player positions, plus a "locate" action to
highlight/jump the camera to a specific player or room.

**How to use it:** Minimap is part of the persistent HUD; click a room/player marker to locate them, and the
camera pans/highlights.

**Status & caveats:** Live. Camera locate logic currently lives inline in `WorldScene.ts` (it's on the list
of scene logic still awaiting extraction into a pure module per the frontend's scene-as-glue convention —
not a bug, just not yet refactored out).

---

## 12. Presence / social arrival

**What it is:** Notifications/UI cues when other players arrive in your room or space, and general presence
tracking (who's online, who's in which room).

**How to use it:** Passive — arrival cues surface automatically as other players join your room/space; no
action needed.

**Status & caveats:** Live. Recently tightened (`7a4186f`, "wait for the intended second arrival") — a test
correctness fix ensuring presence logic waits for the specific expected player rather than merely a
people-count threshold, per a gotcha noted in `docs/STATE.md`: grace-timer occupants (players in their
disconnect grace window) can linger and were previously miscounted.

---

## 13. Settings panel

**What it is:** A panel for adjusting audio volumes (master/music/sfx/ambient) and muting, plus a visible
build identifier for the running frontend.

**How to use it:** Open Settings from the HUD; adjust sliders/toggles. The panel also displays `build
<git-sha>`, sourced from `VITE_GIT_SHA` baked in at build time — useful for confirming which deploy you're
actually looking at in the browser.

**Status & caveats:** Live. Volume prefs persist via `frontend/src/ui/settings.ts`. The backend exposes the
same SHA via `/health/live` and `/health/ready` (`sha` field) so frontend build and backend deploy can be
cross-checked against each other.

---

## 14. Day/night ambience + sound mixer

**What it is:** A slow day/night visual cycle (tint, ambient particles, subtle sway) and a layered audio
mixer (master → music/sfx/ambient busses) that automatically ducks ambient music when you're near live
voice chat.

**How to use it:** Passive/automatic — no controls beyond the volume sliders in Settings ([§13](#13-settings-panel)).

**Status & caveats:** Live. Day/night is code-driven, not pre-rendered assets (`frontend/src/game/dayNight.ts`
+ `WorldScene`). All sound *decisions* (channel routing, master mute, ambient ducking near voice, the
event→sound table, footstep cadence) live in one pure, tested module,
`frontend/src/media/soundMixer.ts`; `media/sfx.ts` is thin HTMLAudio glue and `ui/SfxBridge.tsx` is headless
event wiring. Game logic never calls audio directly — it emits domain events on the event bus and the
bridge decides the clip, keeping gameplay audio-agnostic.

---

## 15. Accessibility

**What it is:** Baseline accessibility support — keyboard focus handling and reduced-motion behavior.

**How to use it:** Reduced motion follows the OS/browser `prefers-reduced-motion` setting automatically;
keyboard focus is managed so overlays (e.g. arcade, board panel, room-key prompt) trap and restore focus
correctly rather than leaking keystrokes into the game world underneath.

**Status & caveats:** Live at a baseline level — this is not a full accessibility audit, just the
conventions the codebase currently enforces (e.g. the arcade overlay's "focus trap" for the room-key field
mentioned in `CLAUDE.md`'s arcade section). No dedicated accessibility settings UI beyond what's covered by
motion/focus handling.

---

## 16. Analytics ingestion

**What it is:** Pilot reliability analytics — lightweight event ingestion from the running app used to
gauge how the pilot cohort is actually experiencing the product (errors, reconnects, key flows completing).

**How to use it:** Passive/automatic; no user-facing controls. This is operator-facing telemetry, not a
player feature.

**Status & caveats:** Landed as part of the final PRD-25 feature merge (PR #160, commit `39c22f3`, "add
pilot reliability analytics"). `docs/STATE.md` notes some analytics hooks were **deferred** in that PR's
body and are tracked as a non-blocking follow-up — treat analytics coverage as a work-in-progress baseline,
not exhaustive instrumentation.

---

## 17. Error beacon

**What it is:** A client-side crash reporter — uncaught JS errors and unhandled promise rejections in the
frontend are shipped to the backend so you can see them in logs without needing a user to screenshot a
console.

**How to use it:** Nothing to do — it's installed automatically (`frontend/src/main.tsx`) in real-backend
mode. It posts to backend `POST /client-errors`.

**Status & caveats:** Live. Reports show up in backend logs tagged `module: "client-error"`, carrying the
reporting client's build SHA so you can correlate an error to an exact frontend deploy. Rate-limited both
server-side (10/min/IP) and client-side (session cap + dedupe) so a broken client can't flood logs or
disrupt the game for anyone — telemetry is explicitly designed to never break gameplay.

---

## 18. Safety / moderation system

This is the part most worth reading carefully — moderation is **REST-only today, with no dashboard UI**.

### What a player can do

Every player has three actions available from the chat interface / player context menu
(`frontend/src/ui/ChatBox.tsx`):

- **Block** — persistent, server-stored. `POST /api/v1/blocks` to add, `DELETE`/`GET` variants to remove or
  list. Once blocked, that player's chat/audio/video stops reaching you, and this preference survives
  reload/relogin because it's stored server-side.
- **Mute** — local-only, client-side, not persisted server-side and not visible to anyone else. Quick, easy
  way to silence someone for the current session without the block relationship implications.
- **Report** — sends a report to the backend: `POST /api/v1/reports`. Reports land in the Postgres
  `reports` table (migration `backend/migrations/004_reports.sql`); block relationships live in their own
  table (migration `005_blocks.sql`); moderator action logging lives in migration `006_moderation.sql`.

### Who is a moderator

Moderators are **only** the UUIDs listed in the `MODERATOR_USER_IDS` environment variable — an allowlist,
checked by `backend/src/moderator.ts`'s `requireModerator` gate. This is now configured in production
(set 2026-07-12 to the two operator-account UUIDs, per `docs/STATE.md`). There is **no special role or flag
in the database** — being a moderator is purely "your account UUID is in this env var."

### The moderation REST surface

Mounted at **`/api/v1/mod`** in `backend/src/app.ts` (`app.use("/api/v1/mod", moderation)`), implemented in
`backend/src/moderation.ts`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/mod/reports` | List reports |
| `POST` | `/api/v1/mod/reports/:id/dismiss` | Dismiss a report |
| `POST` | `/api/v1/mod/warn` | Warn a user |
| `POST` | `/api/v1/mod/suspend` | Suspend a user |
| `POST` | `/api/v1/mod/unsuspend` | Lift a suspension |

**Every route under this prefix 404s (not 401/403) for a non-moderator, by design** — the surface doesn't
even confirm its own existence to someone who isn't on the allowlist. There is currently no frontend UI for
any of this; it's operated entirely via direct API calls.

### Runbook: acting on a report via curl

Placeholders below — never substitute real UUIDs, tokens, or secrets into a shared doc.

**1. Log in as a moderator account to get a JWT:**

```bash
curl -s -X POST https://api.space.raja-dev.me/api/v1/signin \
  -H "Content-Type: application/json" \
  -d '{"username":"<moderator-username>","password":"<moderator-password>"}'
# -> { "token": "<jwt>" }
```

**2. List open reports:**

```bash
curl -s https://api.space.raja-dev.me/api/v1/mod/reports \
  -H "Authorization: Bearer <jwt>"
```

**3. Dismiss a report that doesn't need action:**

```bash
curl -s -X POST https://api.space.raja-dev.me/api/v1/mod/reports/<report-id>/dismiss \
  -H "Authorization: Bearer <jwt>"
```

**4. Warn or suspend the reported user** (field is `targetId`, per `backend/src/moderation.ts`; `reason` is
optional free text):

```bash
curl -s -X POST https://api.space.raja-dev.me/api/v1/mod/warn \
  -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
  -d '{"targetId":"<target-user-id>","reason":"<reason text>"}'

curl -s -X POST https://api.space.raja-dev.me/api/v1/mod/suspend \
  -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
  -d '{"targetId":"<target-user-id>","until":<epoch-milliseconds-in-the-future>,"reason":"<reason text>"}'
# `until` is a number (epoch ms), e.g. from: date -d "+24 hours" +%s%3N
```

**5. Lift a suspension:**

```bash
curl -s -X POST https://api.space.raja-dev.me/api/v1/mod/unsuspend \
  -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
  -d '{"targetId":"<target-user-id>"}'
```

If any of these 404, either the JWT's account isn't in `MODERATOR_USER_IDS` on that environment, or the
route path is wrong — re-check `backend/src/app.ts`'s mount line before assuming the account lacks access.

### Caveats worth remembering

- **No moderator UI.** Every moderation action today is a manual curl/API call. If report volume grows,
  this is the first place to invest in a real dashboard.
- **Non-blocking review follow-ups still open** (per `docs/STATE.md`): PR #152 flagged invalid block-target
  handling, cache eviction, and whisper visibility; PR #153 flagged report-to-action linkage (i.e. reports
  don't yet automatically link to the moderation action later taken on them — that's tracked, not built).
- **Trust caveats elsewhere in the app that are adjacent to safety**: arcade high scores are client-reported
  and trusted (§9); audio zone privacy ("no voice through walls") is enforced client-side only in v1, with a
  server-enforced phase-2 documented as a future path (§5). Neither is a moderation gap per se, but both are
  places where a modified client could currently misbehave without server-side detection.

---

## 19. Where things stand / what's next

The entire PRD-25 pilot batch (23 PRs, #138–#160) is merged to `main` and deployed: backend CI green, frontend
CI green (including Playwright E2E and Vercel deploy), backend deployed and healthy at SHA `7a4186f`
(`https://api.space.raja-dev.me/health/ready` reports `ok: true`), moderator allowlist configured in prod as
of today.

Remaining PRD-25 frontier (tracked as GitHub issues, not yet started or not yet merged):

- **#107, #108, #117–#121, #124–#125, #127–#132** — covering areas like mobile controls, further
  server-authorization hardening for join/interaction/voice/stage cohesion, richer campus object
  interactions, arcade/board polish, pilot-cohort verification, and final acceptance testing. Re-evaluate
  each against what #138–#160 already covered before starting — some may be partially subsumed.
- **Non-blocking review follow-ups** left on already-merged PRs: stage go-live failure teardown (#148),
  invalid block-target/cache-eviction/whisper-visibility edge cases (#152), report-to-action linkage (#153),
  reconnect re-anchor trust window (#156), and deferred analytics hooks (from PR #160's body).

Full dependency-ordered plan: `docs/specs/25-pilot-delivery.md`. Always re-check `docs/STATE.md` before
starting new PRD-25 work — it's the single current-state source of truth and is updated at the end of every
session.
