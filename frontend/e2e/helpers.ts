/**
 * Shared E2E helpers. All game-state waits go through the window.__testHook
 * bus seam (see src/e2e/testHook.ts) or DOM conditions — never sleeps, never
 * canvas pixels.
 */
import { expect, type Page } from "@playwright/test";
import type { TestHook } from "../src/e2e/testHook";

declare global {
  interface Window {
    __testHook?: TestHook;
  }
}

export const BACKEND_URL = process.env.E2E_BACKEND_URL ?? "http://localhost:3001";

/** Room keys are the dev-default compose values (backend/.env.example). */
export const ROOM_KEYS: Record<string, string> = {
  "1": "1234",
  "2": "4321",
  "3": "3333",
  "4": "4444",
  "5": "5555",
  "6": "6666",
};

/**
 * Map geometry (16px tiles), derived from frontend/public/assets/maps/*.json.
 * The six rooms are split across two maps: `space` (default; rooms 1-3) and
 * `campus` (?map=campus; rooms 4-6). Waypoints are straight wall-free segments
 * verified against the walls layer + solid furniture of each map.
 *
 * Door targets put the player's door-sample point (x, y+8) inside the door
 * rect; seat targets put it inside the seat rect.
 */
export interface RoomRoute {
  /** Waypoints from the map spawn point to just inside the door zone. */
  doorPath: [number, number][];
  /** Waypoints from the door to seat 0 of the room. */
  seatPath: [number, number][];
  /** Waypoint that leaves the room bounds again (fires room-left). */
  exit: [number, number];
}

export const MAPS: Record<
  "space" | "campus",
  { query: string; rooms: Record<string, RoomRoute> }
> = {
  space: {
    query: "",
    rooms: {
      "1": {
        doorPath: [
          [592, 360],
          [592, 190],
        ],
        seatPath: [
          [592, 150],
          [564, 150],
          [568, 96],
        ],
        exit: [592, 260],
      },
      "2": {
        doorPath: [
          [592, 260],
          [800, 260],
          [800, 190],
        ],
        seatPath: [],
        exit: [800, 260],
      },
      "3": {
        doorPath: [
          [800, 260],
          [1008, 260],
          [1008, 190],
        ],
        seatPath: [],
        exit: [1008, 260],
      },
    },
  },
  campus: {
    query: "?map=campus",
    rooms: {
      "4": {
        doorPath: [
          [944, 600],
          [944, 360],
          [592, 360],
          [592, 174],
        ],
        seatPath: [
          [592, 150],
          [564, 150],
          [568, 96],
        ],
        exit: [592, 250],
      },
      "5": {
        doorPath: [
          [592, 250],
          [800, 250],
          [800, 174],
        ],
        seatPath: [],
        exit: [800, 250],
      },
      "6": {
        doorPath: [
          [800, 250],
          [1024, 250],
          [1024, 174],
        ],
        seatPath: [],
        exit: [1024, 250],
      },
    },
  },
};

let userCounter = 0;

/** Unique valid username: 3-32 chars of [a-z0-9_-]. */
export function uniqueUser(): { username: string; password: string } {
  userCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return {
    username: `e2e-${Date.now().toString(36)}-${rand}-${userCounter}`,
    password: "e2e-password-1",
  };
}

/**
 * Sign a fresh user up through the real Landing UI and wait until the world
 * has booted (world-info seen on the bus) and the socket is live (a positions
 * tick has arrived).
 */
export async function signUpAndJoin(
  page: Page,
  opts: { map?: "space" | "campus"; user?: { username: string; password: string } } = {},
): Promise<{ username: string; password: string }> {
  const map = opts.map ?? "space";
  const user = opts.user ?? uniqueUser();

  await page.goto(`/${MAPS[map].query}`);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByPlaceholder("callsign").fill(user.username);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator("button.console-submit").click();

  await waitForWorld(page);
  return user;
}

/**
 * Wait for the world to boot (world-info + a positions tick on the bus).
 * Fails fast with the Landing console's own error text when auth is rejected
 * (e.g. the backend's per-IP auth limiter after many local runs) instead of
 * timing out opaquely.
 */
async function waitForWorld(page: Page): Promise<void> {
  const handle = await page.waitForFunction(
    () => {
      if (
        window.__testHook?.state.last["world-info"] &&
        window.__testHook?.state.last["positions"]
      ) {
        return "ok";
      }
      const error = document.querySelector(".console-error")?.textContent;
      return error ? `auth-error: ${error}` : false;
    },
    undefined,
    { timeout: 30_000 },
  );
  const result = (await handle.jsonValue()) as string;
  if (result !== "ok") {
    throw new Error(
      `signup/signin did not reach the world — ${result} ` +
        `(hint: the backend allows 40 auth calls per 15 min per IP; ` +
        `docker compose restart backend resets it)`,
    );
  }
}

