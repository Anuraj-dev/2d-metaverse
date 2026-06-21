import { useEffect, useState } from "react";
import { bus } from "../game/eventBus";

/** Contextual prompt: "Press E to sit" near a seat. */
export default function InteractionHint() {
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    const offNear = bus.on("near-seat", () => setHint("Press E to sit"));
    const offLeave = bus.on("leave-seat", () => setHint(null));
    const offSat = bus.on("sat", () => setHint("Press E to stand"));
    const offStood = bus.on("stood", () => setHint(null));
    return () => {
      offNear();
      offLeave();
      offSat();
      offStood();
    };
  }, []);

  if (!hint) return null;
  return <div className="interact-hint">{hint}</div>;
}
