import KnockStatus from "./KnockStatus";
import RoomAdminPanel from "./RoomAdminPanel";

/**
 * Bundles the room knock/admin HUD (PRD 14) into one lazy chunk so its code (and
 * the pure `roomAccess` view model) stays out of the entry bundle. Both children
 * render null until relevant, so mounting them together is free.
 */
export default function RoomAccessLayer() {
  return (
    <>
      <KnockStatus />
      <RoomAdminPanel />
    </>
  );
}
