/** Tiny typed event bus bridging Phaser <-> React (UI overlays). */
type Listener<T> = (payload: T) => void;

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

/** Game -> UI: 'near-door'{roomId,name} | 'leave-door' | 'near-seat'{...} |
 *  'leave-seat' | 'sat'{roomId,seatId} | 'stood' | 'positions'{...} | 'room-entered'{roomId} |
 *  'room-left'{roomId} | 'world-info'{width,height,rooms,terrain}
 *  UI -> Game: 'do-sit' | 'do-stand' | 'locate'{id} | 'move-axis'{x,y} | 'do-interact'
 *  UI <-> UI: 'chat-visibility'{open} | 'focus-chat' */
export const bus = new EventBus();
