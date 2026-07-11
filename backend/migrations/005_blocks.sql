-- Server-owned persistent block (PRD 25.13).
-- One directed row per (blocker, blocked). The pair is treated symmetrically for
-- delivery filtering (blocker never receives the blocked user's messages, and
-- vice versa) — the DB keeps only the directed intent so an unblock removes
-- exactly one side's decision. Retention is minimal: the two actor ids + when.
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  -- You cannot block yourself (also guarded server-side).
  CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id)
);

-- Load the symmetric relation on connect: who I blocked (PK covers this) and who
-- blocked me (this index) — both feed the in-memory delivery-filter cache.
CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks (blocked_id);
