# Spec 26 — Moderator dashboard (small, in-app)

Requested by Raja 2026-07-12. Goal: allowlisted moderators handle reports in the app instead of curl.
Backend surface already exists and is live (see `docs/FEATURES.md` §18) — **this is a frontend-only feature
plus (at most) additive read endpoints; no changes to existing backend routes or wire shapes.**

## Product shape

- A lazy-loaded HUD panel (`frontend/src/ui/mod/ModPanel.tsx`, own chunk — bundle budget must not grow),
  opened from a "Moderation" button in the Settings panel.
- **Visibility gating**: signin returns only `{ token }`, so on first Settings open the client probes
  `GET /api/v1/mod/reports`. 404 ⇒ not a moderator ⇒ the button never renders (matches the server's
  404-hiding design; no new "am I a moderator" endpoint). 200 ⇒ show button + cache result for the session.
- Panel contents (keep it small):
  1. **Reports list**: reporter, target, reason, created time; newest first. Refresh button — no polling.
  2. Per report: **Dismiss**, **Warn…**, **Suspend…** (duration presets 1h/24h/7d → epoch-ms `until`,
     optional reason text) using the existing `moderation*Schema` shapes from `@metaverse/shared`.
  3. **Unsuspend** action reachable from a suspended target's row/detail.
  4. Every action: optimistic-free — disable button while in flight, re-fetch list on success, surface the
     typed error text on failure.
- Theme: match the existing HUD panels (Settings/BoardTablePanel) — same fonts, colors, spacing, overlay
  focus behavior. Reuse the accessible overlay/focus primitive from PR #141. Escape closes.

## Conventions that bind this work

- All client decision logic (probe-state machine, report row view-model, duration→until mapping, error
  mapping) in a pure module `frontend/src/game/modPanel.ts` (no React/DOM/net imports) + vitest table tests,
  same commit. React component is thin glue, tested with RTL + jsdom (stub fetch; assert rendered rows and
  the request the buttons fire).
- Wire shapes: import ONLY from `@metaverse/shared` (`moderationWarnSchema` etc. types). If the reports
  list response shape is not yet in `shared/src/rest.ts`, add it THERE (zod schema + inferred type) and use
  it on both sides — never redeclare locally.
- Strict TS (no `!`, `exactOptionalPropertyTypes`), lazy `React.lazy` chunk, no new pipeline stages.
- No full local builds/test suites — CI is the gate (repo hard rule).

## Out of scope

- Moderation history browsing, audit-table UI, pagination beyond a simple cap, server changes to
  auth/roles, notifications. Phase 2 if needed.
