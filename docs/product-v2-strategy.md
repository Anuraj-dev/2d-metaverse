# Hyprverse Next — product and technical strategy audit

> Status: historical evidence and alternatives; owner direction approved on 2026-07-11
> Audited commit: `ceb098d644fb`
> Date: 2026-07-10
> Decision gate: product thesis is approved; no implementation issues are created until the first pilot-validation slice and its specification are approved.

> **Current direction:** [`product-direction.md`](./product-direction.md) is the owner-approved agent brief and supersedes the Study Guilds recommendation in this audit where they conflict. This document remains the evidence base and alternative-strategy record.

## Evidence standard and limitations

This report combines:

- A read-only audit of the tracked repository, architecture documentation, current GitHub issues, pull requests, CI runs, and deployment configuration.
- Production browser QA against `https://space.raja-dev.me` using headless Chrome and fake media devices.
- Current product and behavioural research, prioritising official product documentation and peer-reviewed or systematic research.
- Product judgment. Inferences are labelled as such and are not presented as measured facts.

Important limitations:

- Hyprverse has operational logs and a browser crash beacon, but no product analytics. No claim about current activation, retention, feature adoption, or learning impact can be verified.
- No production database, traffic logs, media-quality telemetry, AWS console, Vercel project settings, or real student research repository was available.
- No full local build or test suite was run because the project explicitly prohibits those runs; the latest observed GitHub CI and deployment runs were green.
- The browser environment did not expose Maya or a selectable GPT-5.6 Luna model. The delegated browser audit used Playwright/Chrome instead.
- Research evidence for educational metaverses is promising on perceived presence, but still weak on long-duration retention and objective learning outcomes. Spatial-product conclusions therefore remain hypotheses to validate.

## 1. Executive assessment

Hyprverse has a credible realtime foundation. This audit initially evaluated it through an online-degree-product lens; the owner later rejected that framing as the product centre.

The codebase is stronger than a typical prototype: strict shared contracts, pure and tested state machines, server-authoritative board rules, private-room media isolation, robust CI, deployment gates, rollback, version stamps, and operational error reporting are genuine assets. They should be reused.

The product itself is currently a polished Gather/ZEP-style social campus. It is not yet an academic workflow. Students can enter, walk, talk, meet, broadcast, chat, and play, but they cannot represent a course, deadline, study intention, focus session, recurring study group, doubt, answer, project milestone, or academic progress. The only accumulated engagement state is arcade high scores.

That produces four structural problems:

1. **No durable job:** opening the product does not lead to a concrete academic outcome.
2. **No asynchronous value:** most value collapses when relevant peers are not online at the same time.
3. **No accumulation:** chat, meetings, and presence leave little useful academic or relationship capital behind.
4. **No measurement:** feature success cannot be separated from novelty because activation and retention are not instrumented.

The audit originally recommended a **course-aware study accountability network with an optional spatial campus**, provisionally called **Study Guilds Campus** in this report. On 2026-07-11 the owner rejected academic progress as the single product centre and approved a broader thesis: **Hyprverse is a Student Social World**. Study remains one valuable activity, alongside conversation, play, events, clubs, and collaboration; it is neither a replacement for formal learning nor the sole reason to stay.

The audit's original, now-superseded Study Guilds loop was:

> See the next academic pressure → commit to one bounded task → join a relevant peer or pod → focus → check out with an outcome → get or give help → schedule the next session.

Do not implement that loop as the MVP. The approved loop is **arrive → see familiar students → join them → talk or meet → play or gather → continue together → return**, as defined in [`product-direction.md`](./product-direction.md).

The metaverse becomes a social-presence and transition layer: useful for seeing who is available, joining a group, forming relationships, running events, and taking short social breaks. It should not be the only navigation model or the reason the product exists.

Games remain supporting activities inside the social world, not a standalone portal. Snake, Tic-Tac-Toe, and Connect Four should be polished only after foundation repairs; 2048 should leave primary discovery. Analytics, media consent, mobile access, safety, reliability, and truthful state remain higher-priority foundations. Course context, pods, and help systems are not approved MVP scope.

## 2. Current product and architecture map

### 2.1 Product surfaces and flows

There is no application router. [`frontend/src/App.tsx`](../frontend/src/App.tsx) switches between a landing state and one hardcoded campus world.

| Surface | Confirmed behaviour | Persistence |
| --- | --- | --- |
| Landing | Sign up, sign in, username/password, local avatar selection | JWT, display name, and local avatar in browser storage |
| Campus world | Phaser movement, sprint, collisions, day/night, signage, area dimming | Presence in Redis while connected |
| Social presence | Player avatars, roster, locate, minimap/full map, proximity voice | Live only |
| Chat | World chat, room chat, whispers, unread state, browser notifications | Component memory only |
| Private rooms | Six rooms, knock/approve/deny, first-arrival admin, succession, allow-all, capacities | Runtime/Redis access and seat state |
| Meetings | Seat-triggered countdown, LiveKit audio/video, screen share, focus grid, ephemeral chat, elapsed timer | Live only |
| Stage | Space-wide voice/video broadcast from authored stage zones | Live only |
| Arcade | Snake, Flappy, 2048, per-game best and global leaderboard | Best scores in PostgreSQL |
| Board tables | Tic-Tac-Toe and Connect Four, two seats, accept, authoritative turns, spectators | Runtime/Redis snapshot |
| Static interactables | Campus information and “Today’s Agenda” content | Authored map payload only |
| Settings | Mic, camera, audio channels, notifications, fullscreen, build SHA | Local browser state |

There is no separate block game in source. The closest match is 2048.

### 2.2 Current user flows

1. **First visit:** landing → choose username/password/avatar → account creation/sign-in → world load → automatic realtime/media startup.
2. **Casual social:** walk → see nearby people → proximity voice or world chat → whisper or follow via roster.
3. **Private meeting:** walk to door → knock → room admin approves → enter → sit → all occupants sit → countdown → meeting overlay → leave/stand.
4. **Stage:** walk onto stage/presenter zone → confirm voice broadcast or choose video broadcast → audience hears/sees it.
5. **Arcade:** walk to cabinet → press E → fullscreen overlay → play → submit client-reported score → view leaderboard.
6. **Board:** walk to a table seat → sit → second player sits and accepts → play authoritative match → leave to reset the social context.

