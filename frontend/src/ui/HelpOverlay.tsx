import { useEffect, useState } from "react";
import { CircleHelp } from "lucide-react";
import Dialog from "./Dialog";

const CONTROLS: [string, string][] = [
  ["Move", "WASD / Arrow keys"],
  ["Run", "Hold Shift"],
  ["Interact", "E — sit, stand, doors, tables, arcade"],
  ["Enter a room", "Walk to its door, type the key"],
  ["Fullscreen map", "M (Esc to close)"],
  ["Chat", "Enter or T — / for a command"],
  ["Find someone", "Open the roster (top-right), click a name"],
  ["Arcade games", "Arrow keys / WASD — Space to flap"],
  ["Close overlay", "Escape"],
  ["Help", "Press ?"],
];

/** Controls cheat-sheet. Toggle with the ? button or the ? key. */
export default function HelpOverlay() {
  const [open, setOpen] = useState(false);

  // `?` toggles the sheet. Escape-to-close, focus, and containment are owned by
  // the Dialog primitive while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (typing) return;
      if (e.key === "?") setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* Hidden while the modal is open so the floating pill never paints over
          the card (PRD 23 fix); the modal owns its own close controls. */}
      {!open && (
        <button
          className="icon-btn help-btn"
          title="Controls (?)"
          aria-label="Show controls help"
          onClick={() => setOpen(true)}
        >
          <CircleHelp size={18} aria-hidden="true" />
        </button>
      )}
      {open && (
        <Dialog
          onClose={() => setOpen(false)}
          labelledBy="help-title"
          backdropClassName="modal-backdrop help-backdrop"
          className="help-modal"
        >
          <h3 id="help-title">Controls</h3>
          <ul className="help-list">
            {CONTROLS.map(([k, v]) => (
              <li key={k}>
                <b>{k}</b>
                <span>{v}</span>
              </li>
            ))}
          </ul>
          <button className="help-close" onClick={() => setOpen(false)}>
            Got it
          </button>
        </Dialog>
      )}
    </>
  );
}
