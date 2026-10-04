/**
 * Serialize a derived read-model refresh per key. Changes during an in-flight
 * refresh request one follow-up, rather than one database pass per change.
 * Every completed pass is published, so steady activity cannot starve updates.
 * Entries exist only while work is pending; failures wait for a new request.
 */
export function createCoalescedRefresh<Key>(
  refresh: (key: Key) => Promise<void>,
  onError: (error: unknown, key: Key) => void,
): (key: Key) => Promise<void> {
  const pending = new Map<Key, { dirty: boolean; done: Promise<void> }>();
  return (key) => {
    const existing = pending.get(key);
    if (existing) {
      existing.dirty = true;
      return existing.done;
    }
    const work = { dirty: false, done: Promise.resolve() };
    pending.set(key, work);
    // Defer startup until done is assigned: reentrant requests share the promise.
    work.done = Promise.resolve().then(async () => {
      try {
        do {
          work.dirty = false;
          try { await refresh(key); } catch (error) { onError(error, key); }
        } while (work.dirty);
      } finally {
        pending.delete(key);
      }
    });
    return work.done;
  };
}
