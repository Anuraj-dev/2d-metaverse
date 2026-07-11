# Hyprverse — approved product direction

> **Status:** Owner-approved direction for planning and agent handoff
> **Approved:** 2026-07-11
> **Scope:** Product intent and MVP priorities, not an implementation specification

## Read this first

Hyprverse is a **private Student Social World for one bounded student community**.

Its promise is simple:

> Meet your online classmates in a campus that feels alive: see familiar people, talk, join meetings, and play together without coordinating across separate apps.

The first version does not need to replace classes, an LMS, Discord, WhatsApp, or dedicated games. It needs to make being together online feel easier, warmer, and more cohesive.

## Product thesis

Online students often coordinate through fragmented tools: messaging in one app, meetings in another, and games somewhere else. Those tools are useful, but they do not create the feeling of arriving somewhere and finding familiar people already present.

Hyprverse should provide that missing **place**.

The product is:

- A persistent campus for a known student community.
- A way to see who is present and what they are doing.
- A low-friction transition between conversation, meetings, games, and community activities.
- A social environment students voluntarily revisit because their people and recurring gatherings are there.

The product is not:

- A replacement for a degree, lectures, or the LMS.
- A productivity dashboard with a decorative map.
- A portal containing many unrelated mini-games.
- A game-first product competing on content volume.
- A public metaverse for every student at launch.
- A system designed to maximize raw screen time through addictive mechanics.

## Primary user and launch boundary

The initial user is a member of **one student community that Raja can personally seed with friends and other students**.

Launch closed and concentrated. Relevance and simultaneous presence matter more than total registrations. Do not build broad public discovery, institution-wide multi-tenancy, or complex matching before the first community repeatedly uses the product.

## Core value loop

The MVP loop is:

1. **Arrive:** log in and immediately understand who is online, where friends are, and what is happening.
2. **Join:** reach a friend, active room, meeting, or game without unnecessary map wandering.
3. **Connect:** talk through proximity voice, chat, or a meeting room with clear media consent.
4. **Do something together:** play a polished social game, continue a conversation, join a scheduled gathering, or collaborate.
5. **Continue naturally:** move as a group into another activity instead of returning to a disconnected menu.
6. **Return:** come back for familiar people and recurring community moments.

The world earns its existence by making presence, movement between groups, and shared context more tangible than a conventional dashboard.

## Session value

| Session length | A successful experience |
| --- | --- |
| 5–10 minutes | See who is present, greet friends, answer a message, or join one quick round. |
| 30–60 minutes | Hang out, play together, join a meeting, or participate in a community activity. |
| 1–3 hours | Move naturally between conversation, meetings, games, and an event with the same group. |

Long sessions are an outcome of social momentum, not the primary metric.

## MVP priorities

### 1. Make arrival immediately social

- Clearly show online friends, active rooms, meetings, games, and scheduled activity.
- Give the student one obvious way to join another person.
- Avoid an empty map as the only first impression.
- Explain controls and the value of the campus during first use.

### 2. Make communication trustworthy

- Microphone and camera start off until the student explicitly enables them.
- Make world voice, private-room media, stage state, and meeting state understandable.
- Repair loading, reconnect, empty, and error states.
- Add essential chat safety: mute, block, report, throttling, and moderation visibility.

### 3. Make meetings easy to enter and leave

- Preserve the existing proximity, private-room, meeting, screen-share, and stage strengths.
- Reduce unnecessary steps between seeing a gathering and joining it.
- Keep text-only and camera-off participation viable.
- Make status truthful: students should always know whether they are publishing, muted, connected, or waiting.

### 4. Ship two excellent social games, not many average games

- **Snake:** improve movement, input smoothness, touch controls, game feel, levels, difficulty scaling, feedback, and short-session replayability. Explore a social presentation such as rounds, spectating, or friendly community competition before committing to a multiplayer rewrite.
- **Connect Four:** retain the server-authoritative rules but redesign its presentation, feedback, animations, rematch flow, spectator clarity, and perceived quality.
- **2048 / the block game:** remove it from primary discovery and messaging. Keep it hidden or retire it unless pilot evidence shows that students value it.
- Do not add more games during the MVP. Existing games must first prove that they start conversations, hold groups together, or help groups transition between activities.

### 5. Create reasons to be present at the same time

- Run scheduled community sessions rather than expecting an empty world to self-populate.
- Initial formats can include game nights, casual meetups, project discussions, student events, and optional study-break gatherings.
- Show the next scheduled activity in the arrival experience.
- Use reminders sparingly and only for opted-in people, friends, or events.

### 6. Instrument the real product loop

No feature should be called successful based on novelty or anecdotes alone. Establish privacy-conscious analytics before expanding the concept.

Measure at minimum:

- Successful sign-in and world load.
- Time to first meaningful interaction.
- Sessions with two or more students present together.
- Conversation, meeting, and game starts and completions.
- Transitions between activities during one session.
- Repeated interaction between the same people or group.
- Next-day and next-week return.
- Crash-free sessions, reconnects, media failures, and perceived loading time.

