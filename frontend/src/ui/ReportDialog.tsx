import { useEffect, useId, useRef, useState } from "react";
import { LIMITS, type ReportCategory } from "@metaverse/shared";
import { DEFAULT_REPORT_CATEGORY, REPORT_CATEGORY_OPTIONS } from "../game/report";

interface ReportDialogProps {
  /** Display name of the reported message's author. */
  name: string;
  /** The reported line's text, shown read-only so the reporter sees what they flag. */
  text: string;
  /** Submit the chosen category + optional note. Disabled UI awaits this promise. */
  onSubmit: (category: ReportCategory, note: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Report-a-message modal (PRD 25.12). Semantic dialog: labelled, focus-contained
 * on the reason picker, Escape closes, and focus is restored to the trigger on
 * close. The reporter picks only a reason category (+ an optional short note); the
 * server binds who/what from its own message snapshot.
 */
export default function ReportDialog({ name, text, onSubmit, onClose }: ReportDialogProps) {
  const titleId = useId();
  const [category, setCategory] = useState<ReportCategory>(DEFAULT_REPORT_CATEGORY);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Remember the trigger so focus can return to it, then focus the picker.
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    selectRef.current?.focus();
    return () => restoreRef.current?.focus();
  }, []);

  const close = () => {
    if (!busy) onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(category, note.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mc-report-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="mc-report"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      >
        <h2 id={titleId} className="mc-report-title">
          Report {name}'s message
        </h2>
        <blockquote className="mc-report-quote">{text}</blockquote>
        <form onSubmit={submit}>
          <label className="mc-report-label" htmlFor={`${titleId}-cat`}>
            Reason
          </label>
          <select
            id={`${titleId}-cat`}
            ref={selectRef}
            value={category}
            onChange={(e) => setCategory(e.target.value as ReportCategory)}
            disabled={busy}
          >
            {REPORT_CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <label className="mc-report-label" htmlFor={`${titleId}-note`}>
            Add context (optional)
          </label>
          <textarea
            id={`${titleId}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={LIMITS.reportNoteMax}
            rows={2}
            disabled={busy}
            placeholder="What's wrong with this message?"
          />
          <div className="mc-report-actions">
            <button type="button" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="mc-report-send" disabled={busy}>
              {busy ? "Sending…" : "Report"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