There is no first-class flow for planning study, focusing, finding a course peer, asking a doubt, joining a course community, scheduling an event, collaborating on a project, or tracking progress.

### 2.3 Frontend architecture

- React 19 provides the app shell and overlays.
- Phaser 4 renders the campus and owns most spatial state.
- Vite 8 builds the frontend.
- [`frontend/src/game/scenes/WorldScene.ts`](../frontend/src/game/scenes/WorldScene.ts) is the main orchestrator at 1,494 lines.
- Pure rules live under `frontend/src/game/`; arcade reducers are deterministic and independently tested.
- Media transport is split from pure media decisions under `frontend/src/media/`.
- React↔Phaser communication uses a process-global string-keyed event bus.
- The Socket.IO client, event bus, media managers, preferences, and settings are process-global singletons.
- Heavy features are lazy-loaded: Phaser, LiveKit, meetings, arcade, board panel, room access, and stage UI.
- There is no route model, server-state cache, durable academic state store, or query layer.

### 2.4 Backend architecture

- Express 5 serves REST and health endpoints.
- Socket.IO owns movement, presence, chat, rooms, meetings, and board actions.
- PostgreSQL persists users, spaces, rooms, seats, and arcade scores.
- Redis stores live presence, room access, seat locks, board snapshots, room-admin mirrors, and rate-limit counters.
- LiveKit provides world audio, private-room audio/video, screen sharing, and stage media.
- Pure state machines own room administration, meeting lifecycle, and board match lifecycle.
- Pino provides structured logs; `/client-errors` records browser crashes in backend logs.

Confirmed REST surface:

- `POST /api/v1/signup`
- `POST /api/v1/signin`
- `GET /api/v1/space/:id`
- `POST /api/v1/livekit/token`
- `GET /api/v1/arcade/scores/:game`
- `POST /api/v1/arcade/scores`
- `POST /client-errors`
- `GET /health/live`
- `GET /health/ready`

Realtime contracts cover movement, chat, whispers, room admission, seats, meetings, and board matches. They do not cover academic intent, study sessions, courses, groups, events, progress, or help.

### 2.5 Authentication and authorization

- Username/password accounts use hashed secrets and seven-day JWTs.
- JWTs are stored in `localStorage` and used for REST, Socket.IO, and LiveKit tokens.
- There is no email verification, password reset, account recovery, token revocation, device/session list, OAuth/SSO, or visible logout.
- Room media requires both room admission and a seat lock.
- Board rules and room-admin decisions are server-owned.
- Absolute movement coordinates and several physical interactions are client-trusted, weakening the boundary for proximity and stage authorization.

### 2.6 Deployment topology

- Frontend: Vercel, deployed through frontend CI.
- Backend: one EC2 host running backend, PostgreSQL, Redis, LiveKit, and watchdog containers.
- TURN is configured in production.
- Backend deploys use immutable images, setup gates, health checks, rollback, and Telegram container alerts.
- Socket.IO broadcasts are process-local, so horizontal backend scaling is not ready.
- No database backup/restore automation is evident in the repository.

### 2.7 Test and telemetry map

Strengths:

- Strict TypeScript across production and tests.
- Shared Zod wire contracts.
- Pure-unit coverage for gameplay and lifecycle rules.
- Service-backed integration tests for APIs, sockets, Redis scripts, meetings, boards, migrations, and repositories.
- Eleven Chromium E2E suites.
- CI build, lint, typecheck, test, image, version compatibility, deploy, and rollback gates.

Gaps:

- No product event analytics or retention cohorts.
- E2E is Chromium-desktop centred; there is no phone/tablet project or Firefox/WebKit coverage.
- Successful media connection and quality are intentionally not asserted.
- Degraded network, permissions denial, recovery, abuse, and accessibility coverage are limited.
- The E2E suite calls signup → enter → room → sit → chat the “core loop”; that is a technical flow, not a student-value loop.

## 3. Codebase findings

Severity definitions:

- **Critical:** privacy, safety, or core access problem that should block growth.
- **High:** materially harms trust, recurring value, or the primary experience.
- **Medium:** meaningful quality, maintainability, or scale risk.
- **Low:** contained inconsistency or polish debt.

### 3.1 High-confidence findings