Do not use raw hours online, chat volume, or idle presence as the north-star metric.

## Pilot plan

Start with approximately 20–50 invited students from the selected community.

For the first validation cycle:

1. Run two scheduled community sessions per week.
2. Ensure enough people arrive together to avoid an empty-world test.
3. Observe arrival, friend-finding, conversation starts, meeting entry, game choice, and activity transitions.
4. Interview participants immediately after sessions and again after several weeks.
5. Compare stated enthusiasm with actual voluntary return.

The pilot succeeds when students repeatedly meet and do things together without Raja individually pulling every person back each time.

## Product success model

### Provisional north-star metric

**Weekly Returning Social Groups:** the number of distinct groups of at least two students who share a meaningful interaction in Hyprverse during a week and return for another shared session within the following week.

The precise event and group-window definitions must be finalized in an analytics specification before implementation.

### Supporting measures

- Activation: meaningful interaction within the first visit.
- Social density: proportion of sessions containing another relevant student.
- Repeat relationships: students interacting with the same person again.
- Activity depth: group transitions from one activity to another.
- Event conversion: invited → attended → returned independently.
- Reliability: crash-free, reconnect-successful, and media-successful sessions.
- Safety: blocks, reports, moderation response, and unwanted-media incidents.

## Product principles

1. **People before features.** A smaller world with familiar people beats a larger empty one.
2. **One coherent place.** Meetings and games should feel like activities inside the campus, not separate products.
3. **Fast joining beats forced walking.** Spatial movement should create presence and serendipity, not obstruct an invited activity.
4. **Consent before media.** Camera and microphone are always understandable and user-controlled.
5. **Social quality before content quantity.** Polish a few group experiences before adding breadth.
6. **Program the community.** Scheduled rituals seed the behaviour software alone cannot create.
7. **Measure value, not addiction.** Return, relationships, and shared activity matter more than raw dwell time.
8. **Desktop-first may be a pilot constraint, not an excuse.** The current portrait/mobile failure must be explicit; it cannot silently exclude intended users.
9. **Safety is part of the MVP.** A private community still needs controls, moderation, and truthful state.
10. **Validate before building economies.** Progression can amplify proven behaviour but cannot manufacture a valuable social loop.

## Explicitly deferred hypotheses

These ideas may be tested later but are **not approved MVP scope**:

- Crews, guilds, or permanent small-group structures.
- Cooperative campus missions.
- Shared progression, currencies, economies, or world unlocks.
- Large cosmetic inventories or room ownership.
- Academic planning, focus-session systems, persistent Q&A, or LMS integrations.
- Institution-facing administration, SSO, white-labeling, and multi-tenancy.
- AI tutors, tutoring marketplaces, native mobile apps, 3D conversion, and new game breadth.

Promote one of these only when pilot evidence identifies a specific retention problem it can plausibly solve.

## Foundation repairs before growth

The product audit identified issues that can invalidate any pilot result:

- Missing product analytics.
- Microphone and camera starting without adequate consent.
- Unusable portrait/mobile world controls.
- Public chat without sufficient safety controls.
- Client-trusted movement and proximity-sensitive actions.
- Misleading stage/live state and some reconnect/listener fragility.
- Inconsistent accessibility, loading, empty, and error states.
- LiveKit development/production version drift.

Prioritize these according to pilot risk. See [`product-v2-strategy.md`](./product-v2-strategy.md) for evidence and affected systems.

## Instructions for agents

Before planning or changing code:

1. Read [`STATE.md`](./STATE.md), [`../CONTEXT.md`](../CONTEXT.md), this document, and `CLAUDE.md`.
2. Use [`product-v2-strategy.md`](./product-v2-strategy.md) as audit evidence, not as the current product thesis where it conflicts with this document.
3. Keep the MVP centred on **arrive → find people → talk/meet → play or gather → continue together → return**.
4. Label assumptions and distinguish product hypotheses from confirmed behaviour.
5. Do not introduce missions, crews, economies, academic platforms, new games, or broad public discovery without a separately approved specification.
6. Preserve shared-contract, strict TypeScript, pure game-logic, server-authority, media-isolation, testing, accessibility, security, and deployment conventions.
7. Never run full local build or test gates; this repository uses CI for full verification.
8. Do not create implementation issues from this brief alone. First define the validation slice and implementation specification.

## Related documents

- [`product-v2-strategy.md`](./product-v2-strategy.md) — complete research, codebase audit, browser audit, competitive evidence, and discarded/alternate directions.
- [`STATE.md`](./STATE.md) — current repository and planning state.
- [`../CONTEXT.md`](../CONTEXT.md) — canonical product terminology.
- [`decisions.md`](./decisions.md) — append-only architectural and product decision history.
- [`conventions.md`](./conventions.md) and [`../CLAUDE.md`](../CLAUDE.md) — implementation rules.
