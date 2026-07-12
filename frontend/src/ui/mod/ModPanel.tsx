/**
 * Moderator dashboard HUD panel (spec 26). Lazy-loaded so its code stays in its
 * own chunk (the entry-bundle budget must not grow). A thin renderer over the
 * pure `game/modPanel` view model and the `net/moderation` REST client: it lists
 * the open report queue and fires dismiss / warn / suspend / unsuspend actions.
 *
 * Actions are optimistic-free: the fired button (and its siblings) disable while
 * the request is in flight, the list re-fetches on success, and a typed error is
 * surfaced on failure. Escape / backdrop close via the shared Dialog primitive.
 */
import { useCallback, useEffect, useState } from "react";
import Dialog from "../Dialog";
import {
  moderationErrorText,
  reportRows,
  SUSPEND_PRESETS,
  suspendUntil,
  presetById,
  type ModErrorCode,
  type ReportRowView,
} from "../../game/modPanel";
import {
  dismissReport,
  fetchReports,
  suspendUser,
  unsuspendUser,
  warnUser,
  type ModActionResult,
} from "../../net/moderation";
import "./ModPanel.css";

export interface ModPanelProps {
  onClose: () => void;
}

interface Editor {
  reportId: string;
  targetId: string;
  kind: "warn" | "suspend";
}

const TITLE_ID = "mod-panel-title";

export default function ModPanel({ onClose }: ModPanelProps) {
  const [rows, setRows] = useState<ReportRowView[] | null>(null);
  const [loadError, setLoadError] = useState<ModErrorCode | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [reason, setReason] = useState("");
  const [presetId, setPresetId] = useState<string>(SUSPEND_PRESETS[0]?.id ?? "");

  // State is only committed inside the .then callback, never synchronously in the
  // effect body (react-hooks/set-state-in-effect) — same shape as ArcadeOverlay.
  const load = useCallback(
    () =>
      fetchReports().then((result) => {
        if (result.ok) {
          setRows(reportRows(result.reports, Date.now()));
          setLoadError(null);
        } else {
          setLoadError(result.code);
          setRows([]);
        }
        setLoading(false);
      }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = () => {
    setLoading(true);
    void load();
  };

  const closeEditor = () => {
    setEditor(null);
    setReason("");
    setPresetId(SUSPEND_PRESETS[0]?.id ?? "");
  };

  const runAction = async (label: string, fn: () => Promise<ModActionResult>) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    const result = await fn();
    setBusy(false);
    if (result.ok) {
      closeEditor();
      setNotice(`${label} — done.`);
      await load();
    } else {
      setActionError(moderationErrorText(result.code));
    }
  };

  const onSubmitEditor = () => {
    if (!editor) return;
    const trimmed = reason.trim();
    if (editor.kind === "warn") {
      void runAction("Warning recorded", () => warnUser(editor.targetId, trimmed ? trimmed : undefined));
      return;
    }
    const preset = presetById(presetId);
    if (!preset) return;
    void runAction("User suspended", () =>
      suspendUser(editor.targetId, suspendUntil(Date.now(), preset.ms), trimmed ? trimmed : undefined),
    );
  };

  return (
    <Dialog
      onClose={onClose}
      labelledBy={TITLE_ID}
      className="mod-panel"
      backdropClassName="mod-backdrop"
    >
      <div className="mod-panel__head">
        <h2 id={TITLE_ID} className="mod-panel__title">
          Moderation
        </h2>
        <div className="mod-panel__head-actions">
          <button type="button" className="mod-btn" onClick={refresh} disabled={loading || busy}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="mod-btn" onClick={onClose} aria-label="Close moderation panel">
            Close
          </button>
        </div>
      </div>

      {notice && (
        <div className="mod-panel__notice" role="status">
          {notice}
        </div>
      )}
      {actionError && (
        <div className="mod-panel__error" role="alert">
          {actionError}
        </div>
      )}
      {loadError && (
        <div className="mod-panel__error" role="alert">
          {moderationErrorText(loadError)}
        </div>
      )}

      <div className="mod-panel__list">
        {rows === null && <div className="mod-panel__empty">Loading reports…</div>}
        {rows !== null && rows.length === 0 && !loadError && (
          <div className="mod-panel__empty">No open reports.</div>
        )}
        {rows?.map((row) => {
          const isEditing = editor?.reportId === row.id;
          return (
            <div key={row.id} className="mod-report">
              <div className="mod-report__meta">
                <span className="mod-report__cat">{row.category}</span>
                <span className="mod-report__time">{row.createdLabel}</span>
              </div>
              <div className="mod-report__ids">
                <span>
                  <span className="mod-report__k">reporter</span> {row.reporterId}
                </span>
                <span>
                  <span className="mod-report__k">target</span> {row.targetId}
                </span>
              </div>
              {row.snapshot && <div className="mod-report__snapshot">“{row.snapshot}”</div>}
              {row.note && <div className="mod-report__note">Note: {row.note}</div>}

              <div className="mod-report__actions">
                <button
                  type="button"
                  className="mod-btn"
                  disabled={busy}
                  onClick={() => void runAction("Report dismissed", () => dismissReport(row.id))}
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  className="mod-btn"
                  disabled={busy}
                  onClick={() => {
                    setActionError(null);
                    setReason("");
                    setEditor({ reportId: row.id, targetId: row.targetId, kind: "warn" });
                  }}
                >
                  Warn…
                </button>
                <button
                  type="button"
                  className="mod-btn"
                  disabled={busy}
                  onClick={() => {
                    setActionError(null);
                    setReason("");
                    setPresetId(SUSPEND_PRESETS[0]?.id ?? "");
                    setEditor({ reportId: row.id, targetId: row.targetId, kind: "suspend" });
                  }}
                >
                  Suspend…
                </button>
                <button
                  type="button"
                  className="mod-btn mod-btn--ghost"
                  disabled={busy}
                  onClick={() => void runAction("Suspension lifted", () => unsuspendUser(row.targetId))}
                >
                  Unsuspend
                </button>
              </div>

              {isEditing && (
                <div className="mod-editor">
                  {editor.kind === "suspend" && (
                    <label className="mod-editor__row">
                      <span>Duration</span>
                      <select value={presetId} onChange={(e) => setPresetId(e.target.value)} disabled={busy}>
                        {SUSPEND_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="mod-editor__row">
                    <span>Reason</span>
                    <input
                      type="text"
                      value={reason}
                      placeholder="Optional"
                      maxLength={280}
                      onChange={(e) => setReason(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <div className="mod-editor__actions">
                    <button type="button" className="mod-btn" onClick={closeEditor} disabled={busy}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="mod-btn mod-btn--primary"
                      onClick={onSubmitEditor}
                      disabled={busy}
                    >
                      {editor.kind === "warn" ? "Record warning" : "Suspend user"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
