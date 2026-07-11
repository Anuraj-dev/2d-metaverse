import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Net } from "../../net/net";
import { bus } from "../eventBus";

type Handler = (payload?: unknown) => void;

class FakeEmitter {
  private readonly listeners = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): this {
    const handlers = this.listeners.get(event) ?? new Set<Handler>();
    handlers.add(handler);
    this.listeners.set(event, handlers);
    return this;
  }

  once(event: string, handler: Handler): this {
    const onceHandler: Handler = (payload) => {
      this.off(event, onceHandler);
      handler(payload);
    };
    return this.on(event, onceHandler);
  }

  off(event: string, handler: Handler): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  emit(event: string, payload?: unknown): void {
    [...(this.listeners.get(event) ?? [])].forEach((handler) => handler(payload));
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

class FakeNet implements Net {
  private readonly events = new FakeEmitter();
  selfId = "self";
  readonly connect = vi.fn();

  on<T = unknown>(event: string, callback: (payload: T) => void): () => void {
    const handler: Handler = (payload) => callback(payload as T);
    this.events.on(event, handler);
    return () => this.events.off(event, handler);
  }

  listenerCount(event: string): number {
    return this.events.listenerCount(event);
  }

  emit(event: string, payload?: unknown): void {
    this.events.emit(event, payload);
  }

  move(): void {}
  chat(): void {}
  whisper(): void {}
  knock(): void {}
  cancelKnock(): void {}
  approveKnock(): void {}
  denyKnock(): void {}
  toggleAllowAll(): void {}
  leaveRoom(): void {}
  sit(): void {}
  stand(): void {}
  meetingChat(): void {}
  boardSit(): void {}
  boardStand(): void {}
  boardAccept(): void {}
  boardMove(): void {}
  disconnect(): void {}
}

vi.mock("phaser", () => {
  class Chain {
    x = 0;
    y = 0;
    width = 16;
    height = 16;
    alpha = 1;
    active = true;
    body: null = null;
    anims = { stop: () => undefined, play: () => undefined };

    setPosition(x: number, y: number): this {
      this.x = x;
      this.y = y;
      return this;
    }

    setText(): this { return this; }
    setSize(): this { return this; }
    setOffset(): this { return this; }
    setDepth(): this { return this; }
    setOrigin(): this { return this; }
    setScrollFactor(): this { return this; }
    setBlendMode(): this { return this; }
    setFillStyle(): this { return this; }
    setAlpha(alpha: number): this { this.alpha = alpha; return this; }
    setScale(): this { return this; }
    setFlipX(): this { return this; }
    setAngle(): this { return this; }
    setStroke(): this { return this; }
    setFrame(): this { return this; }
    setVelocity(): this { return this; }
    setVisible(): this { return this; }
    setInteractive(): this { return this; }
    play(): this { return this; }
    once(): this { return this; }
    clear(): this { return this; }
    fillStyle(): this { return this; }
    lineStyle(): this { return this; }
    fillRect(): this { return this; }
    fillRoundedRect(): this { return this; }
    strokeRoundedRect(): this { return this; }
    fillTriangle(): this { return this; }
    setBounds(): this { return this; }
    setZoom(): this { return this; }
    setCollisionByExclusion(): this { return this; }
    refreshBody(): this { return this; }
    destroy(): void {}
  }

  class Vector2 {
    x: number;
    y: number;
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x: number, y: number): this { this.x = x; this.y = y; return this; }
  }

  class Registry {
    private readonly values = new Map<string, unknown>();
    get(key: string): unknown { return this.values.get(key); }
    set(key: string, value: unknown): void { this.values.set(key, value); }
  }

  class Scene {
    readonly events = new FakeEmitter();
    readonly scale = Object.assign(new FakeEmitter(), { width: 1280, height: 720 });
    readonly registry = new Registry();
    readonly anims = {
      exists: () => false,
      create: () => undefined,
      generateFrameNumbers: () => [],
    };
    readonly make = {
      tilemap: () => ({
        tilesets: [],
        widthInPixels: 100,
        heightInPixels: 100,
        createLayer: () => new Chain(),
        getLayer: () => null,
        getObjectLayer: () => undefined,
        findObject: () => ({ x: 10, y: 20 }),
      }),
    };
    readonly physics = {
      world: new Chain(),
      add: {
        sprite: () => new Chain(),
        collider: () => undefined,
        staticGroup: () => ({ create: () => new Chain() }),
      },
    };
    readonly cameras = {
      main: Object.assign(new Chain(), {
        roundPixels: false,
        startFollow: () => undefined,
      }),
    };
    readonly add = {
      text: () => new Chain(),
      graphics: () => new Chain(),
      rectangle: () => new Chain(),
      particles: () => new Chain(),
      image: () => new Chain(),
      sprite: () => new Chain(),
      container: () => new Chain(),
    };
    readonly input = { keyboard: null };
    readonly time = { addEvent: () => undefined, delayedCall: () => undefined, now: 0 };
    readonly textures = { exists: () => true };
    readonly cache = { tilemap: { get: () => undefined } };
    readonly tweens = { add: () => new Chain() };
    readonly scene = { isSleeping: () => false, wake: () => undefined, sleep: () => undefined };
  }

  return {
    default: {
      Scene,
      Scenes: { Events: { SHUTDOWN: "shutdown", DESTROY: "destroy" } },
      Math: { Vector2, Distance: { Between: () => 0 } },
      BlendModes: { MULTIPLY: 1, ADD: 2 },
      Input: { Keyboard: { JustDown: () => false } },
      Display: { Color: { GetColor: () => 0 } },
      Geom: { Rectangle: class {} },
    },
  };
});

