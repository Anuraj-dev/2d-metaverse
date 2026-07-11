-- Pilot-safe event totals by UTC day. Add only reviewed JSON-property filters;
-- never join usernames or raw application content into product analytics.
SELECT date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS utc_day,
       event_name,
       count(*) AS events,
       count(DISTINCT actor_user_id) FILTER (WHERE actor_user_id IS NOT NULL) AS authenticated_students
  FROM analytics_events
 WHERE occurred_at >= now() - interval '90 days'
 GROUP BY utc_day, event_name
 ORDER BY utc_day, event_name;
