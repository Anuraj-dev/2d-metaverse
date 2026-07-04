import Phaser from "phaser";
import type { BoardUpdatePayload, BoardErrorPayload, Dir, PlayerState } from "@metaverse/shared";
import { SERVER_EVENTS } from "@metaverse/shared";
import {
  boardSeatOccupants,
  canTakeBoardSeat,
  type BoardSeatOccupants,
} from "../boardTable";
import type { Net } from "../../net/net";
import { authToken } from "../../net/auth";
import { bus } from "../eventBus";
import { createCharAnims, idleFrame, walkAnim } from "../avatar";
import { CHARS, charForPlayer, isCharKey } from "../chars";
import { activeMap } from "../maps";
import { parseInteractables, findNear, arcadeOpenPayload, type InteractableDef } from "../interactables";
import { movementIntent, BASE_SPEED } from "../movement";
import { findDoor, findSeat, findRoomArea, hasExitedRoom, inZone, rectContains, type RoomArea } from "../zones";
import { zoneAt, roomAreasFromObjects } from "../audioZones";
import { seatTransition } from "../seatDoor";
import { doorPassable, shouldAnnounceKnock, type RoomOpenState } from "../roomAccess";
import { CINEMATIC_IDLE, cancelPortal, runPortalCinematic } from "../portalCinematic";
import { interpolateStep } from "../interpolation";
import { interactAction } from "../interaction";
import { initOnAir, stepOnAir, type OnAirEffect, type OnAirInput, type OnAirState } from "../onAir";
import { positionsEmitDue, moveSendDue } from "../throttle";
import { tintForHour } from "../dayNight";
import { terrainFromTiledMap, type TiledMapLike } from "../../ui/minimapTerrain";

const ZOOM = 2.2;
// Portal Phase A (PRD 10): camera punch-in toward the table over ~350ms. The
// factor multiplies the base zoom (the spec's "zoomTo ~2.4" would be a barely
// visible 9% step from the base 2.2 as an absolute value).
const PORTAL_ZOOM_FACTOR = 2.4;
const PORTAL_MS = 350;
// Fade runs slower than the zoom so the captured frame is dimmed, not black:
// at the 350ms capture point a (PORTAL_MS * 3)-long fade sits at ~33%.
const PORTAL_FADE_MS = PORTAL_MS * 3;
// A renderer snapshot is asynchronous; if a driver quirk stalls it, the portal
// must still hand off (with no backdrop image) rather than hang the sequencer.
const SNAPSHOT_TIMEOUT_MS = 400;

interface Remote {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  tx: number;
  ty: number;
  dir: Dir;
  name: string;
  /** Avatar spritesheet key, resolved once at join (was an O(n) per-frame lookup). */
  char: string;
}

interface DoorZone {
  roomId: string;
  name: string;
  rect: Phaser.Geom.Rectangle;
}
interface Seat {
  roomId: string;
  seatId: number;
  facing: Dir;
  rect: Phaser.Geom.Rectangle;
  cx: number;
  cy: number;
}

/** A board-table seat: a public plaza seat that opens a two-player board match.
 * Independent of private-room seats (no room entry / meeting trigger). */
interface BoardSeat {
  tableId: string;
  seat: number;
  game: string;
  label: string;
  facing: Dir;
  rect: Phaser.Geom.Rectangle;
  cx: number;
  cy: number;
}

export default class WorldScene extends Phaser.Scene {
  private net!: Net;
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerLabel!: Phaser.GameObjects.Text;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private keyE!: Phaser.Input.Keyboard.Key;
  private keyShift!: Phaser.Input.Keyboard.Key;
  private touchAxis = { x: 0, y: 0 };
  private interactQueued = false;
  private remotes = new Map<string, Remote>();
  private chatBubbles = new Map<
    string,
    {
      container: Phaser.GameObjects.Container;
      sprite: Phaser.GameObjects.Sprite;
      offsetY: number;
      expires: number;
    }
  >();

  private doors: DoorZone[] = [];
  private doorSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private openDoors = new Set<string>();
  /** Latest broadcast allow-all/capacity per room (PRD 14 door visibility). */
  private roomOpenState = new Map<string, RoomOpenState>();
  private seats: Seat[] = [];
  private interactables: InteractableDef[] = [];
  private currentInteractable: InteractableDef | null = null;
  private stageZone: Phaser.Geom.Rectangle | null = null;
  private presenterZone: Phaser.Geom.Rectangle | null = null;
  private inStage = false;
  private inPresenterSlot = false;
  // Stage broadcast on-air machine (PRD 17): pure rules in game/onAir.ts.
  private onAir: OnAirState = initOnAir();
  private furniture: { key: string; x: number; y: number; solid: boolean }[] = [];
  private roomAreas: RoomArea[] = [];
  private enteredRooms = new Set<string>();
  private currentDoor: string | null = null;
  private currentSeat: Seat | null = null;
  private seated = false;
  private boardSeats: BoardSeat[] = [];
  private currentBoardSeat: BoardSeat | null = null;
  private boardSeated = false;
  /** Authoritative seat occupancy per board table, mirrored from `board-update`.
   *  Drives client-side seat-taken prevention + optimistic-sit reconciliation. */
  private boardOccupants = new Map<string, BoardSeatOccupants>();
  private currentRoom: string | null = null;
  private lastPublicPosition = new Phaser.Math.Vector2();
  private avatar = "char1";

  private dir: Dir = "down";
  private lastSent = 0;
  private lastTick = 0;
  /**
   * Generation guard for the portal cinematic's async callbacks. All the
   * DECISIONS live in the pure module game/portalCinematic.ts (unit-tested,
   * incl. the exit-mid-cinematic interleavings); this field is just the
   * scene's copy of its state.
   */
  private cinematic = CINEMATIC_IDLE;

  constructor() {
    super("world");
  }

