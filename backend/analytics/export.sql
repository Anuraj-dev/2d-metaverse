-- Run only with operator database credentials. The caller supplies the output
-- path through shell redirection; this query never exposes auth secrets or IPs.
\copy (SELECT event_id, event_name, actor_user_id, properties, occurred_at, expires_at FROM active_analytics_events WHERE occurred_at >= now() - interval '90 days' AND expires_at > now() ORDER BY occurred_at, event_id) TO STDOUT WITH (FORMAT csv, HEADER true)
