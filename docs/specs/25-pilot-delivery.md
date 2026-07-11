# PRD 25 — Student Social World pilot delivery

> Status: implementation architecture for the owner-approved pilot scope
> Product authority: [`../product-direction.md`](../product-direction.md)
> Evidence base: [`../product-v2-strategy.md`](../product-v2-strategy.md)

## Problem Statement

Hyprverse already has a credible campus, realtime presence, proximity voice, private meetings, a stage, arcade games, and server-authoritative board games. The current experience is not ready for a bounded student-community pilot because several failures can invalidate trust or make the social loop impossible to measure:

- signup and network failures are not reported truthfully;
- microphone and camera preferences begin enabled without explicit consent;
- desired media preferences are presented as if they were confirmed publication state;
- reconnect, listener ownership, and presence convergence are fragile;
- phone portrait users cannot move or interact;
- chat lacks minimum community safety controls;
- movement and physical actions trust client coordinates too far;
- arrival does not clearly show people, activity, or one obvious join action;
- loading, offline, empty, permission, and failed states are incomplete;
- important keyboard, focus, semantic, reduced-motion, and contrast paths are inconsistent;
- stage and meeting transitions can present stale or false state;
- map objects and authored areas need a complete plausibility and usefulness pass;
- Snake, Tic-Tac-Toe, and Connect Four need cohesive social-game quality;
- 2048 remains more prominent than its value to the social loop justifies;
- product analytics cannot measure activation, shared sessions, repeat relationships, transitions, return, media reliability, or safety.

Without these repairs, a pilot cannot distinguish weak product value from preventable reliability, privacy, access, or discoverability failure.

## Baseline Reconciliation

The implementation must not reopen findings that current code has already resolved:

- room passwords are obsolete; admin knock/approve/deny and succession are implemented;
- world, private-room, meeting, stage, and transcript isolation is implemented and tested;
- global media preferences already fan out across world, room, and stage publishers;
- portal duplicate/stale transition guards and serialized media handoff already exist;
- settings and fullscreen-map overlap is fixed;
- floor-painted area names and arcade-area dimming are owner-approved;
- board rules, turn order, wins, forfeits, and seat ownership after acquisition are server-authoritative;
- Snake already has seeded deterministic rules, reversal protection, and fair tail-cell collision;
- production LiveKit is upgraded, but local/CI still require parity with the production pin;
- 2048 is the audited block game; there is no separate block-game subsystem.

These strengths remain regression requirements. New work completes missing truth, access, presentation, and measurement behaviour around them.

## Solution

Deliver the pilot as a dependency-ordered sequence of narrow vertical slices. Each slice must be independently demoable, reviewed by an agent that did not implement it, gated by the relevant GitHub CI, deployed through the existing mainline workflow, and verified against production when it changes deployed behaviour.

The intended experience is:

> Arrive → see familiar students and active spaces → join quickly → talk or meet with truthful consent and state → play or gather → continue together → return.

The work is divided into six milestones:

1. Pilot measurement and foundation truth.
2. Safety, authority, accessibility, and mobile access.
3. Social arrival and low-friction joining.
4. Voice, private meeting, portal, and stage cohesion.
5. Campus map, object, and interaction quality.
6. Social-game quality, final production verification, and pilot readiness.

## User Stories

