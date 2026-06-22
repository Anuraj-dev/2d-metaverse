import { useEffect, useState } from "react";
import { bus } from "../game/eventBus";
import type { InteractableType } from "../game/interactables";

const INTERACT_VERB: Record<InteractableType, string> = {
  portal: "teleport",
  info: "view",
  whiteboard: "view",
  arcade: "play",
};

export default function InteractionHint() {
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    const offNearSeat  = bus.on("near-seat", () => setHint("Press E to sit"));
    const offLeaveSeat = bus.on("leave-seat", () => setHint(null));
    const offSat       = bus.on("sat",  () => setHint("Press E to stand"));
    const offStood     = bus.on("stood", () => setHint(null));
    const offNearIa    = bus.on(
      "near-interactable",
      (p: { label: string; type: InteractableType }) => {
        const verb = INTERACT_VERB[p.type] ?? "use";
        setHint(`Press E to ${verb}: ${p.label}`);
      }
    );
    const offLeaveIa = bus.on("leave-interactable", () => setHint(null));
    return () => {
      offNearSeat();
      offLeaveSeat();
      offSat();
      offStood();
      offNearIa();
      offLeaveIa();
    };
  }, []);

  if (!hint) return null;
  return <div className="interact-hint">{hint}</div>;
}