/** Sign in an existing user (Landing defaults to the Sign in tab). */
export async function signInAndJoin(
  page: Page,
  user: { username: string; password: string },
  opts: { map?: "space" | "campus" } = {},
): Promise<void> {
  const map = opts.map ?? "space";
  await page.goto(`/${MAPS[map].query}`);
  await page.getByPlaceholder("callsign").fill(user.username);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator("button.console-submit").click();
  await waitForWorld(page);
}

/** Current self position from the last positions tick. */
export async function selfPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const positions = window.__testHook!.state.last["positions"] as {
      players: { self: boolean; x: number; y: number }[];
    };
    const self = positions.players.find((p) => p.self)!;
    return { x: self.x, y: self.y };
  });
}

/** Self player id (from the positions payload). */
export async function selfId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const positions = window.__testHook!.state.last["positions"] as {
      players: { id: string; self: boolean }[];
    };
    return positions.players.find((p) => p.self)!.id;
  });
}

/**
 * Walk the avatar to (x, y) by steering `move-axis` off each `positions` bus
 * tick (~66ms). Purely event-driven: resolves inside the page when within
 * `tolerance` px, rejects on a 4s no-progress stall or overall timeout.
 * The axis is proportionally damped near the target to avoid overshoot
 * oscillation.
 */
export async function walkTo(
  page: Page,
  x: number,
  y: number,
  opts: { timeoutMs?: number; tolerance?: number; stopAtDoor?: string } = {},
): Promise<void> {
  await page.evaluate(
    ({ x, y, timeoutMs, tolerance, stopAtDoor }) =>
      new Promise<void>((resolve, reject) => {
        const hook = window.__testHook!;
        let lastPos: { x: number; y: number } | null = null;
        let stuckSince = 0;
        const finish = () => {
          clearTimeout(timer);
          off();
          hook.emit("move-axis", { x: 0, y: 0 });
        };
        const off = hook.on("positions", (payload) => {
          // Reaching the door zone opens the key modal, whose autofocused
          // input freezes movement — stop steering the moment it triggers.
          if (stopAtDoor && hook.state.nearDoor?.roomId === stopAtDoor) {
            finish();
            resolve();
            return;
          }
          const players = (payload as { players: { self: boolean; x: number; y: number }[] })
            .players;
          const self = players.find((p) => p.self);
          if (!self) return;
          const dx = x - self.x;
          const dy = y - self.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= tolerance) {
            finish();
            resolve();
            return;
          }
          const now = Date.now();
          if (lastPos && Math.hypot(self.x - lastPos.x, self.y - lastPos.y) < 1) {
            if (stuckSince === 0) stuckSince = now;
            else if (now - stuckSince > 4000) {
              finish();
              reject(
                new Error(
                  `walkTo stuck at (${Math.round(self.x)}, ${Math.round(self.y)}) ` +
                    `heading for (${x}, ${y})`,
                ),
              );
              return;
            }
          } else {
            stuckSince = 0;
          }
          lastPos = { x: self.x, y: self.y };
          // Damp the axis close to the target: at 120px/s a full-speed tick
          // moves ~8px per positions interval (more under CI CPU throttle),
          // enough to orbit a tight target without proportional braking.
          const damp = Math.min(1, dist / 48);
          hook.emit("move-axis", { x: (dx / dist) * damp, y: (dy / dist) * damp });
        });
        const timer = setTimeout(() => {
          finish();
          reject(new Error(`walkTo timed out heading for (${x}, ${y})`));
        }, timeoutMs);
      }),
    {
      x,
      y,
      timeoutMs: opts.timeoutMs ?? 30_000,
      tolerance: opts.tolerance ?? 6,
      stopAtDoor: opts.stopAtDoor ?? "",
    },
  );
}

/** Walk a list of waypoints in order. */
export async function walkPath(page: Page, path: [number, number][]): Promise<void> {
  for (const [x, y] of path) await walkTo(page, x, y);
}

/** Walk to a room's door and wait for the key modal to open. */
export async function approachDoor(
  page: Page,
  map: "space" | "campus",
  roomId: string,
): Promise<void> {
  const path = MAPS[map].rooms[roomId].doorPath;
  for (const [i, [x, y]] of path.entries()) {
    // On the final leg, stop steering as soon as the door zone triggers.
    await walkTo(page, x, y, i === path.length - 1 ? { stopAtDoor: roomId } : {});
  }
  await page.waitForFunction(
    (id) => window.__testHook?.state.nearDoor?.roomId === id,
    roomId,
  );
  await expect(page.locator(".key-modal")).toBeVisible();
}