1. As a new student, I want signup validation, duplicate usernames, bad credentials, rate limits, server failures, and network failures distinguished, so that I know what to fix or retry.
2. As a returning student, I want a transient outage to preserve my session and explain reconnect progress, so that I am not incorrectly signed out.
3. As a privacy-conscious student, I want microphone and camera off until I explicitly enable them, so that entering the campus never publishes me unexpectedly.
4. As a student, I want controls to distinguish requested, permission-denied, connecting, muted, publishing, reconnecting, unavailable, and failed media states, so that the UI never lies.
5. As a stage presenter, I want LIVE to appear only after publication succeeds, so that the audience and I share the same truth.
6. As a student crossing a room boundary, I want world, private-room, meeting, and stage media to cut over immediately without leakage, so that privacy follows the space I occupy.
7. As a student recovering from a connection loss, I want my position, nearby peers, media, and UI to converge on one authoritative state, so that I do not see ghosts or hear the wrong zone.
8. As a long-session student, I want remounts and scene restarts to release listeners exactly once, so that controls and events do not duplicate over time.
9. As a phone portrait user, I want a usable and honest pilot path with movement and interaction controls or an explicit supported-boundary alternative, so that I am not dropped into an unusable world.
10. As a touch user, I want chat, joystick, interaction, map, and media controls not to overlap, so that core actions remain reachable.
11. As a keyboard user, I want logical focus order, working Tab navigation, focus containment/restoration, and keyboard-operable controls, so that every DOM interaction can be completed without a pointer.
12. As a reduced-motion user, I want informative state changes without large or prolonged movement, so that portals, meetings, games, and world effects remain comfortable.
13. As a screen-reader user, I want semantic controls, live state announcements, board descriptions, and text alternatives, so that canvas and visual feedback do not hide critical state.
14. As a community member, I want to mute or block another student and report harmful chat, so that I can protect myself.
15. As a moderator, I want throttling, a bounded moderation trail, and enough report context to act without storing unnecessary private content, so that the launch community is manageable.
16. As a student, I want impossible teleports and remote physical actions rejected by the server, so that room, seat, board, and stage interactions remain credible.
17. As a newly arrived student, I want to see who is online, where people are, and which rooms, meetings, games, or gatherings are active, so that the campus does not feel empty or opaque.
18. As a student, I want one obvious join action for a person or active space, so that the map creates presence without imposing unnecessary wandering.
19. As a student already near an activity, I want a specific prompt, enabled/disabled reason, progress feedback, and success confirmation, so that I know what will happen before I interact.
20. As a voice participant, I want visible local and remote speaking, connection, mute, permission, and failure feedback, so that conversation is understandable.
21. As a private-room participant, I want knock, approval, entry, seating, countdown, meeting start, reconnect, screen share, leave, and exit to remain synchronised, so that the room never shows stale state.
22. As a meeting participant, I want portal transitions to be fast, informative, input-safe, deduplicated, and reduced-motion aware, so that entering and leaving feels polished without delaying me.
23. As a stage presenter or audience member, I want presenter, audience, seating, joining, muted, live, leaving, and ended states to be unmistakable, so that gatherings feel reliable and special.
24. As a campus visitor, I want trees, furniture, collisions, walkways, sightlines, desks, and signs to look intentional, so that the world feels authored rather than accidental.
25. As a student near a useful object, I want it to expose a relevant event, room purpose, notice, collaboration surface, or social action, so that interaction supports the core loop instead of displaying filler text.
26. As a Snake player, I want buffered responsive controls, fair collision, progression, difficulty scaling, pause, restart, focus-loss safety, touch support, feedback, and a clear run ending, so that short sessions feel polished.
27. As a Tic-Tac-Toe player or spectator, I want clear seating, offer, acceptance, turn, move, win, draw, forfeit, disconnect, rematch, and accessible board states, so that the server-authoritative game is easy to follow.
28. As a Connect Four player or spectator, I want column intent, responsive drop animation, turn clarity, win-line presentation, disconnect/forfeit recovery, and rematch, so that the physical table feels worth gathering around.
29. As a student browsing activities, I want 2048 absent from primary discovery, messaging, cabinets, and leaderboards unless explicitly justified, so that the product highlights social experiences.
30. As the pilot operator, I want privacy-conscious analytics for arrival, meaningful interaction, shared sessions, activity transitions, repeat relationships, return, media reliability, reconnects, errors, and safety, so that decisions are based on observed value.

## Implementation Decisions

### Delivery and branch model

