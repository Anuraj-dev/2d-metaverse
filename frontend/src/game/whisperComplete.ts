/**
 * Pure whisper name-completion for the chat input (PRD 25.16).
 *
 * The chat box lets a player type `/w <partial>` and press Tab to cycle through
 * the online names that match the partial. That decision — *is this text a
 * whisper-name prefix, and if so what is the next completion?* — lives here as a
 * plain function so the React component only owns focus/state glue.
 *
 * Crucially this also decides when Tab should be **consumed** at all: it returns
 * `null` when the text is not a whisper-name prefix, or when no online name
 * matches. The component only calls `preventDefault()` on a non-null result, so
 * Tab otherwise falls through to normal focus movement and leaves the chat input
 * (the "Tab leaves chat unless a real completion exists" rule).
 */

const WHISPER_NAME_RE = /^(\/(?:w|whisper|msg|tell)\s+)(\S*)$/i;

/** The completion cursor carried between successive Tab presses. */
export interface CompletionState {
  /** The partial name the cursor is cycling matches for (fixed across cycles). */
  base: string;
  /** Index of the last-chosen match within the (stable) match list. */
  idx: number;
}

/** A resolved completion: the new full input text plus the advanced cursor. */
export interface CompletionResult {
  text: string;
  state: CompletionState;
}

/**
 * The whisper-name partial being typed, or `null` when the text isn't a
 * `/w <name>` prefix. Used for live suggestion chips (empty string = the command
 * was typed with no name yet, so show every candidate).
 */
export function whisperNameToken(text: string): string | null {
  const m = text.match(WHISPER_NAME_RE);
  return m ? (m[2] ?? "") : null;
}

/**
 * Next whisper completion for a Tab press, or `null` when Tab should not be
 * consumed (text isn't a whisper-name prefix, or nothing matches).
 *
 * @param text   current input value
 * @param names  online candidate names (self already excluded by the caller)
 * @param prev   the cursor from the previous consecutive Tab, or `null` to start
 */
export function whisperCompletion(
  text: string,
  names: readonly string[],
  prev: CompletionState | null,
): CompletionResult | null {
  const m = text.match(WHISPER_NAME_RE);
  if (!m) return null;
  const prefix = m[1] ?? "";
  const base = prev?.base ?? m[2] ?? "";
  const lower = base.toLowerCase();
  const matches = names.filter((n) => n.toLowerCase().startsWith(lower));
  if (matches.length === 0) return null;
  const idx = ((prev?.idx ?? -1) + 1) % matches.length;
  const chosen = matches[idx];
  if (chosen === undefined) return null;
  return { text: prefix + chosen, state: { base, idx } };
}