| Severity | Type | Finding and evidence | User impact | Business impact | Recommended action |
| --- | --- | --- | --- | --- | --- |
| Critical | Product/measurement | No academic domain exists in `backend/migrations/001_initial.sql` or `002_arcade_scores.sql`; no course/focus/help contracts exist. | Students cannot complete an academic job. | The product competes as a novelty world, not a learning product. | Define the smallest course-aware study-session domain after validation. |
| Critical | Measurement | Only operational logs and [`frontend/src/errorBeacon.ts`](../frontend/src/errorBeacon.ts) exist; there are no product events. | Unknown friction and invisible drop-off. | Retention and ROI claims are impossible. | Instrument activation, value, social, performance, and guardrail events before expansion. |
| Critical | Privacy | Mic and camera preferences default on in `frontend/src/media/mediaPrefs.ts:14`; world audio starts after init and meetings request both devices. There is no prejoin consent surface. | A student may enter a live space hot. | Severe trust and privacy risk. | Default both off, explain media, preview devices, and require explicit first publish. |
| Critical | Mobile/access | `TouchControls` renders only in mobile landscape; production QA confirmed phone portrait has no movement or interaction controls. | Touch-only portrait users cannot use the product. | Large acquisition and retention ceiling. | Provide a mobile-native non-spatial task path and either proper portrait controls or an explicit unsupported-state message. |
| High | Strategic | Communication and meetings are synchronous and ephemeral; chat is component memory and meeting chat intentionally has no backlog. | Empty campus means little value; useful answers disappear. | Weak retention and no accumulated network value. | Add scheduled sessions, persistent course/pod context, outcomes, and reusable help artifacts. |
| High | Safety | World chat broadcasts without a rate limit, block, mute, report, or moderation workflow in `backend/src/socket.ts:328-343`. | Spam and harassment are unmanageable. | Growth is unsafe; institutional adoption is blocked. | Add rate limits and minimum safety controls before peer discovery scales. |
| High | Security | Movement writes client-supplied absolute coordinates directly in `backend/src/socket.ts:316-326`; knock, room-seat, and board-seat handlers lack interaction-distance checks. | Modified clients can teleport or trigger physical actions remotely. | Competitive/social integrity and access claims are weakened. | Add server plausibility and proximity checks at high-value interaction seams. |
| High | Security | Stage publish validates Redis position, but that position is client-controlled via movement. | A modified client can place itself on stage and request publish rights. | Broadcast abuse risk. | Treat stage authorization as incomplete until movement/interaction authority is strengthened. |
| High | Reliability | `StageVideo.open` catches failures, while `StageScreen` sets `isLive=true` after the call. | UI can claim a broadcast is live when it failed. | Embarrassing event failure and lost trust. | Return confirmed connection/publish state; render pending, live, and failed explicitly. |
| High | Reliability | `WorldScene` installs global net/bus listeners without retaining unsubscribers or cleaning them on shutdown. | Re-auth/remount can duplicate events or call destroyed scenes. | Long-session instability and difficult incident diagnosis. | Add scene lifecycle cleanup at one ownership seam. |
| High | Reliability | Socket recovery overwrites Redis presence with spawn while the browser retains local position. | Peers and audio logic can disagree about location after a brief network change. | Realtime behaviour becomes nondeterministic. | Preserve or authoritatively resync the last valid position. |
| High | Platform | Space ID `"1"` is hardcoded in App, WorldScene, and StageScreen; room IDs are globally keyed. | No real course/community selection. | Institutional or multi-community growth requires a migration. | Define tenant/community/course boundaries before B2B expansion. |
| High | Reliability/test | Development/CI pins LiveKit 1.9.1 while production pins 1.9.12, the compatibility fix. | Local/CI media may not represent production. | Green tests can miss media breakage. | Pin one supported version and add a real signaling readiness assertion. |
| High | Identity | Avatar choice is local-only; remote clients derive another avatar from user ID because the wire carries no avatar. | A student's chosen identity is not what peers see. | Social polish and trust are undermined. | Persist and transmit selected avatar or remove the false choice. |
| High | Authentication | Stored JWT is not reused on app boot; reload returns to landing. No logout or account recovery exists. | Repetitive sign-in and dead-end forgotten passwords. | Conversion and repeat usage suffer. | Restore valid sessions, add logout, then recovery appropriate to the target segment. |
| Medium | Architecture | WorldScene (1,494 lines), App (474), App.css (1,932), ChatBox (430), and LiveKit transport (623) are coordination hotspots. | Bugs cluster in intertwined flows. | Slower iteration on the new core loop. | Introduce vertical domain modules and typed boundaries as new work lands; avoid a broad rewrite. |
| Medium | Architecture | The internal event bus and Net listener API accept arbitrary strings and caller-supplied payload generics. | Event drift can compile. | Refactors carry avoidable regression risk. | Define internal event maps and type `on`/`emit` from them. |
| Medium | Data/geometry | Map, seed, and backend stage geometry have duplicated authorities; the frontend does not consume `GET /space/:id`. | Auth/audio/doors can drift after map edits. | New worlds become expensive and unsafe. | Generate one versioned world manifest consumed by frontend and backend. |
| Medium | Reliability | Board manager documentation claims restart recovery, while boot cleanup deletes `board:*` keys. | Active matches disappear after restart. | Behaviour contradicts reliability claims. | Choose and test either recovery or explicit reset semantics. |
| Medium | Integrity | Arcade scores are client-reported and trusted in `backend/src/repository.ts:78-97`. | Leaderboards can be cheated. | Scores cannot support rewards, reputation, or prizes. | Keep them cosmetic or add verifiable run state before attaching value. |
| Medium | Errors | Media errors are often console-only; leaderboard load failure renders like an empty board. | Users misread failure as success or emptiness. | Support load and abandonment increase. | Model loading, empty, degraded, permission-denied, and failed states separately. |
| Medium | Infrastructure | Backend, database, Redis, LiveKit, and alerts share one host; backup automation is not visible. | One host incident can cause broad outage or data loss. | Paid/institutional readiness is limited. | Add tested backups and recovery objectives before scaling infrastructure. |

### 3.2 Strengths to preserve

- `@metaverse/shared` is a sound contract boundary.
- Strict compiler settings and test discipline are valuable.
- Room-admin, meeting, and board state machines are reusable patterns for a structured study-session lifecycle.
- Server-authoritative board rules are correct even though the presentation is weak.
- Media transition serialization and room isolation should be preserved.
- Lazy-loading and bundle budgets show useful performance discipline.
- CI, immutable deploys, readiness checks, rollback, logging, and version stamps are strong foundations.

### 3.3 Game audit

#### Snake

Confirmed current design:

- Deterministic 17×15 grid.
- Fixed 110 ms tick.
- One-deep latest-input buffer.
- Fixed speed, board, scoring, and difficulty.
- Keyboard-only input.
- No levels, curve, missions, obstacles, combos, touch gestures, haptics, or progression.

The pure reducer is an excellent seam. If a break-ritual experiment succeeds, improve the game with an animation-frame clock, buffered turns, input forgiveness, swipe/d-pad support, a gentle speed curve, short levels, clear feedback, pause/restart, reduced-motion mode, and group-break context. Do not build a large progression economy before the product loop is proven.

#### Connect Four

The rules and turn authority are good. The experience is not:

- Generic 42-button HUD detached from the in-world table.
- Clicking any cell maps to a column, but there is no column affordance.
- No disc-drop animation, anticipation, rematch action, invitation, or match context.
- Reset effectively requires leaving and reseating after game over.
- No touch-optimised presentation or game-specific accessibility semantics.

Do not replace it immediately. First test whether a short two-player break creates repeat peer interaction. If it does, rebuild the presentation around columns, physical table feedback, drop animation, instant rematch, and a 3–5 minute time budget.

#### 2048 / “block game”

- Correct deterministic rules.
- Static DOM grid with no slide/merge animation.
- Keyboard-only; no swipe.
- No social or academic context.
- Same generic leaderboard shell as unrelated games.

