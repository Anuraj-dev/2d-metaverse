-- Moderator review and reversible action (PRD 25.14).
-- Builds on report ingestion (004) and persistent block (005). Three concerns:
--   1. A review lifecycle for each report (open → dismissed/actioned).
--   2. A cheap, current-state suspension record per user (the enforcement read
--      runs on every auth event — signin, socket handshake, media-token — so it
--      must be a single PK lookup, never a scan of an append-only history).
--   3. An append-only audit trail of every moderator action for accountability.
-- Retention stays minimal and privacy-safe: actor/target ids, action, timestamps,
-- and (for a suspension) its expiry + an optional short reason — never chat text.

-- 1. Report review status. Defaults to 'open' so existing rows enter the queue.
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- The moderator review queue reads open reports newest-first.
CREATE INDEX IF NOT EXISTS reports_status_created_idx ON reports (status, created_at DESC);

-- 2. Current-state suspensions: at most one active suspension per user, so the
-- enforcement path is a single primary-key lookup. Unsuspend DELETEs the row
-- (reversibility); the durable record of who suspended/reversed and when lives in
-- moderation_actions below. A row whose suspended_until is already in the past is
-- treated as not-suspended by the pure isSuspended() check (defence in depth).
CREATE TABLE IF NOT EXISTS suspensions (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  suspended_until timestamptz NOT NULL,
  reason          text,
  actor_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 3. Append-only moderation audit trail. One row per moderator action, kept even
-- after a report is deleted or a suspension is reversed, so the accountability
-- record survives. report_id / suspend_until are nullable (only some actions carry
-- them). No message text is stored here — the smallest justified snapshot already
-- lives on the report the action references.
CREATE TABLE IF NOT EXISTS moderation_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  target_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action        text NOT NULL,
  report_id     uuid,
  suspend_until timestamptz,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moderation_actions_target_idx ON moderation_actions (target_id, created_at DESC);
