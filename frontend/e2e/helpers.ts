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

/**
 * Map geometry (16px tiles), derived from frontend/public/assets/maps/campus.json.
 * Campus is the single canonical map (PRD 13), loaded as DEFAULT_MAP with NO
 * ?map query so the suite also guards the default — if it ever regresses, the
 * assertions fail instead of CI staying green (the original prod incident).
 *
 * The six rooms all live on campus: rooms 1-3 are the hostel wing (south,
 * capacities 5/8/12) and rooms 4-6 the HQ meeting rooms (north). Waypoints are
 * straight wall-free segments verified against the walls layer + solid
 * furniture (including the runtime centre tables) of the campus map.
 *
 * Door targets put the player's door-sample point (x, y+8) inside the door
 * rect; seat targets put it inside the seat rect. The hostel rooms open on
 * their NORTH wall onto a shared forecourt hub at (560,1520); their door and
 * exit paths descend the central path from the plaza and chain through that
 * hub, so any entry order stays wall-free.
 */
export interface RoomRoute {
  /** Waypoints from the map spawn point to just inside the door zone. */
  doorPath: [number, number][];
  /** Waypoints from the door to seat 0 of the room. */
  seatPath: [number, number][];
  /** Waypoints from the door to seat 1 (for two-player seat scenarios). */
  seat1Path?: [number, number][];
  /** Waypoint that leaves the room bounds again (fires room-left). */
  exit: [number, number];
}

// Descent to the hostel forecourt, shared by every hostel room path. Players
// spawn at the plaza centre (960,704) on the E-W artery; head west to the
// central path and drop straight down to the forecourt hub — every leg is a
// wall-free, solid-free straight segment.
const HOSTEL_DESCENT: [number, number][] = [
  [560, 704],
  [560, 1520],
];
const HOSTEL_HUB: [number, number] = [560, 1520];

export const MAPS: Record<
  "campus",
  { query: string; rooms: Record<string, RoomRoute> }
