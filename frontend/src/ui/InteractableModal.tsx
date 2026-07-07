import { useEffect, useState } from "react";
import { CircleHelp, FileText, Gamepad2, Orbit, SquarePen, type LucideIcon } from "lucide-react";
import { bus } from "../game/eventBus";
import type { InteractableType } from "../game/interactables";

interface ModalState {
  type: InteractableType;
  label: string;
  payload: Record<string, string | number>;
}

const ICON: Record<InteractableType, LucideIcon> = {
  info: FileText,
  whiteboard: SquarePen,
  arcade: Gamepad2,
  portal: Orbit,
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
        <div className="interactable-modal-icon">
          {(() => {
            const Icon = ICON[modal.type] ?? CircleHelp;
            return <Icon size={34} aria-hidden="true" />;
          })()}
        </div>
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