- Every implementation ticket is one coherent vertical slice and one PR unless its specification explicitly permits a smaller split.
- Every agent that writes code works in an isolated worktree based on the current mainline.
- Slices that share `App`, `WorldScene`, shared socket/REST contracts, media transport, or board UI are serialized.
- Conventional commits are required. Visible authorship remains Raja's; no agent credits are added.
- The main checkout must remain clean between merges. Existing user changes are never absorbed into a feature branch.
- Full lint, typecheck, test, build, integration, bundle, and E2E verification run only in GitHub CI. An implementer may run only the specific test files touched by the slice.

### TDD and test seams

- Each behaviour follows one red → green → refactor cycle before the next behaviour.
- Tests assert through the highest stable public interface: shared schema, REST/socket boundary, pure state machine/reducer, React DOM, typed event bus, or Playwright DOM/test hook.
- Shared contracts own every REST and socket payload. Backend and frontend never redeclare wire shapes.
- Realtime, media, meeting, portal, board, and game rules stay in pure state modules where decisions can be tested without Phaser, LiveKit, or DOM internals.
- `WorldScene` remains orchestration glue. New scene decisions require a pure seam and focused tests.
- Board rules and lifecycle remain server-authoritative. Frontend animation never predicts a move as accepted before the authoritative state arrives.
- Regression tests are required for every confirmed defect.

### Foundation truth and reliability

- Auth failures use a shared bounded error contract. Validation, duplicate username, bad credentials, throttling, server failure, and unreachable network remain distinct through backend, frontend transport, and landing UI.
- The socket client exposes explicit initial-connecting, connected, reconnecting, offline, recovered, unauthorised, and failed states. Transient transport errors do not delete a valid session.
- Scene, Net, EventBus, scale, and media listeners have one owner and deterministic teardown.
- Recovered presence preserves or authoritatively resynchronises the last valid server position; client snapshots replace stale remote state rather than only adding players.
- Local and production LiveKit use the same supported version and a real signaling/readiness assertion.
- Existing serialized world/private-room/stage media transitions remain intact.

### Media consent and truthful state

- Microphone and camera default off for a new browser profile.
- Joining the campus, room, meeting, or stage audience is receive-only until explicit enable.
- Desired preference, browser permission, device availability, transport connection, and confirmed publication are separate state dimensions.
- Toggle commands await outcomes and surface bounded failures. A requested-on preference is never rendered as publishing until publication succeeds.
- Stage LIVE depends on confirmed transport/publication state.
- Zone and room privacy cut-offs remain immediate. Same-zone proximity changes may stay smoothly ramped.
- Text-only, camera-off, and muted participation remain first-class.

### Analytics and monitoring

- Operational crash monitoring remains separate from product analytics but shares privacy and rate-limit discipline.
- Caught operational failures receive a bounded reporting path; reports exclude chat/transcripts, JWTs, passwords, precise coordinates, SDP, raw device identifiers, and unbounded stacks/context.
- Analytics events use an allowlisted shared schema, authenticated ingestion, server timestamps, idempotency, explicit retention, and a documented query/export surface.
- Initial events cover sign-in outcome, world-load outcome and duration, reconnect start/outcome, media enable/outcome, media failure, and crash-free-session denominator.
- Later events add first meaningful interaction, concurrent shared session, chat/voice/meeting/game starts and completions, activity transitions, repeated interaction, next-day/week return, block/report, and moderation outcome.
- Analytics must not reward raw hours, idle presence, or chat volume.

### Safety and authority

- World chat is server-throttled and schema-limited.
- Mute is local and immediate; block prevents unwanted direct/whisper visibility and contact according to the safety specification; report creates a bounded moderation record and visible acknowledgement.
- Moderation records minimise content retention while preserving actor, target, category, timestamps, and the smallest justified message reference/snapshot.
- Server movement validation uses elapsed time, configured speed/tolerance, world bounds, and authoritative last position. Suspicious moves are rejected/corrected and observable.
- Knock, room seat, board seat/move, stage publish, and other physical actions require server-validated proximity to canonical geometry.
- Geometry authority is not duplicated casually; the slice must document the single manifest or generated boundary used by frontend and backend.

### Accessibility and responsive pilot boundary

