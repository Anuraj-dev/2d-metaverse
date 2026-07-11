export type Unsubscribe = () => void;

/**
 * Owns callbacks registered against process/global event sources that outlive a
 * Phaser scene. Disposal is idempotent, releases every callback even if one
 * cleanup fails, and rejects late registration by immediately releasing it.
 */
export class ListenerScope {
  private active = true;
  private readonly unsubscribers = new Set<Unsubscribe>();

  own(unsubscribe: Unsubscribe): void {
    if (!this.active) {
      unsubscribe();
      return;
    }
    this.unsubscribers.add(unsubscribe);
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    const unsubscribers = [...this.unsubscribers];
    this.unsubscribers.clear();

    let failure: unknown;
    for (const unsubscribe of unsubscribers) {
      try {
        unsubscribe();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  }
}
