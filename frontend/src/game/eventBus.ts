/** Tiny typed event bus bridging Phaser <-> React (UI overlays). */
type Listener<T> = (payload: T) => void;

/**
 * Known domain event names used by the sound mixer / arcade (and documented
 * elsewhere on this bus). The bus remains stringly-typed at the on/emit
 * surface so existing callers compile; this union is the checklist for new
 * arcade events so typos have a single place to land.
 */
export type ArcadeBusEvent =
  | "open-arcade"
  | "close-arcade"
  | "arcade-point"
  | "arcade-over"
  | "arcade-flap"
  | "arcade-hit"
  | "arcade-eat"
  | "arcade-near"
  | "arcade-best"
  | "arcade-bonus"
  | "arcade-milestone"
  | "arcade-highscore"
  | "arcade-snake-over"
  | "arcade-drop"
  | "arcade-merge"
  | "arcade-nova";

class EventBus {
  // Stored loosely (handlers carry their own payload type); on()/emit() are the typed surface.
  private map = new Map<string, Set<Listener<never>>>();

  on<T = unknown>(event: string, cb: Listener<T>): () => void {
    const set = this.map.get(event) ?? new Set<Listener<never>>();
    this.map.set(event, set);
    set.add(cb as Listener<never>);
    return () => {
      set.delete(cb as Listener<never>);
    };
  }

  emit<T = unknown>(event: string, payload?: T): void {
    this.map.get(event)?.forEach((cb) => (cb as Listener<T>)(payload as T));
  }
}

/** Game -> UI: 'knocking'{roomId,name} | 'stop-knocking' | 'near-seat'{...} |
 *  'leave-seat' | 'sat'{roomId,seatId} | 'stood' | 'positions'{...} | 'room-entered'{roomId} |
 *  'room-left'{roomId} | 'knock-approved' | 'knock-denied' | 'admin-promoted' |
 *  'world-info'{width,height,rooms,areas,terrain} |
 *  Board tables (PRD 11 p2): 'near-board-seat'{tableId,seat,game,label,occupied} | 'leave-board-seat' |
 *  'board-sat'{tableId,seat,game,label} | 'board-stood' | 'board-move' | 'board-win'
 *  Arcade (see ArcadeBusEvent): 'open-arcade' | 'close-arcade' | 'arcade-point' | 'arcade-over' |
 *  'arcade-flap' | 'arcade-hit' | 'arcade-eat' | 'arcade-bonus' | 'arcade-milestone' |
 *  'arcade-highscore' | 'arcade-snake-over' | 'arcade-drop' | 'arcade-merge' | 'arcade-nova' (sound mixer maps these; games stay audio-agnostic)
 *  Meeting (PRD 10): the server meeting-lifecycle events are mirrored here by the
 *  app shell, incl. 'meeting-chat'{roomId,id,name,text} (participant-scoped chat).
 *  UI -> Game: 'do-sit' | 'do-stand' | 'locate'{id} | 'move-axis'{x,y} | 'do-interact'
 *  Arcade (PRD 11 / issue #163): 'open-arcade'{game,label} | 'arcade-eat' | 'arcade-point' |
 *  'arcade-near' | 'arcade-flap' | 'arcade-over' | 'arcade-best' | 'arcade-drop' | 'arcade-merge' | 'arcade-nova' — domain events only; the
 *  sound mixer's event->clip table decides what (if anything) they sound like.
 *  UI <-> UI: 'chat-visibility'{open} | 'focus-chat' |
 *  Global control bar (PRD 20): 'mic-toggle'{on} | 'cam-toggle'{on} (sound mixer blip)
 *  Screen share (PRD 23): 'screen-share-on' | 'screen-share-off' (control bar intent; sound blip + e2e hook)
 *  HUD (PRD 20): 'speaking'{ids} (active-speaker rings) | 'map-open' | 'map-close' (fullscreen map) |
 *  'settings-open' (Settings panel opened — mutually exclusive with the map, issue #79) */
export const bus = new EventBus();
