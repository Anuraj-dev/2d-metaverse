import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, MapPin, CalendarClock } from "lucide-react";
import type { ActiveSpace, PresencePerson, PresenceSnapshot } from "@metaverse/shared";
import { sharedNet } from "../net/shared";
import { bus } from "../game/eventBus";
import { emitAnalytics } from "../analytics";
import { socialArrivalView, type ArrivalStatus } from "../game/socialArrival";
import "./ArrivalPanel.css";

/**
 * Social-arrival HUD (PRD 25.26): "who is online and what's active", so arrival
 * starts social instead of on an empty map. Read-only — every control is a
 * truthful locate/view action (pan the camera to a student, open the map to a
 * space), never a join mutation (that is a later, server-authorised slice).
 *
 * All rules live in the pure `socialArrivalView`; this component only subscribes
 * to the server's `presence-snapshot`, renders the view, and emits bounded,
 * identity-free analytics.
 */
export default function ArrivalPanel() {
  const [snapshot, setSnapshot] = useState<PresenceSnapshot | null>(null);
  const [status, setStatus] = useState<ArrivalStatus>("loading");
  const [selfId, setSelfId] = useState(() => sharedNet().selfId);
  const [open, setOpen] = useState(true);
  const viewedRef = useRef(false);

  useEffect(() => {
    const net = sharedNet();
    const offSnapshot = net.on("presence-snapshot", (snap: PresenceSnapshot) => {
      setSnapshot(snap);
      setStatus("ready");
    });
    const offInit = net.on("init", (p: { selfId: string }) => setSelfId(p.selfId));
    const offError = net.on("connect_error", () => setStatus("failed"));
    return () => {
      offSnapshot();
      offInit();
      offError();
    };
  }, []);

  const view = useMemo(() => socialArrivalView({ status, snapshot, selfId }), [status, snapshot, selfId]);

  // Emit "arrival viewed" once, when the surface first shows real content.
  useEffect(() => {
    if (viewedRef.current) return;
    if (view.kind !== "active" && view.kind !== "empty") return;
    viewedRef.current = true;
    emitAnalytics({
      name: "social-arrival-viewed",
      properties: {
        onlineCount: view.kind === "active" ? view.onlineCount : 1,
        activeSpaces: view.kind === "active" ? view.spaces.length : 0,
        hasSchedule: view.kind === "active" && view.nextScheduled !== null,
      },
    });
  }, [view]);

  const locatePerson = (person: PresencePerson) => {
    emitAnalytics({ name: "presence-locate", properties: { targetKind: person.activity } });
    bus.emit("locate", { id: person.id });
  };

  const viewSpace = (space: ActiveSpace) => {
    emitAnalytics({ name: "presence-locate", properties: { targetKind: space.kind } });
    // Truthful "view": open the campus map so the student can see where it is.
    bus.emit("map-open");
  };

  const headerCount = view.kind === "active" ? view.onlineCount : undefined;

  return (
    <section className={`arrival ${open ? "open" : ""}`} aria-label="Who's around">
      <button
        className="arrival-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={headerCount === undefined ? "Who's around" : `Who's around — ${headerCount} online`}
      >
        <Sparkles size={14} aria-hidden="true" />
        <span>Around{headerCount !== undefined ? ` · ${headerCount}` : ""}</span>
      </button>

      {open && (
        <div className="arrival-body">
          <p className="arrival-status" role="status" aria-live="polite">
            {view.kind === "loading" && "Finding who's around…"}
            {view.kind === "offline" && "You're offline — reconnecting to see who's around."}
            {view.kind === "failed" && "Couldn't load who's around. It'll update when you reconnect."}
            {view.kind === "empty" && "Nobody else is around yet — walk out and explore, or start something."}
            {view.kind === "active" && `${view.onlineCount} online right now.`}
          </p>

          {view.kind === "active" && view.nextScheduled && (
            <div className="arrival-schedule">
              <CalendarClock size={13} aria-hidden="true" />
              <span>Next: {view.nextScheduled.title}</span>
            </div>
          )}

          {view.kind === "active" && view.spaces.length > 0 && (
            <div className="arrival-group">
              <h3 className="arrival-group-title">Active spaces</h3>
              <ul className="arrival-list">
                {view.spaces.map((space) => (
                  <li key={`${space.kind}:${space.id}`}>
                    <button className="arrival-row" onClick={() => viewSpace(space)}>
                      <MapPin size={12} aria-hidden="true" />
                      <span className="arrival-row-label">{space.label}</span>
                      <span className="arrival-row-meta">{space.kind} · {space.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.kind === "active" && view.others.length > 0 && (
            <div className="arrival-group">
              <h3 className="arrival-group-title">Students online</h3>
              <ul className="arrival-list">
                {view.others.map((person) => (
                  <li key={person.id}>
                    <button className="arrival-row" onClick={() => locatePerson(person)}>
                      <span className="arrival-dot" aria-hidden="true" />
                      <span className="arrival-row-label">{person.name}</span>
                      <span className="arrival-row-meta">{person.place ?? "campus"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