- The pilot supports desktop plus usable phone portrait and landscape movement, interaction, chat, and media controls. A rotate-device dead end is not the chosen boundary.
- Touch controls, chat, media, map, and interaction actions receive non-overlapping responsive zones.
- Touch input subscribes to orientation/pointer changes and always returns movement to neutral on pointer loss, blur, unmount, or rotation.
- Modals and overlays use semantic dialogs, focus containment, background inertness where appropriate, escape handling, and focus restoration.
- Tab is intercepted only when a real completion action exists.
- Meeting tiles, map/player actions, game cells/columns, and all media actions use semantic buttons or equivalent keyboard behaviour.
- A global reduced-motion preference covers portals, meetings, stage, games, and world ambience.
- Status changes use polite live regions where visual-only feedback would otherwise hide important state.

### Arrival and joining

- Arrival shows online people and active rooms, meetings, games, stage/gatherings, plus the next scheduled community activity when data exists.
- Empty, loading, offline, and failed arrival states are visually and semantically distinct.
- Join-person and join-activity actions reuse server authority. They may place the student at an approved threshold or focus/route them, but never create arbitrary client teleport.
- Walking remains available for presence and serendipity; invited or already-active experiences avoid unnecessary wandering.
- Activity transitions carry consistent title, state, back/leave behaviour, media truth, and success/failure feedback.

### Voice, meetings, portals, and stage

- Local and remote speaking indicators derive from actual audio state and remain accessible as text.
- Private-room entry, admin approval, seating, meeting countdown, participant join/leave, reconnect, screen share, and exit converge through existing authoritative machines and serialized media transitions.
- Portal transitions model enter, cancel, reveal, leave, duplicate input, and stale-generation cases in a pure state machine.
- Motion is brief and communicates handoff; reduced motion uses an immediate fade/state change.
- Input does not leak to the world or duplicate while an overlay transition owns focus.
- Stage presentation separates eligible, joining, connected, muted, publishing/live, failed, leaving, and ended states; audience and presenter views agree.
- Stage media remains excluded from private-room media.

### Campus and interactions

- The authored map is reviewed systematically by area using the generator/source of truth, rendered screenshots, collision checks, and verified E2E waypoints.
- Trees do not grow from concrete; furniture does not block doors, seats, walkways, important sightlines, or interaction reach.
- Desk clutter is reduced. Interactable objects need a social-loop purpose and a specific action or information outcome.
- Existing floor-painted area names and approved signage conventions remain unchanged unless a concrete regression is found.
- New or changed assets match the established pixel-art direction and include attribution.
- Stage-hall improvements preserve server position validation and media isolation.

### Games

- Snake rules remain deterministic and pure with seeded state. Timing/input buffering, progression, difficulty, collision fairness, pause/focus/touch, scoring, restart, and reduced motion are specified as observable reducer/renderer behaviour.
- Tic-Tac-Toe and Connect Four remain server-authoritative through the shared rules and backend match machine.
- Board presentation may animate only confirmed authoritative moves. Waiting, offer, acceptance, turn, win/draw, forfeit, disconnect grace, spectator, error, and rematch states are explicit.
- Board controls expose keyboard navigation, labels, current state, and live result announcements.
- 2048 is removed from primary discovery and messaging. Cabinet, registry, leaderboard, help, and lazy-load references must remain internally consistent; retirement must not leave dead interactions.
- No new games, multiplayer Snake rewrite, economy, or broad progression system is introduced.

## Delivery Slices and Blocking Edges

The GitHub issues created from this specification are the execution source of truth. Numbers are assigned when published; titles below are stable dependency names.

