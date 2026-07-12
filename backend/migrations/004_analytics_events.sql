-- Privacy-bounded product analytics. Identity and time are server-owned; the
-- client supplies only an allowlisted event id/name envelope.
CREATE TABLE IF NOT EXISTS analytics_events (
  event_id uuid PRIMARY KEY,
  event_name varchar(64) NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT analytics_properties_object CHECK (jsonb_typeof(properties) = 'object'),
  CONSTRAINT analytics_expiry_after_occurrence CHECK (expires_at > occurred_at)
);

CREATE INDEX IF NOT EXISTS analytics_events_expiry_idx
  ON analytics_events (expires_at);

CREATE INDEX IF NOT EXISTS analytics_events_name_time_idx
  ON analytics_events (event_name, occurred_at DESC);
