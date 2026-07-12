/**
 * Pure formatting for the chat anti-spam cooldown notice (PRD 25.11).
 *
 * The server refuses an over-limit chat / whisper / meeting send with a typed
 * `chat-cooldown` carrying `retryAfterMs`; the UI turns that into a short,
 * human line so the message never just vanishes. Pure per the scene-as-glue
 * convention: plain values in, string out — no Phaser, net, or DOM imports.
 */

/**
 * Whole seconds to advise the user to wait, from the server's `retryAfterMs`.
 * Rounds up (you must wait until the window fully resets) and never advises
 * "0s" — a refused send always implies at least a moment's wait.
 */
export function cooldownRetrySeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

/** The system line shown in a chat transcript when a send is rate-limited. */
export function chatCooldownNotice(retryAfterMs: number): string {
  return `You're sending messages too fast — wait ${cooldownRetrySeconds(retryAfterMs)}s.`;
}