Recommendation: de-feature it now. Do not spend a major version rebuilding it unless behavioural data shows demand. If a replacement is eventually needed, prefer a cooperative, bounded break activity that strengthens a pod rather than another isolated score chase.

## 4. Browser and UX findings

> This section is populated from production Playwright QA. Findings are observed behaviour unless labelled source-only.

### 4.1 Desktop

Verified at 1440×900 in production:

- **Positive:** landing, world, chat, help, fullscreen map, settings, 2048, and Flappy loaded without page exceptions or failed product requests. The only repeated console output in the world was headless WebGL readback/performance warnings.
- **Positive:** the landing is visually coherent, responsive, and has sensible `nav`/`main` landmarks and heading order. It had no horizontal overflow at desktop, tablet, phone portrait, or phone landscape.
- **High — positioning:** the promise is “a cozy 2D pixel campus” and “walk · talk · gather.” Nothing explains a student outcome, course community, focus, accountability, or help. A student can understand the interaction style but not why to return.
- **High — empty-world effect:** with one user online, the desktop canvas is visually spacious but functionally empty. The largest persistent action is chat; there is no next task, event, populated room, or suggested session.
- **Medium — hierarchy:** chat occupies roughly 440×310 px at the bottom-left and the minimap about 148×146 px at the bottom-right. The world remains readable, but the HUD feels like several independent utilities rather than one workflow.
- **Positive:** the map and settings surfaces were legible, and the recently fixed settings↔map stacking conflict did not recur in this pass.
- **Critical — privacy evidence:** immediately after entering, the global controls were labelled “Mute microphone” and “Turn camera off,” confirming both publish preferences begin on rather than awaiting explicit consent.
- **High — keyboard:** focusing the chat input and pressing Tab did not advance focus because Tab is always intercepted for whisper completion.
- **Medium — modal isolation:** help and arcade surfaces leave background HUD controls in the document focus order; the arcade declares itself modal but the page behind it is not inert.
- **Medium — performance:** on an unthrottled headless run, landing FCP was ~0.9 s and authenticated-world FCP ~0.53 s. The world transferred about 941 KB across 80 resources; the largest transfers were the Phaser/GameCanvas chunk (~378 KB) and LiveKit client (~126 KB). This is a useful baseline, not a mobile-network performance claim.

Game observations:

- **2048 verified:** the game fills the screen but places a small static 4×4 board inside a large empty stage. Moves update immediately without slide/merge motion. It is visually clean but feels like a basic embedded web game, not part of the campus or student loop.
- **Flappy verified:** start and game-over states are clear, click input works, and replay is obvious. Presentation is functional but sparse and generic.
- **Snake not visually verified:** the browser script reached the wrong cabinet; Snake conclusions in this report come from source inspection.
- **Connect Four not live-verified:** solo QA could not reliably reach/activate the table before the audit cutoff, and a real match needs a second participant. Source/rules findings remain valid; live game feel and multiplayer behaviour remain unverified.

### 4.2 Mobile

Confirmed in production:

- **Critical:** portrait world has no touch controls, so a touch-only user cannot move or interact.
- **High:** portrait chat and global control bar overlap heavily.
- **High:** in 844×390 landscape, chat occupies roughly the left half while minimap and E action overlap at bottom-right.
- **High:** mobile help describes keyboard controls instead of the touch experience.
- **High:** in 844×390 landscape, the help close action falls below the viewport.
- **High:** at 390×844, avatar selection extends below the initial viewport and the sign-in action starts below the fold; unconditional username autofocus can also summon the mobile keyboard before the user has understood the page.
- **High:** at 844×390, autofocus scrolls the landing deep into the form, placing the nav/hero above the viewport and the submit action partly below it.
- **Medium:** touch controls exist only in landscape. When visible, the joystick, minimap, E action, chat, and media bar compete for the same lower half of the screen.

### 4.3 Accessibility and interaction

Confirmed by production QA and source review:

- Chat input traps Tab unconditionally for whisper completion, even when there is nothing to complete. Keyboard users cannot tab onward (`frontend/src/ui/ChatBox.tsx:270-277`).
- Fullscreen-map player selection is a mouse-only canvas interaction.
- Meeting tiles are clickable `motion.div` elements without button semantics or keyboard activation.
- Core canvas movement has no nonvisual equivalent.
- Several modal surfaces lack complete focus trapping, focus restoration, and consistent `aria-modal` semantics.
- Landing auto-focuses the username field on all viewports, which can force the mobile keyboard.
- Reduced-motion handling is limited mainly to landing visuals; meeting/portal/game motion is not covered by one global preference.
- Help text still says room entry requires typing a key, although keys were removed.

### 4.4 Loading, error, realtime, and verification limits

- Landing has a clear busy label and bad credentials produce an inline alert, but signup validation errors are collapsed into “username taken” by the client.
- World connection is reduced to “connecting…”/“connected”; no distinct reconnecting, degraded media, permission denied, or offline recovery state was observed.
- An arcade leaderboard failure is represented by the same UI as “no scores yet” in source, so the empty and failed states are not truthful.
- One disposable production QA account was created: `qa-strategy-mrf9bvaz-kp3z`. The audit also sent one harmless world-chat marker and submitted a Flappy score of 0. There is no account-deletion surface/API to clean it up.
- Screenshots and raw browser observations are in `/tmp/metaverse-ux-audit/` for this machine/session, including desktop landing/world/help/map/settings, phone portrait/landscape, 2048, and Flappy.
- Multi-user proximity, private-room approval, meeting media, screen sharing, stage broadcast, error recovery, and mobile games were not end-to-end reverified with multiple live users in this pass. Repository tests and prior checkpoints cover many of those technical flows, but they are not substitutes for this product audit.

## 5. Student problem analysis

The addressable problems are not “students need a campus map” or “students need more games.” They are:

1. **Starting despite low motivation.** Flexible online study creates weak external structure.
2. **Protecting study time.** Work, family, and study compete for the same hours.
3. **Knowing the next action.** LMS content can be complete while day-to-day prioritisation remains unclear.
4. **Feeling part of a real cohort.** Online learners often see names or feeds, not dependable peers.
5. **Getting unstuck quickly.** Help-seeking is socially and cognitively costly.
6. **Finding relevant peers at the right time.** A global online count is less useful than “who is working on my course/topic now?”
7. **Maintaining continuity.** Useful conversations, plans, and relationships disappear across tools and semesters.
8. **Working across bandwidth and privacy constraints.** Camera-on cannot be mandatory for every student or context.

