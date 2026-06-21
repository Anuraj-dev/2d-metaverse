import { useEffect, useState } from "react";

const CONTROLS: [string, string][] = [
  ["Move", "WASD / Arrow keys"],
  ["Run", "Hold Shift"],
  ["Sit / Stand", "E — when near a chair"],
  ["Enter a room", "Walk to its door, type the key"],
  ["Chat", "Click the chat box and type"],
  ["Find someone", "Open the 👥 roster, click a name"],
  ["Help", "Press ?"],
];

/** Controls cheat-sheet. Toggle with the ? button or the ? key. */
export default function HelpOverlay() {
  const [open, setOpen] = useState(false);

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
      else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        className="icon-btn help-btn"
        title="Controls (?)"
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Controls</h3>
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
          </div>
        </div>
      )}
    </>
  );
}
