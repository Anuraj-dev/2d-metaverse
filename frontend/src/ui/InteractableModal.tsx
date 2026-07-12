import { useEffect, useState } from "react";
import { CircleHelp, FileText, Gamepad2, Orbit, SquarePen, type LucideIcon } from "lucide-react";
import { bus } from "../game/eventBus";
import type { InteractableType } from "../game/interactables";
import Dialog from "./Dialog";

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
    <Dialog
      onClose={() => setModal(null)}
      label={modal.label}
      backdropClassName="modal-backdrop"
      className="interactable-modal"
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
    </Dialog>
  );
}