Research supports the importance of structure, belonging, teacher/peer presence, usable synchronous systems, and adaptive help-seeking, while also warning that learner needs vary. See the systematic reviews on [online higher-education attrition](https://pmc.ncbi.nlm.nih.gov/articles/PMC9753023/), [digitally mediated connectedness](https://pmc.ncbi.nlm.nih.gov/articles/PMC8236383/), and [online learner help-seeking](https://olj.onlinelearningconsortium.org/index.php/olj/article/view/3400).

### Session outcomes the product should enable

| Time available | A valuable outcome |
| --- | --- |
| 10 minutes | See the next commitment, update a plan, find a relevant peer, ask/answer one focused doubt, or reserve a session. |
| 30 minutes | Complete one 25-minute focus block with stated intent and check-out, optionally beside a pod member. |
| 2 hours | Complete a multi-block study plan with breaks, peer accountability, targeted help, and a saved next action. |

## 6. Competitive and behavioural research

### 6.1 What competitors actually do well

- **Focusmate, Flow Club, Caveday:** choreograph intent → bounded commitment → social expectation → focus → check-out. The mechanism is accountability and closure, not video alone. [Focusmate flow](https://support.focusmate.com/en/articles/9110188-getting-started), [Flow Club](https://www.flow.club/how-it-works).
- **StudyStream/Study Together:** provide low-friction ambient co-presence and liquidity, but weak course relevance and relationship continuity. [StudyStream](https://www.studystream.live/focus-room/).
- **Forest:** ties a single visual metaphor directly to focus; group focus creates shared consequence. [Forest](https://www.forestapp.cc/en/).
- **Habitica and Duolingo:** attach progression to the desired repeated behaviour. Duolingo reports retention lifts from streak experiments, but those are company-reported product experiments rather than universal evidence. [Duolingo streak experiment](https://blog.duolingo.com/improving-the-streak/).
- **Discord and WhatsApp:** win familiarity, reach, notifications, and conversational coordination. They lose structure, knowledge retrieval, and academic context. [Discord onboarding](https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ), [WhatsApp events](https://about.fb.com/news/2024/05/events-in-whatsapp-communities/).
- **Moodle, Notion, Google Meet:** are systems of record, planning, content, and communication. Hyprverse should integrate or deep-link, not rebuild them. [Moodle features](https://moodle.com/solutions/lms/features/), [Notion Education](https://www.notion.com/product/notion-for-education), [Google Meet education features](https://support.google.com/meet/answer/10459644).
- **Gather and WorkAdventure:** make presence and spontaneous group formation legible, but impose a spatial tax when the world is empty, slow, or inaccessible. [Gather pricing/product](https://www.gather.town/pricing), [WorkAdventure](https://workadventu.re/pricing/).
- **Piazza, Ed Discussion, InScribe:** preserve reusable academic questions and answers. They are a stronger direct strategic threat than generic metaverses. [Piazza](https://piazza.com/product/overview), [Ed Discussion](https://edstem.org/us/), [InScribe](https://www.inscribeapp.com/).

### 6.2 Behavioural loops worth adapting

1. **Commitment:** choose a real course task → reserve time → another person expects attendance → declare intent → work → report → schedule next.
2. **Belonging:** identify by course/term/time zone/style → join a stable small pod → repeat useful activity → build trust → resume easily.
3. **Help:** mark stuck with course/topic → route to an available qualified peer → resolve live or async → preserve the answer → endorse/correct.
4. **Progress:** useful academic action leaves evidence → progress suggests the next action.
5. **Host supply:** reliable students become peer hosts or mentors → more session supply → contribution earns trusted recognition.
6. **Event continuity:** scheduled event → reminder → structured participation → saved actions/notes → follow-up group or session.

### 6.3 Failure patterns to avoid

- Empty-world amplification.
- Novelty that leaves no useful state behind.
- Generic channel/feed entropy.
- Forced camera use.
- Global hour leaderboards that reward free time, cheating, or unhealthy behaviour.
- Punitive daily streaks for working/adult students.
- Paid-host dependency in every room.
- Moderation and safeguarding added after growth.
- Institution-facing “at-risk” surveillance without consent and strict governance.

### 6.4 Neglected opportunity

The strongest gap is a **course-aware social accountability layer** between the LMS and generic social/productivity tools:

- LMS/Notion know the work but not who can help now.
- Discord/WhatsApp know the people but not their academic commitments or reusable answers.
- Focusmate knows accountability but not the course, cohort, or whole-degree relationship.
- Spatial products show presence but rarely convert it into persistent academic progress or knowledge.

Hyprverse can combine academic context, live availability, bounded study sessions, stable peers, and persistent help without replacing incumbents.

## 7. Core weaknesses of the current product

1. The name and map imply a student campus, but the domain is a generic social world.
2. The primary loop optimises presence and novelty, not academic completion.
3. Spatial navigation is mandatory for too many actions and broken on phone portrait.
4. Empty-world risk is unmitigated by schedules, pods, or asynchronous value.
5. The only progression is disconnected, client-trusted arcade scores.
6. Chat and meetings do not produce persistent knowledge or next actions.
7. There is no course, cohort, topic, availability, or trust graph to drive relevant discovery.
8. Safety, media consent, account recovery, and accessibility are not ready for growth.
9. The product cannot explain what drives retention because it has no product analytics.
10. Multiple strong technical subsystems feel like separate experiments because they do not serve one recurring workflow.

## 8. Highest-leverage opportunities

### 8.1 Choreograph one recurring academic loop

The product should open on “What will you finish next?” rather than an empty map. A structured study session creates immediate value and can reuse rooms, meetings, presence, audio, chat, and state-machine patterns.

### 8.2 Build continuity before breadth

Add course context, session plans, check-outs, saved next actions, and recurring pods. These accumulate value even when the campus is quiet.

### 8.3 Make presence relevant

Show “3 peers studying Algorithms now” or “your pod starts in 8 minutes,” not only “5 online.” Course/topic/availability context makes spatial presence useful.

### 8.4 Convert live help into reusable knowledge

Start with a lightweight help request and resolution note. Preserve good answers after a call or chat so the next student can find them.

### 8.5 Keep the world, remove the spatial tax

Planned or invited activity should be one click away. Arbitrary map teleport can remain disallowed; server-authorised “join session” entry can place a student at the correct threshold or room. Walking remains available for serendipity and exploration.

### 8.6 Reward useful action

Progress should represent completed focus blocks, reliable attendance, resolved doubts, helpful explanations, project milestones, and inclusive hosting. Do not grant meaningful status for walking, raw chat volume, or unrelated game scores.

### 8.7 Treat graceful access as differentiation

Every important study workflow should work with text only, low bandwidth, no camera, keyboard, touch, reduced motion, and a non-spatial DOM path. The world should enrich the workflow, not gate it.

## 9. Three distinct product directions

### Direction A — Study Guilds Campus

**Product thesis:** Online-degree students return when the product helps them begin, finish, and repeat real study with a small set of relevant peers.

- **Target user:** self-directed online-degree students balancing study with work or family.
- **Core problem:** weak external structure, isolation, and difficulty forming dependable study relationships.
- **Core loop:** next task → commit to a bounded session → join pod/open hall → focus → check out → schedule next/help.
- **Key features:** lightweight academic profile, Today view, structured focus sessions, stable 3–6 person pods, open overflow study hall, session outcomes, availability, course communities, lightweight help handoff, progress.
- **Metaverse role:** optional social-presence layer, session lobby, course commons, project studios, events, and breaks.
- **Games role:** brief consensual social decompression after sessions; no core progression from unrelated scores.
- **Retention:** commitments, repeat peers, visible useful progress, next-session scheduling, timely reminders.
- **Network effects:** more course peers improve matching and session liquidity; stable pods create relationship capital; helpful contributions build trust.
- **Monetisation:** student premium for deeper planning/analytics/customisation; later institution-sponsored cohorts and peer-host programs.
- **Technical complexity:** medium. Reuses rooms, meetings, presence, and state-machine patterns; needs new persistent domain and non-spatial IA.
- **Main risks:** insufficient cohort density, focus sessions become a commodity, users stay in WhatsApp/Discord, or progression feels manipulative.
- **Expected ROI:** high. The smallest version can be validated manually before large architecture investment.
- **Why it could win:** combines course context, accountability, live presence, and repeat relationships better than generic focus or chat tools.
- **Why it could fail:** if students do not value scheduled peer accountability or the product cannot seed enough relevant peers per time slot.

### Direction B — Live Peer Help Exchange

**Product thesis:** The fastest route to retention is becoming the place where a student gets unstuck from a specific course problem now, then preserves the answer for others.

- **Target user:** students in difficult, high-enrolment online courses; peer mentors and teaching assistants.
- **Core problem:** high friction and delay in asking contextual questions and finding trustworthy help.
- **Core loop:** tag a doubt → route to available peer/mentor → resolve via text/voice/whiteboard → save answer → endorse → helper reputation grows.
- **Key features:** course/topic graph, help queue, availability, persistent Q&A, office hours, endorsements, reputation, moderation, escalation.
- **Metaverse role:** visible help desk, office hours, topic tables, and embodied handoff into a room.
- **Games role:** almost none; occasional icebreakers or event breaks.
- **Retention:** unresolved/resolved questions, contribution identity, course knowledge base, scheduled office hours.
- **Network effects:** question/answer corpus and trust graph compound; more helpers lower response time.
- **Monetisation:** institutional support contracts, sponsored peer mentors, optional tutoring marketplace.
- **Technical complexity:** high. Search, moderation, quality, reputation, routing, abuse, and academic-integrity controls are substantial.
- **Main risks:** cold-start liquidity, wrong answers, plagiarism/assessment abuse, safeguarding, and competition from Ed/Piazza/InScribe.
- **Expected ROI:** medium-high if seeded through one large course; low if launched broadly without supply.
- **Why it could win:** live presence plus persistent knowledge is underexplored.
- **Why it could fail:** response quality and supply may not beat established course forums.

### Direction C — Institutional Virtual Cohort Campus

**Product thesis:** Sell online programs a branded, persistent cohort campus for events, office hours, project work, and community operations.

- **Target user/buyer:** online universities, cohort-course providers, bootcamps, and student-success teams.
- **Core problem:** fragmented cohort engagement and low sense of presence across LMS, video, and chat tools.
- **Core loop:** institution schedules activity → students receive reminder → join branded space → participate → follow-up and aggregate outcomes return to staff.
- **Key features:** tenant isolation, roles, SSO/LMS/calendar integration, event scheduling, moderation, admin console, attendance, privacy-safe analytics, branded worlds.
- **Metaverse role:** central event and cohort venue; stronger than in the other directions.
- **Games role:** event icebreakers and community rituals, never the academic value proposition.
- **Retention:** institution programming cadence, cohorts, projects, staff presence, and events.
- **Network effects:** mostly local to each institution; cross-institution effects are limited unless alumni/mentor networks are added.
- **Monetisation:** annual institutional licence, setup/integration, premium events/support.
- **Technical complexity:** very high. Current schema and hardcoded space are not tenant-ready; compliance and support expectations rise sharply.
- **Main risks:** long sales cycle, buyer/user conflict, surveillance concerns, custom-work trap, and weak student pull.
- **Expected ROI:** potentially high contract value, but slow and risky before retention proof.
- **Why it could win:** current campus/media/event infrastructure fits the demonstration and buyer story.
- **Why it could fail:** institutions can assemble LMS + Meet + Discord/Teams more cheaply and students may not return outside mandatory events.

## 10. Weighted decision matrix

Scoring uses 1–5, where 5 is best. “Cost efficiency” and “technical risk” score higher when cost/risk is lower. Weights total 100.

| Criterion | Weight | A: Study Guilds | B: Peer Help | C: Institutional Campus |
| --- | ---: | ---: | ---: | ---: |
| User value | 18 | 5 | 5 | 4 |
| Retention potential | 17 | 5 | 4 | 3 |
| Differentiation | 12 | 4 | 5 | 3 |
| Development cost efficiency | 10 | 4 | 2 | 2 |
| Technical risk | 8 | 4 | 2 | 3 |
| Time to value | 10 | 5 | 3 | 2 |
| Monetisation potential | 8 | 4 | 3 | 5 |
| Network effects | 7 | 4 | 5 | 3 |
| Fit with current codebase | 5 | 4 | 3 | 5 |
| Cheap validation | 5 | 5 | 3 | 2 |
| **Weighted total** | **100** | **4.50 / 5** | **3.73 / 5** | **3.19 / 5** |

Sensitivity:

- Direction B can win if evidence shows “get unstuck now” is substantially stronger than accountability and one high-enrolment course can seed reliable helper supply.
- Direction C can win if an institution is already willing to fund a pilot and accepts a narrow, non-white-label first version.
- Without either external advantage, Direction A has the best balance of value, retention, reuse, risk, and validation speed.

## 11. Historical recommendation — superseded

> The following Study Guilds recommendation records the audit's original conclusion. The owner rejected it as Hyprverse's product centre on 2026-07-11. It is retained for decision history only and must not be used as implementation guidance.

Choose **Direction A — Study Guilds Campus** as the product centre.

Preserve two elements from Direction B:

1. A lightweight course/topic help request linked to live availability.
2. A short post-resolution note that can later grow into reusable Q&A.

Preserve two elements from Direction C:

1. Clean community/tenant boundaries in the domain model so institutional pilots remain possible.
2. Events and privacy-safe aggregate analytics as later validated expansion paths.

Do not begin with a full Q&A/reputation marketplace or a multi-tenant institutional platform. Validate the smallest recurring accountability workflow first.

### Recommended product promise

> Hyprverse helps online-degree students show up, study with the right people, get unstuck, and keep going—inside a campus that feels alive when presence adds value.

### Recommended core loop

1. **Orient:** Today shows the most relevant next task, upcoming session, pod activity, and unresolved help.
2. **Commit:** student chooses a course, states one outcome, and selects 25/50/75 minutes.
3. **Join:** one click enters a pod room or open hall; camera remains optional and media starts muted.
4. **Focus:** clear timer/state, quiet presence, optional text/audio, low-distraction world mode.
5. **Check out:** done/partial/blocked, one sentence learned/next action.
6. **Continue:** schedule the next session, ask for help, or take a brief pod break.
7. **Accumulate:** progress, reliability, repeat-peer history, and helpful contributions become visible.

### Role of the metaverse

- **Use it for:** legible presence, spontaneous encounters, transition into groups, course identity, events, project rooms, celebrations, and short breaks.
- **Do not require it for:** seeing Today, scheduling/joining a session, asking/answering a doubt, reading progress, managing notifications, or accessibility-critical actions.
- **Rule:** every spatial step must earn its time cost by improving presence, trust, context, or emotion.

### Role of games

- No new games in the first two product phases.
- De-feature 2048 and generic leaderboards from the main story.
- Keep existing games available as low-priority campus extras.
- Test one scheduled “pod break” using Snake or Connect Four.
- Invest only if the experiment improves study-session completion, return-to-next-block, or repeat-peer interaction without reducing academic progress.

## 12. Historical initiative portfolio — superseded

> This table preserves the audit's pre-decision proposals. It is not an approved backlog. Only work included by [`product-direction.md`](./product-direction.md) or a later owner-approved specification may be implemented.

Legend: impact/effort/risk/validation use L/M/H; confidence is current strategic confidence, not implementation certainty.

| Priority | Initiative | Class | User impact | Strategic impact | Eng | Design | Dependency risk | Validation difficulty | Confidence | ROI | Reversible | Experiment first |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | Product event dictionary, funnel, cohorts, Web Vitals, crash-free sessions | Introduce | H | H | M | L | M | L | High | Very high | Yes | No |
| P0 | Default mic/cam off, first-use consent, device preview, clear media states | Repair | H | H | M | M | M | L | High | Very high | Yes | No |
| P0 | Phone portrait access; mobile-first non-spatial Today/session path | Repair/Replace | H | H | H | H | M | M | High | High | Partly | Prototype first |
| P0 | World chat throttling, mute/block/report, basic moderation trail | Repair | H | H | M | M | M | M | High | High | Yes | No |
| P0 | Movement plausibility and proximity validation for stage/room/seat/board actions | Repair | M | H | H | L | H | M | High | High | Feature flag | No |
| P0 | Listener cleanup, reconnect position convergence, explicit media/loading/error states | Repair | H | H | M | M | M | M | High | High | Yes | No |
| P0 | Accessibility foundation: modal focus, Tab behaviour, keyboard tiles/map alternative, reduced motion | Repair | H | H | M | H | M | M | High | High | Yes | No |
| P0 | De-feature 2048 and arcade leaderboard from core messaging; freeze new games | Remove/Defer | L | H | L | L | L | L | High | Very high | Yes | No |
| P1 | Align LiveKit versions, signaling test, staging environment, database backups | Repair | M | H | M | L | H | M | High | High | Partly | No |
| P1 | Replace landing promise with study outcome; progressive course/term/time-zone onboarding | Replace | H | H | M | H | M | M | Medium-high | High | Yes | Test copy/prototype |
| P1 | Today/arrival surface with one clear next action and optional campus entry | Replace | H | H | H | H | H | M | High | Very high | Feature flag | Prototype first |
| P1 | Structured study-session MVP: intent, duration, join, focus state, check-out, next action | Introduce | H | H | H | H | H | M | High | Very high | Feature flag | Concierge first |
| P2 | Stable 3–6 person study pods plus open-hall overflow | Introduce | H | H | H | H | H | H | Medium | High | Yes | Manual matching first |
| P2 | Course/topic availability and lightweight “I’m stuck” help request | Experiment | H | H | H | H | H | H | Medium | High | Yes | Concierge first |
| P2 | Useful progress and reliability model with grace; no raw-hours global ranking | Introduce | M | H | M | H | M | M | Medium-high | High | Yes | A/B progression concepts |
| P2 | Session/event notifications with quiet hours, digest, and deep links | Improve | H | H | M | M | M | M | High | High | Yes | Channel opt-in test |
| P2 | Snake as 3–5 minute pod-break ritual with smooth controls/levels/touch | Experiment/Improve | M | M | M | M | L | M | Medium | Medium | Yes | Yes |
| P2 | Connect Four embodied presentation, drop animation, rematch | Defer/Experiment | L–M | L–M | M | M | M | M | Medium-low | Low–medium | Yes | Social-break test first |
| P3 | Persistent resolution notes and searchable course Q&A | Introduce | H | H | H | H | H | H | Medium | Medium-high | Partly | Start with resolution note |
| P4 | Institutional pilot: private cohort, roles, events, aggregate analytics | Experiment | M | H | H | H | H | H | Medium | Potentially high | Contract-scoped | Paid design partner first |
| P4 | LMS write-back, SSO, full white-labeling, native mobile app, tutor marketplace, AI tutor | Defer | Unknown | M | Very high | H | Very high | H | Low | Unknown | Varies | Yes |

### Explicit removal/defer calls

- **Remove from the product thesis:** “metaverse exploration” and arcade breadth as reasons to return.
- **Remove immediately:** stale room-key help copy and dead stage-key styling.
- **Repair before growth:** media consent, mobile access, chat safety, authority boundaries, reconnect/listener reliability, accessibility, and error truthfulness.
- **Improve after evidence:** Snake and Connect Four only as bounded social-break formats.
- **Replace:** landing proposition and unstructured empty-world arrival.
- **Introduce:** analytics, academic context, sessions, pods, useful progress, and help continuity.
- **Experiment:** concierge focus sessions, manual pods, live help, pod breaks, and one institutional design partner.
- **Defer:** new games, 3D, large progression economies, AI tutoring, full LMS replacement, and broad multi-tenant platform work.

## 13. Specification gate

The approved high-level thesis is intentionally not yet converted into a Wayfinder map or implementation issues.

The owner has approved the broad destination: Hyprverse is a Student Social World for one bounded community, centred on entering, seeing familiar students, meeting or talking, and doing something together. Further concepts—Cooperative Campus Missions, group-first progression, crews, cosmetics, and world unlocks—are retention hypotheses, not MVP commitments. Destination grilling paused on 2026-07-11 when the abstraction obscured the simple product idea; the next step is to validate and polish the existing meet-and-play social-campus loop before selecting deeper progression systems.

With the direction now approved, the implementation workflow is:

1. Confirm current code, production, issue, CI, and deployment state against the audit.
2. Define the pilot measurement model and dependency-ordered vertical slices.
3. Publish implementation-ready specifications and `ready-for-agent` issues.
4. Deliver foundation repairs before arrival, media, world, and game polish.
5. Gate every slice on independent review, CI, deployment health where applicable, and production QA.

## 14. Open questions, risks, and decision log

### Open strategic questions

1. Will invited students repeatedly enter, find one another, talk or meet, and play together in the current campus concept?
2. Which existing interaction most reliably starts and extends a real group session?
3. What safety and moderation responsibility can the operator support during a community pilot?
4. Is phone portrait required for the first pilot or can it begin desktop-first?

### Principal risks

- Cohort density is insufficient, making matching and the campus feel empty.
- Students appreciate the concept but do not change behaviour from existing tools.
- Academic context becomes an expensive LMS clone.
- Accountability becomes surveillance, shame, or forced camera use.
- Help features create misinformation or academic-integrity issues.
- Institution requirements pull the roadmap into custom integrations before student retention is proven.
- The spatial layer continues to consume engineering effort without measurable value.

### Decision log

| Date | Status | Decision or hypothesis | Evidence/rationale |
| --- | --- | --- | --- |
| 2026-07-10 | Confirmed fact | Current persistent domain is users/spaces/rooms/seats/arcade scores, not academic work. | Repository migrations, REST, shared contracts. |
| 2026-07-10 | Confirmed fact | Current product retention and feature value are not measurable. | No product analytics found. |
| 2026-07-10 | Confirmed fact | Realtime/media, shared contracts, state machines, tests, and deployment are reusable strengths. | Code and CI audit. |
| 2026-07-10 | Rejected by later owner decision | Choose Study Guilds Campus as the strategic centre. | Superseded by the 2026-07-11 Student Social World thesis. |
| 2026-07-10 | Historical recommendation, not approved | Make the world optional for task navigation and keep it for presence/relationships/events. | Spatial-tax evidence remains useful, but the proposed non-spatial academic product is outside the approved MVP. |
| 2026-07-10 | Recommended, awaiting owner | Freeze new games and validate one bounded social-break use before further investment. | No analytics; games do not connect to academic state; competitor loops reward useful action. |
| 2026-07-11 | Reopened after owner feedback | Reconsider academic progress as the single primary outcome; evaluate Hyprverse as a student digital third place designed for valuable, long social sessions, with study as an anchor rather than a replacement for learning. | Owner wants sustained voluntary use and describes the experience as an overall chill game; raw screen time remains an unsafe and gameable success metric. |
| 2026-07-11 | Owner-approved thesis | Hyprverse is a Student Social World: relationships and shared activities are the product centre; study is one activity, not the replacement for formal learning; games support the world rather than defining a standalone game portal. | Owner explicitly selected the social-world direction after comparing it with study-first and game-first alternatives. |
| 2026-07-11 | Owner-approved launch constraint | Launch with one bounded student community rather than opening to all students. | Concentrated relevance and simultaneous presence are necessary to avoid an empty-world cold start. |
| 2026-07-11 | Owner-approved core loop, later simplified | Use the Social Momentum Loop: enter, notice friends, join them, choose a shared activity, then continue into another activity. | The later canonical brief removed any implied progression requirement; social momentum does not depend on earning or changing persistent state. |
| 2026-07-11 | Explored and then deferred | Use short Cooperative Campus Missions to connect conversation, games, exploration, events, and collaboration into shared outcomes. | The owner paused this direction and returned the MVP to validating the existing meet-and-play loop. |
| 2026-07-11 | Explored and then deferred | Make progression group-first through shared unlocks or world changes, while individuals receive cosmetics, titles, collections, and contribution records without power advantages. | Progression, cosmetics, and world unlocks are later hypotheses, not MVP commitments. |
