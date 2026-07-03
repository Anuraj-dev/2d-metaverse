/**
 * The cancelable "Meeting starting…" toast (PRD 10). Purely presentational —
 * App mounts it while the meeting reducer is in "countdown" and unmounts it on
 * cancel/start; the progress bar animates over the server-provided duration.
 * Deliberately dependency-free so it ships in the entry chunk (the heavy
 * meeting overlay is lazy-loaded).
 */
export default function MeetingCountdown({ durationMs }: { durationMs: number }) {
  return (
    <div className="meeting-countdown" role="status" data-testid="meeting-countdown">
      <span className="meeting-countdown-label">Meeting starting…</span>
      <span className="meeting-countdown-hint">stand up to cancel</span>
      <div className="meeting-countdown-bar">
        <div className="meeting-countdown-fill" style={{ animationDuration: `${durationMs}ms` }} />
      </div>
    </div>
  );
}