1. **LiveKit environment parity** — no blockers.
2. **Truthful authentication failures** — no blockers.
3. **WorldScene lifecycle ownership** — no blockers.
4. **Recovered server position preservation** — blocked by lifecycle ownership only for shared integration verification.
5. **Client connection state and presence convergence** — blocked by lifecycle ownership and recovered position preservation.
6. **Consent-safe media defaults** — blocked by LiveKit environment parity.
7. **Confirmed media publication state** — blocked by consent-safe defaults and client connection state.
8. **Handled operational error reporting** — blocked by client connection state and confirmed media state.
9. **Pilot reliability analytics** — blocked by truthful auth, client connection state, confirmed media state, and operational reporting.
10. **Chat anti-spam and typed cooldown feedback** — no blockers; serialize shared socket files with authority work.
11. **Report ingestion and moderation trail** — blocked by chat anti-spam; adds server-stamped message identity and bounded retention.
12. **Local mute and persistent block** — blocked by report ingestion because message identity and per-recipient delivery are shared seams.
13. **Moderator review and reversible action** — blocked by report ingestion and persistent block.
14. **Accessible overlay and focus primitive** — no blockers.
15. **Keyboard and semantic interaction repair** — blocked by accessible overlay primitive.
16. **Mobile landing and portrait controls** — blocked by client connection state, consent-safe media defaults, and keyboard semantics.
17. **Small-screen HUD collision pass** — blocked by mobile portrait controls.
18. **Global reduced-motion behaviour** — blocked by accessible overlay primitive.
19. **Generated server geometry manifest** — no blockers; must land before Phase E map edits.
20. **Authoritative movement envelope and correction** — blocked by recovered position preservation and geometry manifest.
21. **Server walkability and collision validation** — blocked by movement envelope and geometry manifest.
22. **Door and private-seat proximity validation** — blocked by movement/collision authority.
23. **Board-seat proximity validation** — blocked by movement/collision authority.
24. **Stage authorization hardening** — blocked by movement/collision authority and generated geometry.
25. **Presence/activity read model and social arrival** — blocked by pilot analytics, mobile/HUD accessibility, and physical-action authority; starts with truthful locate/view actions.
26. **Server-authorised join person/activity** — blocked by the activity read model, movement/collision authority, and door/seat proximity.
27. **Interaction-state cohesion** — blocked by authorised joining, accessible overlays, and keyboard semantics.
28. **Voice feedback and privacy-state cohesion** — blocked by confirmed media state, mobile/HUD accessibility, and reduced-motion behaviour.
29. **Stage publishing and audience truth** — blocked by stage authorization, confirmed media state, voice cohesion, accessible overlays, and reduced motion.
30. **Private meeting and portal accessibility completion** — blocked by connection convergence, confirmed media state, voice cohesion, accessible overlays, and reduced motion; extends the existing handoff rather than rewriting it.
31. **Campus plausibility, furniture, and useful interactions** — blocked by interaction-state cohesion and geometry manifest.
32. **Stage hall authored-world pass** — blocked by stage publishing truth and campus plausibility.
33. **Remove 2048 from primary discovery** — no implementation blocker; retain dormant rules/API compatibility unless evidence justifies full deletion.
34. **Snake game-quality slice** — blocked by mobile/HUD accessibility, reduced motion, and pilot analytics.
35. **Board rematch and disconnect lifecycle** — blocked by board-seat proximity and pilot analytics.
36. **Tic-Tac-Toe presentation and accessibility** — blocked by board lifecycle, keyboard semantics, mobile/HUD accessibility, and reduced motion.
37. **Connect Four presentation** — blocked by board lifecycle and Tic-Tac-Toe extraction when the shared board panel changes.
38. **Social-loop analytics completion** — blocked by arrival, interactions, voice, meetings, stage, campus, and games.
39. **Maya production acceptance and pilot release** — blocked by every implementation slice, green CI, deployment health, and documentation checkpoint.

## Testing Decisions

