import { useEffect, useState } from "react";
import { bus } from "../game/eventBus";
import type { InteractableType } from "../game/interactables";

interface ModalState {
  type: InteractableType;
  label: string;
  payload: Record<string, string | number>;
}

const ICON: Record<InteractableType, string> = {
  info: "📋",
  whiteboard: "📝",
  arcade: "🕹️",
  portal: "🌀",
};

export default function InteractableModal() {
  const [modal, setModal] = useState<ModalState | null>(null);

  useEffect(() => {
    return bus.on<ModalState>("open-interactable", (p) => setModal(p));
  }, []);

  if (!modal) return null;

  return (
    <div className="modal-backdrop" onClick={() => setModal(null)}>
      <div
        className="interactable-modal"
        role="dialog"
        aria-modal="true"
        aria-label={modal.label}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="interactable-modal-icon">{ICON[modal.type] ?? "❓"}</div>
        <h3>{modal.label}</h3>
        <pre className="interactable-modal-content">
          {String(modal.payload.content ?? "")}
        </pre>
        <button className="interactable-modal-close" onClick={() => setModal(null)}>
          Close
        </button>
      </div>
    </div>
  );
}
