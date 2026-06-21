/** Tiny typed event bus bridging Phaser <-> React (UI overlays). */
type Handler = (payload: any) => void;

class EventBus {
  private map = new Map<string, Set<Handler>>();
  on(event: string, cb: Handler) {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event)!.add(cb);
    return () => this.map.get(event)!.delete(cb);
  }
  emit(event: string, payload?: any) {
    this.map.get(event)?.forEach((cb) => cb(payload));
  }
}

/** Game -> UI: 'near-door'{roomId,name} | 'leave-door' | 'near-seat'{...} |
 *  'leave-seat' | 'sat'{roomId,seatId} | 'stood' | 'positions'{...} | 'room-entered'{roomId}
 *  UI -> Game: 'try-enter'{roomId,key-result} | 'do-sit' | 'do-stand' */
export const bus = new EventBus();