- Good tests describe user-visible or protocol-visible behaviour and survive internal refactors.
- Auth uses shared-schema tests, real API integration tests, transport tests, and landing RTL.
- Connection/reconnect uses pure transition tests, Net tests, real socket recovery integration, App/scene boundary tests, and one no-sleep E2E recovery path.
- Scene lifecycle tests prove exactly one callback after remount and no callback after destroy.
- Media tests prove no initial device request/publication, permission/outcome truth, stage false-live regression, immediate privacy cut-off, and reconnect state.
- Safety tests cover throttling, mute/block/report semantics, authorisation, retention, and abusive input limits without snapshotting private content unnecessarily.
- Authority tests exercise real socket handlers with valid and invalid movement/proximity, correction, replay, and boundary cases.
- Accessibility tests use RTL/axe-style semantics where already supported and Playwright keyboard/focus/reduced-motion checks; visual review remains necessary for contrast and responsive overlap.
- Arrival tests assert loading/empty/active/offline states and one approved join action through DOM and socket boundaries.
- Portal tests use a transition matrix plus App-level media-chain RTL and multi-session E2E.
- Map tests validate generated geometry/assets/collisions and E2E waypoints; browser screenshots verify visual plausibility.
- Snake uses table-driven reducer tests, deterministic input scripts, renderer input/focus tests, and touch/browser QA.
- Board games use shared rule matrices, backend lifecycle/socket tests, React accessibility/animation state tests, and two-browser E2E for play, spectating, disconnect, forfeit, and rematch.
- Analytics uses schema, ingestion, idempotency, retention, privacy, emission, and query/export tests. Production verification confirms events without exposing sensitive payloads.

## Deployment and Review Gates

- The independent reviewer reads the full diff, surrounding code, contracts, tests, and live CI; it never edits the implementation.
- Blocking findings return to the implementer and are re-reviewed at the new head.
- Sol independently inspects the diff and CI after reviewer approval.
- A PR merges only with explicit READY, all required checks green, and no hidden or weakened test/security gate.
- Mainline deployment health is verified through frontend availability, backend live/ready SHA, LiveKit readiness, and relevant smoke behaviour.
- Deployment-sensitive regressions are fixed in a new reviewed slice; no force push or CI bypass is permitted.

## Final Maya Acceptance

Maya CLI is the required final browser driver. Its installed command documentation is inspected before use. Production verification uses `https://space.raja-dev.me` and multiple sessions where required. Evidence includes timestamped screenshots and structured observations for:

- first signup, duplicate username, sign-in, rate limit, network/offline, and recovery;
- social arrival, active people/spaces, joining, prompts, useful objects, and transitions;
- voice permission, mute, speaking, connection, failure, and privacy cut-offs;
- private-room approval, meeting lifecycle, portal enter/exit, reconnect, camera-off, and screen share;
- stage presenter/audience/live/muted/ended truth;
- Snake, Tic-Tac-Toe, Connect Four, and 2048 discovery removal;
- map plausibility, collisions, walkability, furniture, desks, trees, sightlines, and stage hall;
- desktop, mobile/portrait pilot boundary, keyboard, focus, reduced motion, contrast, and screen-reader-visible state;
- loading, empty, offline, reconnect, error, perceived performance, animation smoothness, and cross-activity continuity.

Every reproducible blocker or high-severity failure returns through implementation, independent review, CI, deployment, and Maya re-verification.

## Out of Scope

- New games or a multiplayer Snake rewrite.
- Missions, crews, currencies, economies, group progression, cosmetics, or world unlock systems.
- Academic planning, focus-session products, persistent Q&A, LMS integration, SSO, or multi-tenancy.
- Public discovery, anonymous communities, native mobile apps, 3D conversion, AI tutors, or tutoring marketplaces.
- A broad rewrite of `App`, `WorldScene`, LiveKit transport, shared contracts, or board architecture.
- Raw-hours, idle-presence, chat-volume, or addictive engagement optimisation.

## Further Notes

- The old audit is evidence, not scope authority. Where it conflicts with product direction or this specification, the newer approved document wins.
- Existing private-room media isolation, serialized media transitions, sticky global media controls, server-authoritative board rules, strict compiler settings, deployment rollback, and operational crash beacon are strengths to preserve.
- Local full builds and test suites are prohibited because they previously exhausted the development machine. GitHub CI is the full gate.
- `/checkpoint` is required at the end. If the command is unavailable in this environment, update `docs/STATE.md` and the append-only session log as the documented manual equivalent, and record the exact command failure.
