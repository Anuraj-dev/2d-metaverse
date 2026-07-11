import { describe, expect, it, vi } from "vitest";
import { ListenerScope } from "./listenerScope";

class Source {
  private listeners = new Set<() => void>();
  readonly unsubscribeCalls = vi.fn();

  on(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      if (this.listeners.delete(listener)) this.unsubscribeCalls();
    };
  }

  emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

function mountWorld(sources: readonly Source[], callback: () => void): ListenerScope {
  const scope = new ListenerScope();
  for (const source of sources) scope.own(source.on(callback));
  return scope;
}

describe("ListenerScope", () => {
  it("releases Net, EventBus, and scale callbacks on shutdown before a remount", () => {
    const sources = [new Source(), new Source(), new Source()];
    const firstWorld = vi.fn();
    const firstScope = mountWorld(sources, firstWorld);

    sources.forEach((source) => source.emit());
    expect(firstWorld).toHaveBeenCalledTimes(3);

    firstScope.dispose();
    sources.forEach((source) => source.emit());
    expect(firstWorld).toHaveBeenCalledTimes(3);

    const remountedWorld = vi.fn();
    const secondScope = mountWorld(sources, remountedWorld);
    sources.forEach((source) => source.emit());
    expect(firstWorld).toHaveBeenCalledTimes(3);
    expect(remountedWorld).toHaveBeenCalledTimes(3);

    secondScope.dispose();
    expect(sources.map((source) => source.unsubscribeCalls.mock.calls.length)).toEqual([2, 2, 2]);
  });

  it("disposes every owned callback exactly once", () => {
    const unsubscribe = vi.fn();
    const scope = new ListenerScope();
    scope.own(unsubscribe);

    scope.dispose();
    scope.dispose();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("immediately releases a callback accidentally registered after shutdown", () => {
    const unsubscribe = vi.fn();
    const scope = new ListenerScope();
    scope.dispose();

    scope.own(unsubscribe);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
