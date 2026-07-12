-- Active-query boundary and a database backstop for every allowlisted payload.
ALTER TABLE analytics_events
  ADD CONSTRAINT analytics_properties_bounded
  CHECK (octet_length(properties::text) <= 2048);

CREATE VIEW active_analytics_events AS
SELECT event_id, event_name, actor_user_id, properties, occurred_at, expires_at
  FROM analytics_events
 WHERE expires_at > now();