> = {
  campus: {
    // Bare URL on purpose: campus must load as the DEFAULT map (no override).
    query: "",
    rooms: {
      "1": {
        doorPath: [...HOSTEL_DESCENT, [736, 1520], [736, 1604]],
        // Leave the north doorway straight DOWN into the room, then across to
        // the seat. Targets the seat's top edge so the foot point (y+8) lands
        // inside the 16px seat rect (seat 0 rect top-left 704,1632).
        seatPath: [
          [736, 1632],
          [712, 1632],
        ],
        // Mirror toward the neighbouring chair (seat 1 rect top-left 736,1632).
        seat1Path: [
          [736, 1632],
          [744, 1632],
        ],
        exit: HOSTEL_HUB,
      },
      "2": {
        doorPath: [...HOSTEL_DESCENT, [528, 1520], [528, 1604]],
        seatPath: [],
        exit: HOSTEL_HUB,
      },
      "3": {
        doorPath: [...HOSTEL_DESCENT, [288, 1520], [288, 1604]],
        seatPath: [],
        exit: HOSTEL_HUB,
      },
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
        // Spawn-rooted (mirrors room 4): up the x=944 artery to the wall-free
        // y=360 forecourt corridor, across to the door column, then straight up
        // through the door gap. Independent of any prior room so a freshly
        // spawned player reaches it (room-access.spec knocks here from spawn).
        doorPath: [
          [944, 600],
          [944, 360],
          [800, 360],
          [800, 174],
        ],
        seatPath: [],
        exit: [800, 250],
      },
      "6": {
        doorPath: [
          [944, 600],
          [944, 360],
          [1024, 360],
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
  opts: { map?: "campus"; user?: { username: string; password: string } } = {},
): Promise<{ username: string; password: string }> {
  const map = opts.map ?? "campus";
  const user = opts.user ?? uniqueUser();

  await page.goto(`/${MAPS[map].query}`);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByPlaceholder("your name").fill(user.username);
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
      // world-info/positions prove the LOCAL game loop booted; the self
      // player's id only becomes truthy once the socket join/init round-trip
      // completed (net.selfId). Under CI CPU pressure the local world can
      // boot seconds before the socket init lands — reading ids before that
      // yields undefined and poisons every subsequent id-based assertion.
      const positions = window.__testHook?.state.last["positions"] as
        | { players: { self: boolean; id?: string }[] }
        | undefined;
      const self = positions?.players.find((p) => p.self);
      if (window.__testHook?.state.last["world-info"] && self?.id) {
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
  opts: { map?: "campus" } = {},
): Promise<void> {
  const map = opts.map ?? "campus";
  await page.goto(`/${MAPS[map].query}`);
  await page.getByPlaceholder("your name").fill(user.username);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator("button.console-submit").click();
  await waitForWorld(page);
}

/** Current self position from the last positions tick. */
export async function selfPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const hook = window.__testHook;
    if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
    const positions = hook.state.last["positions"] as {
      players: { self: boolean; x: number; y: number }[];
    };
    const self = positions.players.find((p) => p.self)!;
    return { x: self.x, y: self.y };
  });
}

/** Self player id (from the positions payload). */
export async function selfId(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const hook = window.__testHook;
    if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
    const positions = hook.state.last["positions"] as {
      players: { id?: string; self: boolean }[];
    };
    return positions.players.find((p) => p.self)?.id ?? null;
  });
  if (!id) {
    throw new Error(
      "selfId: socket init has not completed (self id missing from positions)",
    );
  }
  return id;
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
  opts: { timeoutMs?: number; tolerance?: number; stopWhenKnocking?: string } = {},
): Promise<void> {
  await page.evaluate(
    ({ x, y, timeoutMs, tolerance, stopWhenKnocking }) =>
      new Promise<void>((resolve, reject) => {
        const hook = window.__testHook;
        if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
        let lastPos: { x: number; y: number } | null = null;
        let stuckSince = 0;
        let lastTickAt = 0;
        const finish = () => {
          clearTimeout(timer);
          off();
          hook.emit("move-axis", { x: 0, y: 0 });
        };
        const off = hook.on("positions", (payload) => {
          // A closed door holds the player at the threshold (rollback gate); stop
          // steering the moment the knock starts, or walkTo would flag it stuck.
          if (stopWhenKnocking && hook.state.knocking?.roomId === stopWhenKnocking) {
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
          // A large gap between position ticks means the render/positions loop
          // itself froze (a CI GPU/CPU stall — "GPU stall due to ReadPixels"),
          // NOT that steering failed to make progress. The stuck-detector below
          // measures no-progress in wall-clock time, so a frozen interval would
          // otherwise be misread as a 4s+ navigation stall the instant ticks
          // resume. Treat the freeze as a discontinuity: reset the no-progress
          // clock and skip this tick's comparison so the walk isn't blamed for
          // the runner stalling. Normal ticks arrive ~66ms apart (a few hundred
          // ms under CI throttle), well under this threshold.
          if (lastTickAt !== 0 && now - lastTickAt > 800) {
            stuckSince = 0;
            lastPos = null;
          }
          lastTickAt = now;
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
      stopWhenKnocking: opts.stopWhenKnocking ?? "",
    },
  );
}

/** Walk a list of waypoints in order. */
export async function walkPath(page: Page, path: [number, number][]): Promise<void> {
  for (const [x, y] of path) await walkTo(page, x, y);
}

/** Walk a room's door path, stopping at the threshold once knocking begins. */
async function walkToDoor(page: Page, map: "campus", roomId: string): Promise<void> {
  const room = MAPS[map].rooms[roomId];
  if (!room) throw new Error(`walkToDoor: unknown room "${roomId}" in map "${map}"`);
  const path = room.doorPath;
  for (const [i, [x, y]] of path.entries()) {
    // Intermediate legs are wide-open steering corridors — they only need to be
    // reached loosely before the next leg takes over. walkTo damps its axis to a
    // near-stall inside the last ~48px of a target, so a tight (6px) tolerance on
    // an approach the player enters at full speed can park it ~6-8px out and trip
    // the no-progress stall detector (the flake seen on the shared x=944 artery
    // waypoint). A 12px tolerance is crossed from full speed before the damping
    // band bites — the same tolerance the arcade spec uses for its corridor legs.
    // The final leg keeps the precise door target (resolved early by the knock).
    await walkTo(
      page,
      x,
      y,
      i === path.length - 1 ? { stopWhenKnocking: roomId } : { tolerance: 12 },
    );
  }
}

/**
 * Enter an EMPTY room: walk to the door and knock — the first arrival is admitted
 * straight away as the room's admin (PRD 14). Waits for room-entered.
 */
export async function enterRoom(page: Page, map: "campus", roomId: string): Promise<void> {
  await walkToDoor(page, map, roomId);
  await page.waitForFunction((id) => window.__testHook?.state.currentRoomId === id, roomId);
}

/**
 * Walk to an OCCUPIED room's door and knock, then wait in the "Knocking…" state
 * (the admin must approve to let this player in). Asserts the knock card shows.
 */
export async function knockAtDoor(page: Page, map: "campus", roomId: string): Promise<void> {
  await walkToDoor(page, map, roomId);
  await page.waitForFunction((id) => window.__testHook?.state.knocking?.roomId === id, roomId);
  await expect(page.locator(".knock-status")).toBeVisible();
}

/** On the admin's page, approve (or deny) the first pending knock request. */
export async function respondToKnock(adminPage: Page, action: "Approve" | "Deny"): Promise<void> {
  const request = adminPage.locator(".knock-request").first();
  await expect(request).toBeVisible();
  await request.getByRole("button", { name: action }).click();
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
  map: "campus",
  roomId: string,
  opts: { seat?: 0 | 1 } = {},
): Promise<void> {
  // The seat path leaves the doorway STRAIGHT UP (x stays inside the door
  // rect until well inside the room bounds): a diagonal first leg can, under
  // slow CI frames, step into the corner outside both the bounds and the
  // door rect — an instant room-left that re-locks the room and makes the
  // seat invisible to zone detection (near-seat can then never fire). The
  // final target puts the sample point at the seat rect's center; converging
  // within 4px guarantees the player RESTS inside the 16px rect (no event
  // early-stop: stopping on near-seat mid-motion can coast out the far side).
  const room = MAPS[map].rooms[roomId];
  if (!room) throw new Error(`sitAtSeat: unknown room "${roomId}" in map "${map}"`);
  const path = opts.seat === 1 ? room.seat1Path : room.seatPath;
  if (!path) {
    throw new Error(`sitAtSeat: no seat-${opts.seat ?? 0} path for room "${roomId}" in map "${map}"`);
  }
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
            const hook = window.__testHook;
            if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
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
  const roomNow = await page.evaluate(() => {
    const hook = window.__testHook;
    if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
    return hook.state.currentRoomId;
  });
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

/** Focus the persistent chat input (Enter), type, send. The panel stays open. */
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