/** Submit a key in the open door modal. */
export async function submitRoomKey(page: Page, key: string): Promise<void> {
  await page.getByPlaceholder("Room key").fill(key);
  await page.locator(".key-modal").getByRole("button", { name: "Enter" }).click();
}

/** Approach a door and enter with the correct key; waits for room-entered. */
export async function enterRoom(
  page: Page,
  map: "space" | "campus",
  roomId: string,
): Promise<void> {
  await approachDoor(page, map, roomId);
  await submitRoomKey(page, ROOM_KEYS[roomId]);
  await page.waitForFunction(
    (id) => window.__testHook?.state.currentRoomId === id,
    roomId,
  );
}

/**
 * Walk to a room's seat 0 and sit with the E key. The key is HELD across the
 * `sat` wait: Phaser's Key.onUp clears the JustDown flag, so an instantaneous
 * down+up (Playwright `press`) can land entirely between two game frames and
 * be erased — a race a human press (~100ms >> frame time) never hits, but a
 * slow CI runner hits often.
 */
export async function sitAtSeat(
  page: Page,
  map: "space" | "campus",
  roomId: string,
): Promise<void> {
  // The seat path leaves the doorway STRAIGHT UP (x stays inside the door
  // rect until well inside the room bounds): a diagonal first leg can, under
  // slow CI frames, step into the corner outside both the bounds and the
  // door rect — an instant room-left that re-locks the room and makes the
  // seat invisible to zone detection (near-seat can then never fire). The
  // final target puts the sample point at the seat rect's center; converging
  // within 4px guarantees the player RESTS inside the 16px rect (no event
  // early-stop: stopping on near-seat mid-motion can coast out the far side).
  const path = MAPS[map].rooms[roomId].seatPath;
  for (const [i, [x, y]] of path.entries()) {
    if (i < path.length - 1) {
      await walkTo(page, x, y);
      continue;
    }
    // Final leg — arrival is accepted on OBSERVED hook state, not position:
    // after walkTo resolves, the avatar can still drift up to one throttled
    // physics frame before the zero axis lands, which on a 16px seat rect is
    // enough to come to rest just past the edge. So: converge, wait until at
    // rest (two identical position ticks), and accept only when near-seat is
    // the settled state — otherwise re-approach (bounded attempts).
    const [sx, sy] = [x, y];
    let arrived = false;
    for (let attempt = 0; attempt < 4 && !arrived; attempt += 1) {
      await walkTo(page, sx, sy, { tolerance: 3 });
      arrived = await page.evaluate(
        ({ id }) =>
          new Promise<boolean>((resolve) => {
            const hook = window.__testHook!;
            let still = 0;
            let last: { x: number; y: number } | null = null;
            const off = hook.on("positions", (payload) => {
              const self = (payload as { players: { self: boolean; x: number; y: number }[] })
                .players.find((p) => p.self);
              if (!self) return;
              if (last && Math.abs(self.x - last.x) < 0.5 && Math.abs(self.y - last.y) < 0.5) {
                still += 1;
              } else {
                still = 0;
              }
              last = { x: self.x, y: self.y };
              if (still >= 2) {
                off();
                resolve(hook.state.nearSeat?.roomId === id);
              }
            });
          }),
        { id: roomId },
      );
    }
    if (!arrived) {
      throw new Error(
        `sitAtSeat: could not come to rest inside room ${roomId} seat zone ` +
          `after 4 approaches`,
      );
    }
  }
  const roomNow = await page.evaluate(() => window.__testHook!.state.currentRoomId);
  if (roomNow !== roomId) {
    throw new Error(
      `sitAtSeat: room ${roomId} membership lost during the seat approach ` +
        `(currentRoomId=${String(roomNow)}) — the walk exited the room bounds`,
    );
  }
  await page.waitForFunction(
    (id) => window.__testHook?.state.nearSeat?.roomId === id,
    roomId,
  );
  await page.keyboard.down("e");
  try {
    await page.waitForFunction(
      (id) => window.__testHook?.state.seated?.roomId === id,
      roomId,
    );
  } finally {
    await page.keyboard.up("e");
  }
}

/** Open chat with Enter, type, send (chat closes itself after submit). */
export async function sendChat(page: Page, text: string): Promise<void> {
  await page.keyboard.press("Enter");
  const input = page.locator(".mc-chat form.mc-input input");
  await expect(input).toBeVisible();
  await input.fill(text);
  await input.press("Enter");
}

/** Read the backend's advertised git SHA from /health/ready. */
export async function backendSha(page: Page): Promise<string> {
  const response = await page.request.get(`${BACKEND_URL}/health/ready`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { ok: boolean; sha: string };
  return body.sha;
}