  create() {
    this.net = this.registry.get("net") as Net;
    CHARS.forEach((c) => createCharAnims(this, c));

    // Door open/close: closed(0) → ajar(1) → open door frame(2). The frame
    // stays visible when open — it dresses the doorway (see gen_door.py).
    this.anims.create({
      key: "door-open",
      frames: this.anims.generateFrameNumbers("door", { start: 0, end: 2 }),
      frameRate: 8,
      repeat: 0,
    });
    this.anims.create({
      key: "door-close",
      frames: [
        { key: "door", frame: 2 },
        { key: "door", frame: 1 },
        { key: "door", frame: 0 },
      ],
      frameRate: 8,
      repeat: 0,
    });

    const saved = localStorage.getItem("avatar");
    this.avatar = saved && isCharKey(saved) ? saved : "char1";

    const mapKey = activeMap().key;
    const map = this.make.tilemap({ key: mapKey });
    // A map may reference multiple tilesets; add each by its Tiled name (which
    // equals the loaded image key per the maps registry convention). Every
    // declared tileset is REQUIRED: dropping one would silently render broken
    // tiles, so a missing texture is map corruption — refuse to build the world.
    const tiles = map.tilesets.map((ts) => {
      const tileset = map.addTilesetImage(ts.name, ts.name);
      if (!tileset) {
        throw new Error(
          `Map "${mapKey}": tileset "${ts.name}" has no loaded texture — check the maps registry and /assets/tilesets/`
        );
      }
      return tileset;
    });
    // ground and walls are REQUIRED layers — a world without them is invalid
    // (no floor to stand on / no collision), so fail loudly instead of limping.
    const ground = map.createLayer("ground", tiles, 0, 0);
    if (!ground) {
      throw new Error(`Map "${mapKey}": required tile layer "ground" is missing`);
    }
    // Optional decorative layers below the player (no collision) — soft guards.
    if (map.getLayer("ground_decor")) map.createLayer("ground_decor", tiles, 0, 0);
    if (map.getLayer("decor_below"))  map.createLayer("decor_below",  tiles, 0, 0);
    const walls = map.createLayer("walls", tiles, 0, 0);
    if (!walls) {
      throw new Error(`Map "${mapKey}": required tile layer "walls" is missing`);
    }
    walls.setCollisionByExclusion([-1]);
    // decor_above renders over the player so tree canopies/awnings overlap
    // correctly — optional, soft guard.
    if (map.getLayer("decor_above")) {
      map.createLayer("decor_above", tiles, 0, 0)?.setDepth(3000);
    }

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setZoom(ZOOM);
    this.cameras.main.roundPixels = true;

    // object layers -> doors + seats
    this.parseObjects(map);

    // spawn point
    const spawn = map.findObject("spawn", (o) => o.name === "spawn");
    const sx = (spawn?.x as number) ?? 960;
    const sy = (spawn?.y as number) ?? 704;

    this.player = this.physics.add.sprite(sx, sy, this.avatar, idleFrame("down"));
    this.player.setSize(18, 14).setOffset(7, 16);
    this.lastPublicPosition.set(sx, sy);
    this.physics.add.collider(this.player, walls);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.buildFurniture();
    this.setupAmbience(map);
    this.emitWorldInfo(map);

    this.playerLabel = this.makeLabel("You");

    // Phaser enables the keyboard plugin by default (game config `input.keyboard`),
    // so it is present once the scene boots in a browser; guard rather than assert
    // so a headless/keyboard-disabled config degrades instead of throwing.
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.cursors = keyboard.createCursorKeys();
      this.wasd = keyboard.addKeys("W,A,S,D") as Record<
        "W" | "A" | "S" | "D",
        Phaser.Input.Keyboard.Key
      >;
      this.keyE = keyboard.addKey("E");
      this.keyShift = keyboard.addKey("SHIFT");
      // Phaser captures WASD/E/arrows on window and preventDefaults them, which
      // stops those characters reaching DOM inputs (chat). Drop the capture so
      // typing works; movement still reads key state. isTyping() gates the game.
      keyboard.clearCaptures();
    }

    this.wireNet();
    this.wireUi();
    this.wireChat();
    this.net.connect(authToken(), "1");

