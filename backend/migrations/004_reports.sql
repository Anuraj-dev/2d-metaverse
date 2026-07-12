-- Chat report ingestion + moderation trail (PRD 25.12).
-- One record per (reporter, message). Retention is deliberately minimised: we
-- keep actor (reporter_id), target (target_id), the reason category, timestamps,
-- and the smallest justified message reference (message_id) + snapshot
-- (message_text/scope) — never a full transcript. Author/target/text are bound
-- server-side from the message's own snapshot, so a report can never forge them.
CREATE TABLE IF NOT EXISTS reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id   text NOT NULL,
  message_text text NOT NULL,
  scope        text NOT NULL,
  category     text NOT NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- You cannot report your own message (also guarded server-side).
  CONSTRAINT reports_no_self CHECK (reporter_id <> target_id),
  -- Dedupe: a reporter flagging the same message twice is idempotent.
  UNIQUE (reporter_id, message_id)
);

-- Moderator review path (later slice): a target's reports, newest first.
CREATE INDEX IF NOT EXISTS reports_target_created_idx ON reports (target_id, created_at DESC);