import WorldScene from "./WorldScene";

interface SceneProbe {
  registry: { set(key: string, value: unknown): void };
  events: FakeEmitter;
  scale: FakeEmitter;
  touchAxis: { x: number; y: number };
  listeners: { own(unsubscribe: () => void): void };
  create(): void;
}

describe("WorldScene lifecycle boundary", () => {
  beforeEach(() => localStorage.clear());

  it("unsubscribes the real scene wiring on shutdown and binds one fresh set on remount", () => {
    const net = new FakeNet();
    const scene = new WorldScene() as unknown as SceneProbe;
    scene.registry.set("net", net);

    scene.create();
    expect(net.listenerCount("player-left")).toBe(1);
    expect(scene.scale.listenerCount("resize")).toBe(1);

    bus.emit("move-axis", { x: 0.75, y: -0.25 });
    expect(scene.touchAxis).toEqual({ x: 0.75, y: -0.25 });

    scene.events.emit("shutdown");
    expect(net.listenerCount("player-left")).toBe(0);
    expect(scene.scale.listenerCount("resize")).toBe(0);
    bus.emit("move-axis", { x: -1, y: 1 });
    expect(scene.touchAxis).toEqual({ x: 0.75, y: -0.25 });

    scene.create();
    expect(net.listenerCount("player-left")).toBe(1);
    expect(scene.scale.listenerCount("resize")).toBe(1);
    bus.emit("move-axis", { x: 0.25, y: 0.5 });
    expect(scene.touchAxis).toEqual({ x: 0.25, y: 0.5 });

    scene.events.emit("destroy");
    expect(net.listenerCount("player-left")).toBe(0);
    expect(scene.scale.listenerCount("resize")).toBe(0);
  });

  it("clears the development hook even when an owned cleanup fails", () => {
    const scene = new WorldScene() as unknown as SceneProbe;
    scene.registry.set("net", new FakeNet());
    scene.create();
    expect((window as unknown as { __mv?: unknown }).__mv).toBeDefined();
    scene.listeners.own(() => {
      throw new Error("cleanup failed");
    });

    expect(() => scene.events.emit("shutdown")).toThrow("cleanup failed");
    expect((window as unknown as { __mv?: unknown }).__mv).toBeUndefined();
  });
});