    if (import.meta.env.DEV) {
      (window as unknown as { __mv: unknown }).__mv = {
        sitAt: (roomId: string, seatId: number) => {
          const seat = this.seats.find(
            (s) => s.roomId === roomId && s.seatId === seatId
          );
          if (!seat) return false;
          this.enteredRooms.add(roomId);
          this.player.setPosition(seat.cx, seat.cy);
          this.currentSeat = seat;
          this.trySit();
          return true;
        },
      };
    }
  }

  private parseObjects(map: Phaser.Tilemaps.Tilemap) {
    const doorObjs = map.getObjectLayer("doorZones")?.objects ?? [];
    for (const o of doorObjs) {
      const roomId = prop(o, "roomId") ?? "";
      const rect = rectOf(o);
      this.doors.push({ roomId, name: o.name || `Room ${roomId}`, rect });

      // Animated door sprite, bottom-anchored IN the doorway gap so the leaf
      // fills the opening and the lintel rises above the wall row (PRD 12
      // bug: the old 48×96 cell centered on the gap floated beside it).
      // Depth = the doorway's bottom edge: the player y-sorts against it and
      // walks visually *through* the open frame.
      const sprite = this.add
        .sprite(rect.centerX, rect.bottom, "door", 0)
        .setOrigin(0.5, 1)
        .setScale(rect.width / 32)
        .setDepth(rect.bottom);
      this.doorSprites.set(roomId, sprite);
    }
    const seatObjs = map.getObjectLayer("seats")?.objects ?? [];
    for (const o of seatObjs) {
      const cx = (o.x ?? 0) + (o.width || 16) / 2;
      const cy = (o.y ?? 0) + (o.height || 16) / 2;
      this.seats.push({
        roomId: prop(o, "roomId") ?? "",
        seatId: Number(prop(o, "seatId") ?? 0),
        facing: (prop(o, "facing") as Dir) ?? "down",
        rect: rectOf(o, 16, 16),
        cx,
        cy,
      });
    }
    // Board tables (PRD 11 phase 2): plaza seats keyed by tableId, NOT room
    // seats — their own array so they skip the room/meeting/minimap machinery.
    const boardSeatObjs = map.getObjectLayer("board_seats")?.objects ?? [];
    for (const o of boardSeatObjs) {
      const cx = (o.x ?? 0) + (o.width || 16) / 2;
      const cy = (o.y ?? 0) + (o.height || 16) / 2;
      this.boardSeats.push({
        tableId: prop(o, "tableId") ?? "",
        seat: Number(prop(o, "seat") ?? 0),
        game: prop(o, "game") ?? "",
        label: prop(o, "label") ?? "",
        facing: (prop(o, "facing") as Dir) ?? "down",
        rect: rectOf(o, 16, 16),
        cx,
        cy,
      });
    }

    const furnObjs = map.getObjectLayer("furniture")?.objects ?? [];
    for (const o of furnObjs) {
      const key = prop(o, "key");
      if (!key) continue;
      this.furniture.push({
        key,
        x: o.x ?? 0,
        y: o.y ?? 0,
        solid: prop(o, "solid") === "true",
      });
    }
    // Audio zones derive from the same `roomBounds` objects via the shared pure
    // derivation, so the runtime zones can't drift from the on-disk map data.
    const roomObjs = map.getObjectLayer("roomBounds")?.objects ?? [];
    this.roomAreas = roomAreasFromObjects(roomObjs);

    const iaObjs = map.getObjectLayer("interactables")?.objects ?? [];
    this.interactables = parseInteractables(
      iaObjs as Parameters<typeof parseInteractables>[0]
    );

    const stageObjs = map.getObjectLayer("stage")?.objects ?? [];
    for (const o of stageObjs) {
      const zoneType = prop(o, "zoneType");
      if (zoneType === "stage") this.stageZone = rectOf(o);
      else if (zoneType === "presenter") this.presenterZone = rectOf(o);
    }
  }

  /** Tables (room centres), chairs (every seat, facing the table), and decor. */
  private buildFurniture() {
    const solids = this.physics.add.staticGroup();

    // group seats by room → table at the centroid, a chair on each seat
    const byRoom = new Map<string, Seat[]>();
    for (const s of this.seats) {
      const group = byRoom.get(s.roomId) ?? [];
      if (group.length === 0) byRoom.set(s.roomId, group);
      group.push(s);
    }
    for (const seats of byRoom.values()) {
      const cx = seats.reduce((a, s) => a + s.cx, 0) / seats.length;
      const cy = seats.reduce((a, s) => a + s.cy, 0) / seats.length;
      this.addSolid(solids, "f_table_round", cx, cy - 4);
      for (const s of seats) this.addChair(s);
    }

    // Board-table chairs (the solid table itself is authored in the map's
    // furniture layer). Same chair sprites/orientation as room seats.
    for (const s of this.boardSeats) this.addChair(s);

    // zone decor authored in the map's `furniture` object layer (data-driven)
    for (const f of this.furniture) {
      if (f.solid) {
        this.addSolid(solids, f.key, f.x, f.y);
      } else {
        const img = this.add.image(f.x, f.y, f.key).setDepth(f.y);
        // Foliage sways gently so the world feels alive even when empty.
        if (f.key.includes("plant") || f.key.includes("tree")) this.addSway(img);
      }
    }

    this.physics.add.collider(this.player, solids);
  }

  /** A slow, subtle pivot from the base so plants/trees sway in a breeze. */
  private addSway(img: Phaser.GameObjects.Image) {
    img.setOrigin(0.5, 1);
    img.y += img.height / 2; // keep the base anchored where it was drawn
    this.tweens.add({
      targets: img,
      angle: { from: -2.2, to: 2.2 },
      duration: 2600 + Math.random() * 1200,
      delay: Math.random() * 1500,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  /**
   * Engine-side atmosphere (no assets): a camera-locked day/night tint driven by
   * the local clock, plus a slow drift of ambient motes over the world. Cheap
   * wins layered on the tiles. Pure tint math lives in dayNight.ts.
   */
  private setupAmbience(map: Phaser.Tilemaps.Tilemap) {
    // Day/night overlay: fixed to the camera, multiply blend so it darkens.
    const tintRect = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0xffffff, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(6000)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    const applyTint = () => {
      const hour = new Date().getHours() + new Date().getMinutes() / 60;
      const { color, alpha } = tintForHour(hour);
      tintRect.setFillStyle(color, alpha);
      tintRect.setSize(this.scale.width, this.scale.height);
    };
    applyTint();
    this.time.addEvent({ delay: 30_000, loop: true, callback: applyTint });
    this.scale.on("resize", applyTint);

    // Ambient motes: a soft 3px dot texture drifting slowly across the world.
    const dotKey = "ambient-mote";
    if (!this.textures.exists(dotKey)) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1).fillCircle(3, 3, 3);
      g.generateTexture(dotKey, 6, 6);
      g.destroy();
    }
    this.add
      .particles(0, 0, dotKey, {
        x: { min: 0, max: map.widthInPixels },
        y: { min: 0, max: map.heightInPixels },
        lifespan: 9000,
        speedX: { min: -6, max: 10 },
        speedY: { min: -4, max: 6 },
        scale: { min: 0.15, max: 0.5 },
        alpha: { start: 0.35, end: 0 },
        frequency: 900,
        quantity: 1,
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(2500);
  }

  private addSolid(
    group: Phaser.Physics.Arcade.StaticGroup,
    key: string,
    x: number,
    y: number
  ) {
    const img = group.create(x, y, key) as Phaser.Physics.Arcade.Sprite;
    img.setDepth(y);
    // tighten body to the sprite footprint so movement feels fair
    const bw = img.width * 0.8;
    const bh = img.height * 0.55;
    if (img.body) {
      img.body.setSize(bw, bh);
      img.body.setOffset((img.width - bw) / 2, img.height - bh);
    }
    img.refreshBody();
  }

  private addChair(seat: { facing: Dir; cx: number; cy: number }) {
    // Use the front-view chair for up/down seats and the side-view chair for
    // left/right, each oriented so the seat opens toward the table.
    const depth = seat.cy - 2;
    let chair: Phaser.GameObjects.Image;
    if (seat.facing === "left") {
      chair = this.add.image(seat.cx, seat.cy, "f_chair_side"); // faces left
    } else if (seat.facing === "right") {
      chair = this.add.image(seat.cx, seat.cy, "f_chair_side").setFlipX(true);
    } else if (seat.facing === "up") {
      chair = this.add.image(seat.cx, seat.cy, "f_chair").setAngle(180);
    } else {
      chair = this.add.image(seat.cx, seat.cy, "f_chair"); // down
    }
    chair.setDepth(depth);
  }

  private wireNet() {
    this.net.on("init", (p: { selfId: string; players: PlayerState[] }) => {
      for (const pl of p.players) {
        if (pl.id === this.net.selfId) {
          this.player.setPosition(pl.x, pl.y);
          this.playerLabel.setText(pl.name);
        } else this.addRemote(pl);
      }
    });
    this.net.on("player-joined", (p: PlayerState) => this.addRemote(p));
    this.net.on(
      "player-moved",
      (p: { id: string; x: number; y: number; dir: Dir }) => {
        const r = this.remotes.get(p.id);
        if (!r) return;
        r.tx = p.x;
        r.ty = p.y;
        r.dir = p.dir;
      }
    );
    this.net.on("player-left", (p: { id: string }) => this.removeRemote(p.id));
  }

  private wireUi() {
    bus.on("room-entered", (p: { roomId: string }) => {
      this.enteredRooms.add(p.roomId);
      this.currentRoom = p.roomId;
      bus.emit("stop-knocking");
      this.refreshDoor(p.roomId);
    });
    // Server admitted this client (knock approved / walked into an open door):
    // unlock the room. A denial/timeout just clears the knocking UI.
    this.net.on("knock-result", (p: { roomId: string; result: "approved" | "denied" | "timeout" }) => {
      if (p.result === "approved") bus.emit("room-entered", { roomId: p.roomId });
      else bus.emit("stop-knocking");
    });
    // Door visibility follows the room's open state for everyone near it.
    this.net.on("room-open-state", (p: { roomId: string; allowAll: boolean; atCapacity: boolean }) => {
      this.roomOpenState.set(p.roomId, { allowAll: p.allowAll, atCapacity: p.atCapacity });
      this.refreshDoor(p.roomId);
    });
    // Authoritative board-seat occupancy: mirror every snapshot so we can refuse a
    // sit onto a taken seat and reconcile an optimistic sit the server rejected.
    this.net.on<BoardUpdatePayload>(SERVER_EVENTS.boardUpdate, (snap) => this.onBoardUpdate(snap));
    // A rejected sit (seat lost to a simultaneous sitter, or already seated
    // elsewhere) rolls back our optimistic local seat — the server picks the winner.
    this.net.on<BoardErrorPayload>(SERVER_EVENTS.boardError, (err) => {
      if (err.reason === "seat-taken") this.releaseBoardSeat();
    });
    bus.on("do-sit", () => {
      if (!this.seated && this.currentBoardSeat) this.tryBoardSit();
      else this.trySit();
    });
    bus.on("do-stand", () => {
      if (this.boardSeated) this.boardStand();
      else this.stand();
    });
    bus.on("portal-enter", () => this.portalIn());
    bus.on("portal-exit", () => this.portalOut());
    bus.on("locate", (p: { id: string }) => this.locate(p.id));
    bus.on("move-axis", (p: { x: number; y: number }) => (this.touchAxis = p));
    bus.on("do-interact", () => (this.interactQueued = true));
    // Stage on-air confirm prompt (PRD 17): the HUD returns the player's choice.
    bus.on("stage-confirm", () => this.applyOnAir({ type: "confirm" }));
    bus.on("stage-decline", () => this.applyOnAir({ type: "decline" }));
    // Arcade overlay closed → wake the world scene it slept under.
    bus.on("close-arcade", () => {
      if (this.scene.isSleeping()) this.scene.wake();
    });
  }

  /** Advance the pure on-air machine and surface its effect on the bus. */
  private applyOnAir(input: OnAirInput) {
    const { state, effect } = stepOnAir(this.onAir, input);
    this.onAir = state;
    const emit: Record<Exclude<OnAirEffect, "none">, string> = {
      "show-prompt": "stage-prompt-show",
      "hide-prompt": "stage-prompt-hide",
      "go-on-air": "stage-on-air",
      "go-off-air": "stage-off-air",
    };
    if (effect !== "none") bus.emit(emit[effect]);
  }

  /** One-time snapshot of map size, terrain + room footprints for the minimap.
   *  Terrain rasterizes the raw Tiled JSON (tilemap cache) through the pure
   *  ui/minimapTerrain module, so the overview shows the actual authored
   *  world — ground, paths, buildings — not an empty box (PRD 12 bug #3). */
  private emitWorldInfo(map: Phaser.Tilemaps.Tilemap) {
    const raw = (
      this.cache.tilemap.get(activeMap().key) as { data?: TiledMapLike } | undefined
    )?.data;
    const terrain = raw ? terrainFromTiledMap(raw) : null;
    const byRoom = new Map<string, Seat[]>();
    for (const s of this.seats) {
      const group = byRoom.get(s.roomId) ?? [];
      if (group.length === 0) byRoom.set(s.roomId, group);
      group.push(s);
    }
    const pad = 24;
    const rooms = [...byRoom.entries()].map(([id, seats]) => {
      const x = Math.min(...seats.map((s) => s.rect.x)) - pad;
      const y = Math.min(...seats.map((s) => s.rect.y)) - pad;
      const w = Math.max(...seats.map((s) => s.rect.x + s.rect.width)) + pad - x;
      const h = Math.max(...seats.map((s) => s.rect.y + s.rect.height)) + pad - y;
      return { id, x, y, w, h };
    });
    bus.emit("world-info", {
      width: map.widthInPixels,
      height: map.heightInPixels,
      rooms,
      terrain,
    });
  }

  /** Briefly pan the camera to a player and pulse their sprite, then resume follow. */
  private locate(id: string) {
    const sprite =
      id === this.net.selfId ? this.player : this.remotes.get(id)?.sprite;
    if (!sprite) return;
    const cam = this.cameras.main;
    cam.stopFollow();
    cam.pan(sprite.x, sprite.y, 450, "Sine.easeInOut");
    this.tweens.add({
      targets: sprite,
      scale: 1.4,
      duration: 180,
      yoyo: true,
      repeat: 2,
    });
    this.time.delayedCall(1500, () =>
      cam.startFollow(this.player, true, 0.12, 0.12)
    );
  }

  private wireChat() {
    this.net.on("chat", (m: { id: string; text: string }) =>
      this.showChatBubble(m.id, m.text)
    );
  }

  /** Gather-style speech bubble floating above whoever spoke. Pure visual. */
  private showChatBubble(id: string, text: string) {
    const sprite =
      id === this.net.selfId ? this.player : this.remotes.get(id)?.sprite;
    if (!sprite) return;

    this.chatBubbles.get(id)?.container.destroy();

    const txt = this.add
      .text(0, 0, text, {
        fontFamily: "sans-serif",
        fontSize: "9px",
        color: "#10131a",
        align: "center",
        wordWrap: { width: 120 },
      })
      .setOrigin(0.5, 0.5);
    const padX = 6,
      padY = 4;
    const w = txt.width + padX * 2;
    const h = txt.height + padY * 2;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.96);
    g.lineStyle(1, 0x2a2f3d, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
    g.fillStyle(0xffffff, 0.96);
    g.fillTriangle(-4, h / 2, 4, h / 2, 0, h / 2 + 5);

    const offsetY = h / 2 + 5 + 34; // tail tip clears the gold nameplate above the head
    const container = this.add
      .container(sprite.x, sprite.y - offsetY, [g, txt])
      .setDepth(10000);
    this.chatBubbles.set(id, { container, sprite, offsetY, expires: this.time.now + 4500 });
  }

  private updateChatBubbles(time: number) {
    this.chatBubbles.forEach((b, id) => {
      if (!b.sprite.active || time > b.expires) {
        b.container.destroy();
        this.chatBubbles.delete(id);
        return;
      }
      b.container.setPosition(b.sprite.x, b.sprite.y - b.offsetY);
    });
  }

  private addRemote(p: PlayerState) {
    if (this.remotes.has(p.id) || p.id === this.net.selfId) return;
    // Shared with the meeting grid's camera-off tiles (chars.charForPlayer),
    // so the world sprite and the tile avatar can never diverge.
    const char = charForPlayer(p.id);
    const sprite = this.add
      .sprite(p.x, p.y, char, idleFrame(p.dir))
      .setDepth(5);
    const label = this.makeLabel(p.name);
    this.remotes.set(p.id, {
      sprite,
      label,
      tx: p.x,
      ty: p.y,
      dir: p.dir,
      name: p.name,
      char,
    });
  }

  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.sprite.destroy();
    r.label.destroy();
    this.remotes.delete(id);
  }

  private makeLabel(text: string) {
    // Minecraft-style gold nameplate with a dark outline, always above the head.
    return this.add
      .text(0, 0, text, {
        fontFamily: "monospace",
        fontSize: "10px",
        fontStyle: "bold",
        color: "#ffd24a",
        stroke: "#16100a",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(20);
  }

  update(time: number) {
    this.player.setDepth(this.player.y);
    this.handleMovement(time);
    this.keepLockedRoomsClosed();
    this.updateRemotes();
    this.updateLabels();
    this.updateChatBubbles(time);
    this.checkZones();
    this.checkRoomMembership();
    this.handleInteractKey();
    this.emitPositions(time);
  }

  private handleMovement(time: number) {
    const body = this.player;
    if (this.seated || this.boardSeated || isTyping()) {
      body.setVelocity(0, 0);
      if (!this.seated && !this.boardSeated) {
        this.player.anims.stop();
        this.player.setFrame(idleFrame(this.dir));
      }
      return;
    }
    const { vx, vy, dir, moving } = movementIntent(
      {
        left: this.cursors.left.isDown || this.wasd.A.isDown,
        right: this.cursors.right.isDown || this.wasd.D.isDown,
        up: this.cursors.up.isDown || this.wasd.W.isDown,
        down: this.cursors.down.isDown || this.wasd.S.isDown,
        run: this.keyShift.isDown,
        touchAxis: this.touchAxis,
      },
      this.dir,
      BASE_SPEED
    );
    body.setVelocity(vx, vy);
    this.dir = dir;

    if (moving) {
      this.player.anims.play(walkAnim(this.avatar, this.dir), true);
    } else {
      this.player.anims.stop();
      this.player.setFrame(idleFrame(this.dir));
    }

    if (moveSendDue(time, this.lastSent)) {
      this.lastSent = time;
      this.net.move(Math.round(body.x), Math.round(body.y), this.dir);
    }
  }

  private updateRemotes() {
    this.remotes.forEach((r) => {
      const step = interpolateStep(
        { x: r.sprite.x, y: r.sprite.y },
        { x: r.tx, y: r.ty }
      );
      r.sprite.x = step.x;
      r.sprite.y = step.y;
      r.sprite.setDepth(r.sprite.y);
      if (step.moving) r.sprite.anims.play(walkAnim(r.char, r.dir), true);
      else {
        r.sprite.anims.stop();
        r.sprite.setFrame(idleFrame(r.dir));
      }
    });
  }

  private updateLabels() {
    this.playerLabel.setPosition(this.player.x, this.player.y - 20).setDepth(9999);
    this.remotes.forEach((r) =>
      r.label.setPosition(r.sprite.x, r.sprite.y - 20).setDepth(9999)
    );
  }

  private checkZones() {
    const fx = this.player.x;
    const fy = this.player.y + 8;

    // doors (PRD 14): approaching an un-entered room knocks — the server admits
    // (empty room / open door) or queues for the admin. Walking away withdraws it.
    const inDoor = findDoor(this.doors, fx, fy);
    const doorId = inDoor ? inDoor.roomId : null;
    if (doorId !== this.currentDoor) {
      const leaving = this.currentDoor;
      this.currentDoor = doorId;
      if (inDoor && !this.enteredRooms.has(inDoor.roomId)) this.knockAt(inDoor);
      else if (leaving) this.net.cancelKnock(leaving);
      if (!inDoor || this.enteredRooms.has(inDoor.roomId)) bus.emit("stop-knocking");
    }

    // interactables
    const nearIa = findNear(this.interactables, fx, fy);
    if (nearIa !== this.currentInteractable) {
      this.currentInteractable = nearIa;
      if (nearIa)
        bus.emit("near-interactable", { id: nearIa.id, label: nearIa.label, type: nearIa.type, payload: nearIa.payload });
      else
        bus.emit("leave-interactable");
    }

    // stage zone (auditorium audience area)
    const nowInStage = inZone(this.stageZone, fx, fy);
    if (nowInStage !== this.inStage) {
      this.inStage = nowInStage;
      if (nowInStage) bus.emit("near-stage");
      else bus.emit("leave-stage");
    }
    // Drive the on-air machine every frame: standing still on the stage arms the
    // confirm prompt; the emitted effects flow to the HUD + media layer.
    this.applyOnAir({
      type: "tick",
      onStage: nowInStage,
      x: Math.floor(this.player.x),
      y: Math.floor(this.player.y),
      now: this.time.now,
    });

    // presenter zone (podium — emit regardless of seated state)
    const nowInPresenter = inZone(this.presenterZone, fx, fy);
    if (nowInPresenter !== this.inPresenterSlot) {
      this.inPresenterSlot = nowInPresenter;
      if (nowInPresenter) bus.emit("near-presenter-slot");
      else bus.emit("leave-presenter-slot");
    }

    // board-table seats (public plaza; ungated by room entry)
    if (!this.boardSeated && !this.seated) {
      let inBoard: BoardSeat | null = null;
      for (const s of this.boardSeats) if (rectContains(s.rect, fx, fy)) inBoard = s;
      if (inBoard !== this.currentBoardSeat) {
        this.currentBoardSeat = inBoard;
        if (inBoard) this.emitNearBoardSeat(inBoard);
        else bus.emit("leave-board-seat");
      }
    }

    // seats (only matter once room entered)
    if (this.seated || this.boardSeated) return;
    const inSeat = findSeat(this.seats, this.enteredRooms, fx, fy);
    if (inSeat !== this.currentSeat) {
      this.currentSeat = inSeat;
      if (inSeat)
        bus.emit("near-seat", { roomId: inSeat.roomId, seatId: inSeat.seatId });
      else bus.emit("leave-seat");
    }
  }

  /** Knock at a room's door: ask the server to admit, and (in knock mode) show
   *  the "Knocking…" UI. An open door admits silently. */
  private knockAt(door: DoorZone) {
    this.net.knock(door.roomId);
    if (shouldAnnounceKnock(this.roomOpenState.get(door.roomId))) {
      bus.emit("knocking", { roomId: door.roomId, name: door.name });
    }
  }

  /** Hold the player at a door gap until admitted — unless the room is open to
   *  all (allow-all under capacity), in which case they walk straight through. */
  private keepLockedRoomsClosed() {
    const room = findRoomArea(this.roomAreas, this.player.x, this.player.y + 8);
    if (!room) {
      this.lastPublicPosition.set(this.player.x, this.player.y);
      return;
    }
    if (doorPassable(this.enteredRooms.has(room.roomId), this.roomOpenState.get(room.roomId))) return;

    this.player.setPosition(this.lastPublicPosition.x, this.lastPublicPosition.y);
    this.player.setVelocity(0, 0);
  }

  /** Detect a genuine walk-out of the private room the player is currently inside.
   *  The doorway counts as part of the current room: the key modal can only open
   *  while standing in the door zone (outside the room bounds), so `room-entered`
   *  lands while the player is still in the doorway — treating that as "outside"
   *  would exit (and re-lock) the room on the very next frame. */
  private checkRoomMembership() {
    if (!this.currentRoom) return;
    const fx = this.player.x;
    const fy = this.player.y + 8;
    const inOwnDoorway = findDoor(this.doors, fx, fy)?.roomId === this.currentRoom;
    if (!inOwnDoorway && hasExitedRoom(this.roomAreas, this.currentRoom, fx, fy)) {
      this.exitRoom(this.currentRoom);
    }
  }

  /** Player left a private room: free the seat, drop local room state so re-entry
   *  needs the key again, and tell the server to stop routing room traffic to us. */
  private exitRoom(roomId: string) {
    this.currentRoom = null;
    this.enteredRooms.delete(roomId);
    if (this.seated) this.stand();
    this.net.leaveRoom();
    bus.emit("room-left", { roomId });
    // The door reappears unless the room is still open to all.
    this.refreshDoor(roomId);
  }

  /** Reconcile a door sprite with whether this client may currently pass it:
   *  hidden when admitted (entered) or the room is open to all, shown otherwise. */
  private refreshDoor(roomId: string) {
    const door = this.doorSprites.get(roomId);
    if (!door) return;
    const shouldOpen = doorPassable(this.enteredRooms.has(roomId), this.roomOpenState.get(roomId));
    const isOpen = this.openDoors.has(roomId);
    if (shouldOpen && !isOpen) {
      this.openDoors.add(roomId);
      bus.emit("door-open");
      door.play("door-open").once("animationcomplete", () => door.setVisible(false));
    } else if (!shouldOpen && isOpen) {
      this.openDoors.delete(roomId);
      bus.emit("door-close");
      door.setVisible(true);
      door.play("door-close");
    }
  }

  private handleInteractKey() {
    if (isTyping()) {
      this.interactQueued = false;
      return;
    }
    const pressed =
      Phaser.Input.Keyboard.JustDown(this.keyE) || this.interactQueued;
    this.interactQueued = false;
    if (pressed) {
      // Board seats take priority when standing near one (they aren't
      // interactables, so interactAction would otherwise return "sit").
      if (this.boardSeated) {
        this.boardStand();
        return;
      }
      if (!this.seated && this.currentBoardSeat && !this.currentInteractable) {
        this.tryBoardSit();
        return;
      }
      const action = interactAction(this.seated, this.currentInteractable !== null);
      if (action === "stand") this.stand();
      else if (action === "interact" && this.currentInteractable)
        this.triggerInteractable(this.currentInteractable);
      else if (action === "sit") this.trySit();
    }
  }

  private tryBoardSit() {
    const s = this.currentBoardSeat;
    if (this.boardSeated || this.seated || !s) return;
    // Refuse a sit onto a seat the authoritative snapshot shows another player
    // holds. The seat-taken hint stays; the server would reject this sit anyway,
    // so we never optimistically snap onto an occupied chair.
    if (!this.canSitBoardSeat(s)) {
      this.emitNearBoardSeat(s);
      return;
    }
    this.boardSeated = true;
    this.player.setPosition(s.cx, s.cy);
    this.player.setVelocity(0, 0);
    this.dir = s.facing;
    this.player.anims.stop();
    this.player.setFrame(idleFrame(s.facing));
    this.net.boardSit(s.tableId, s.seat);
    bus.emit("board-sat", { tableId: s.tableId, seat: s.seat, game: s.game, label: s.label });
  }

  private boardStand() {
    if (!this.boardSeated) return;
    this.net.boardStand();
    this.releaseBoardSeat();
  }

  /** True when the local player may take a board seat per the latest snapshot
   *  (unknown occupancy is optimistic — the server still validates authoritatively). */
  private canSitBoardSeat(s: BoardSeat): boolean {
    const occ = this.boardOccupants.get(s.tableId);
    return !occ || canTakeBoardSeat(occ, s.seat, this.net.selfId);
  }

  /** Emit `near-board-seat`, stamping whether the seat is occupied by someone else
   *  so the hint offers "play" only on a takeable seat. */
  private emitNearBoardSeat(s: BoardSeat) {
    bus.emit("near-board-seat", {
      tableId: s.tableId,
      seat: s.seat,
      game: s.game,
      label: s.label,
      occupied: !this.canSitBoardSeat(s),
    });
  }

  /** Mirror an authoritative board snapshot: refresh occupancy, keep the sit hint
   *  live, and roll back an optimistic local seat the server did not grant us. */
  private onBoardUpdate(snap: BoardUpdatePayload) {
    const occ = boardSeatOccupants(snap);
    this.boardOccupants.set(snap.tableId, occ);
    const s = this.currentBoardSeat;
    if (!s || s.tableId !== snap.tableId) return;
    // We optimistically took this seat but the authoritative snapshot hands it to
    // someone else (lost race) — stand back up locally.
    if (this.boardSeated && occ[s.seat] !== null && occ[s.seat] !== this.net.selfId) {
      this.releaseBoardSeat();
      return;
    }
    if (!this.boardSeated) this.emitNearBoardSeat(s);
  }

  /** Roll back the local board seat (optimistic-sit reversal or a real stand):
   *  step off the chair and reset UI. Does NOT emit a `board-stand` to the server
   *  (a rejected sit was never granted; a genuine stand sends it before calling us). */
  private releaseBoardSeat() {
    if (!this.boardSeated) return;
    this.boardSeated = false;
    this.player.y += 18;
    bus.emit("board-stood");
    // Refresh the hint for the seat we're still standing on (now "seat taken").
    if (this.currentBoardSeat) this.emitNearBoardSeat(this.currentBoardSeat);
  }

  private triggerInteractable(ia: InteractableDef) {
    if (ia.type === "portal") {
      const tx = Number(ia.payload.targetX);
      const ty = Number(ia.payload.targetY);
      if (!isNaN(tx) && !isNaN(ty)) this.player.setPosition(tx, ty);
    } else if (ia.type === "arcade") {
      // Fail closed: only a canonical ARCADE_GAMES id may open the overlay.
      // The scene sleeps here and ONLY close-arcade wakes it, so emitting (and
      // sleeping) for a payload the app shell would ignore would freeze the
      // world permanently. Validation lives in the pure arcadeOpenPayload
      // (interactables.ts) with its own tests; App re-checks as defense in depth.
      const open = arcadeOpenPayload(ia);
      if (!open) {
        console.warn(`arcade cabinet "${ia.id}" has an unknown game id — ignoring`, ia.payload);
        return;
      }
      // Freeze the world under the overlay (same sleep pattern as meetings);
      // React owns the game. close-arcade wakes us (wired in create()).
      bus.emit("open-arcade", open);
      if (!this.scene.isSleeping()) this.scene.sleep();
    } else {
      bus.emit("open-interactable", { type: ia.type, label: ia.label, payload: ia.payload });
    }
  }

  private trySit() {
    const s = this.currentSeat;
    const t = seatTransition(this.seated, "sit", s !== null);
    if (t.effect !== "sit" || !s) return;
    this.seated = t.seated;
    this.player.setPosition(s.cx, s.cy);
    this.player.setVelocity(0, 0);
    this.dir = s.facing;
    this.player.anims.stop();
    this.player.setFrame(idleFrame(s.facing));
    this.net.sit(s.roomId, s.seatId);
    bus.emit("sat", { roomId: s.roomId, seatId: s.seatId });
  }

  private stand() {
    const t = seatTransition(this.seated, "stand", this.currentSeat !== null);
    if (t.effect !== "stand") return;
    this.seated = t.seated;
    this.player.y += 18;
    this.net.stand();
    bus.emit("stood");
  }

  /**
   * Portal Phase A (PRD 10): camera punch-in + slow fade toward the table,
   * then capture ONE frame at the portal peak for the meeting backdrop, emit
   * `portal-phase-a-done` for the React handoff (game/portalHandoff.ts), and
   * sleep the scene — the render loop stays off for the whole meeting, and
   * with `update()` stopped, socket movement emission pauses with it (the
   * Socket.IO transport's own heartbeat keeps the connection alive).
   */
  private portalIn() {
    if (this.scene.isSleeping()) return;
    const cam = this.cameras.main;
    cam.stopFollow();
    cam.pan(this.player.x, this.player.y, PORTAL_MS, "Sine.easeInOut");
    cam.fadeOut(PORTAL_FADE_MS, 0, 0, 0);
    // All Phase A wiring (which gate guards which effect, and in what order)
    // lives in runPortalCinematic; the scene only supplies real Phaser effects.
    runPortalCinematic(
      {
        get: () => this.cinematic,
        set: (state) => {
          this.cinematic = state;
        },
      },
      {
        startZoom: (onZoomComplete) => {
          cam.zoomTo(
            ZOOM * PORTAL_ZOOM_FACTOR,
            PORTAL_MS,
            "Sine.easeIn",
            false,
            (_camera: Phaser.Cameras.Scene2D.Camera, progress: number) => {
              if (progress === 1) onZoomComplete();
            },
          );
        },
        captureSnapshot: (onResult) => {
          try {
            this.game.renderer.snapshot((snap) => {
              onResult(snap instanceof HTMLImageElement ? snap.src : null);
            });
          } catch {
            onResult(null);
          }
        },
        scheduleTimeout: (onTimeout) => {
          this.time.delayedCall(SNAPSHOT_TIMEOUT_MS, onTimeout);
        },
        emitDone: (image) => bus.emit("portal-phase-a-done", { image }),
        sleep: () => this.scene.sleep(),
      },
    );
  }

  /** Portal-out: invalidate any in-flight Phase A, wake the render loop, and
   *  restore the camera to world state. */
  private portalOut() {
    this.cinematic = cancelPortal(this.cinematic);
    if (this.scene.isSleeping()) this.scene.wake();
    const cam = this.cameras.main;
    cam.resetFX();
    cam.setZoom(ZOOM);
    cam.startFollow(this.player, true, 0.12, 0.12);
    cam.fadeIn(250, 0, 0, 0);
  }

  private emitPositions(time: number) {
    if (!positionsEmitDue(time, this.lastTick)) return;
    this.lastTick = time;
    const cam = this.cameras.main;
    const toScreen = (wx: number, wy: number) => ({
      sx: (wx - cam.worldView.x) * cam.zoom,
      sy: (wy - cam.worldView.y) * cam.zoom,
    });
    // Zone is sampled at the feet point (y + 8) so audio-zone membership matches
    // the room-entry detection above (findRoomArea uses the same offset). Each
    // client derives every player's zone locally from broadcast positions — no
    // wire-format change, no per-frame network traffic.
    const players = [
      {
        id: this.net.selfId,
        self: true,
        x: this.player.x,
        y: this.player.y,
        zone: zoneAt(this.roomAreas, this.player.x, this.player.y + 8),
        ...toScreen(this.player.x, this.player.y),
      },
      ...[...this.remotes].map(([id, r]) => ({
        id,
        self: false,
        x: r.sprite.x,
        y: r.sprite.y,
        zone: zoneAt(this.roomAreas, r.sprite.x, r.sprite.y + 8),
        ...toScreen(r.sprite.x, r.sprite.y),
      })),
    ];
    bus.emit("positions", { players, seated: this.seated });
  }
}

/**
 * Rectangle from a Tiled object. Tiled types x/y/width/height as optional, but
 * rectangle objects always carry them; default to 0 (or the caller's fallback
 * dimensions) so a malformed object degrades gracefully instead of asserting.
 */
function rectOf(
  o: Phaser.Types.Tilemaps.TiledObject,
  dw = 0,
  dh = 0
): Phaser.Geom.Rectangle {
  return new Phaser.Geom.Rectangle(o.x ?? 0, o.y ?? 0, o.width || dw, o.height || dh);
}

function prop(o: Phaser.Types.Tilemaps.TiledObject, name: string): string | undefined {
  const p = (o.properties as { name: string; value: unknown }[] | undefined)?.find(
    (x) => x.name === name
  );
  return p ? String(p.value) : undefined;
}

/** True when a DOM text field (chat, key modal) is focused — game input pauses. */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable === true
  );
}
