import Phaser from "phaser";
import type { Dir, PlayerState } from "../../contract";
import type { Net } from "../../net/net";
import { bus } from "../eventBus";
import { createCharAnims, idleFrame, walkAnim } from "../avatar";
import { activeMap } from "../maps";

const SPEED = 120;
const ZOOM = 2.2;
const CHARS = ["char1", "char2", "char3", "char4"];

interface Remote {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  tx: number;
  ty: number;
  dir: Dir;
  name: string;
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

export default class WorldScene extends Phaser.Scene {
  private net!: Net;
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerLabel!: Phaser.GameObjects.Text;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
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
  private seats: Seat[] = [];
  private furniture: { key: string; x: number; y: number; solid: boolean }[] = [];
  private roomAreas: { roomId: string; rect: Phaser.Geom.Rectangle }[] = [];
  private enteredRooms = new Set<string>();
  private currentDoor: string | null = null;
  private currentSeat: Seat | null = null;
  private seated = false;
  private currentRoom: string | null = null;
  private lastPublicPosition = new Phaser.Math.Vector2();
  private avatar = "char1";

  private dir: Dir = "down";
  private lastSent = 0;
  private lastTick = 0;

  constructor() {
    super("world");
  }

  create() {
    this.net = this.registry.get("net") as Net;
    CHARS.forEach((c) => createCharAnims(this, c));
    const saved = localStorage.getItem("avatar");
    this.avatar = saved && CHARS.includes(saved) ? saved : "char1";

    const map = this.make.tilemap({ key: activeMap().key });
    // A map may reference multiple tilesets; add each by its Tiled name (which
    // equals the loaded image key per the maps registry convention).
    const tiles = map.tilesets.map((ts) => map.addTilesetImage(ts.name, ts.name)!);
    map.createLayer("ground", tiles, 0, 0);
    const walls = map.createLayer("walls", tiles, 0, 0)!;
    walls.setCollisionByExclusion([-1]);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setZoom(ZOOM);
    this.cameras.main.roundPixels = true;

    // object layers -> doors + seats
    this.parseObjects(map);

    // spawn point
    const spawn = map.findObject("spawn", (o) => o.name === "spawn");
    const sx = (spawn?.x as number) ?? 320;
    const sy = (spawn?.y as number) ?? 288;

    this.player = this.physics.add.sprite(sx, sy, this.avatar, idleFrame("down"));
    this.player.setSize(18, 14).setOffset(7, 16);
    this.lastPublicPosition.set(sx, sy);
    this.physics.add.collider(this.player, walls);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.buildFurniture();
    this.emitWorldInfo(map);

    this.playerLabel = this.makeLabel("You");

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.keyE = this.input.keyboard!.addKey("E");
    this.keyShift = this.input.keyboard!.addKey("SHIFT");
    // Phaser captures WASD/E/arrows on window and preventDefaults them, which
    // stops those characters reaching DOM inputs (chat). Drop the capture so
    // typing works; movement still reads key state. isTyping() gates the game.
    this.input.keyboard!.clearCaptures();

    this.wireNet();
    this.wireUi();
    this.wireChat();
    this.net.connect(localStorage.getItem("token") ?? "dev", "1");

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
      this.doors.push({
        roomId,
        name: o.name || `Room ${roomId}`,
        rect: new Phaser.Geom.Rectangle(o.x!, o.y!, o.width!, o.height!),
      });
    }
    const seatObjs = map.getObjectLayer("seats")?.objects ?? [];
    for (const o of seatObjs) {
      const cx = o.x! + (o.width! || 16) / 2;
      const cy = o.y! + (o.height! || 16) / 2;
      this.seats.push({
        roomId: prop(o, "roomId") ?? "",
        seatId: Number(prop(o, "seatId") ?? 0),
        facing: (prop(o, "facing") as Dir) ?? "down",
        rect: new Phaser.Geom.Rectangle(o.x!, o.y!, o.width! || 16, o.height! || 16),
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
        x: o.x!,
        y: o.y!,
        solid: prop(o, "solid") === "true",
      });
    }
    const roomObjs = map.getObjectLayer("roomBounds")?.objects ?? [];
    for (const o of roomObjs) {
      const roomId = prop(o, "roomId");
      if (!roomId) continue;
      this.roomAreas.push({
        roomId,
        rect: new Phaser.Geom.Rectangle(o.x!, o.y!, o.width!, o.height!),
      });
    }
  }

  /** Tables (room centres), chairs (every seat, facing the table), and decor. */
  private buildFurniture() {
    const solids = this.physics.add.staticGroup();

    // group seats by room → table at the centroid, a chair on each seat
    const byRoom = new Map<string, Seat[]>();
    for (const s of this.seats) {
      if (!byRoom.has(s.roomId)) byRoom.set(s.roomId, []);
      byRoom.get(s.roomId)!.push(s);
    }
    for (const seats of byRoom.values()) {
      const cx = seats.reduce((a, s) => a + s.cx, 0) / seats.length;
      const cy = seats.reduce((a, s) => a + s.cy, 0) / seats.length;
      this.addSolid(solids, "f_table_round", cx, cy - 4);
      for (const s of seats) this.addChair(s);
    }

    // zone decor authored in the map's `furniture` object layer (data-driven)
    for (const f of this.furniture) {
      if (f.solid) this.addSolid(solids, f.key, f.x, f.y);
      else this.add.image(f.x, f.y, f.key).setDepth(f.y);
    }

    this.physics.add.collider(this.player, solids);
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
    img.body!.setSize(bw, bh);
    img.body!.setOffset((img.width - bw) / 2, img.height - bh);
    img.refreshBody();
  }

  private addChair(seat: Seat) {
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
      this.currentRoom = p.roomId; // membership starts at the door on key accept
    });
    bus.on("do-sit", () => this.trySit());
    bus.on("do-stand", () => this.stand());
    bus.on("locate", (p: { id: string }) => this.locate(p.id));
    bus.on("move-axis", (p: { x: number; y: number }) => (this.touchAxis = p));
    bus.on("do-interact", () => (this.interactQueued = true));
  }

  /** One-time snapshot of map size + room footprints for the minimap. */
  private emitWorldInfo(map: Phaser.Tilemaps.Tilemap) {
    const byRoom = new Map<string, Seat[]>();
    for (const s of this.seats) {
      if (!byRoom.has(s.roomId)) byRoom.set(s.roomId, []);
      byRoom.get(s.roomId)!.push(s);
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
    const char = CHARS[hash(p.id) % CHARS.length];
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
    if (this.seated || isTyping()) {
      body.setVelocity(0, 0);
      if (!this.seated) {
        this.player.anims.stop();
        this.player.setFrame(idleFrame(this.dir));
      }
      return;
    }
    const speed = this.keyShift.isDown ? SPEED * 1.6 : SPEED;
    let ax = 0,
      ay = 0;
    if (this.cursors.left.isDown || this.wasd.A.isDown) ax -= 1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) ax += 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) ay -= 1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) ay += 1;
    // on-screen joystick (mobile) overrides keyboard when engaged
    if (this.touchAxis.x !== 0 || this.touchAxis.y !== 0) {
      ax = this.touchAxis.x;
      ay = this.touchAxis.y;
    }
    let vx = ax * speed,
      vy = ay * speed;
    const mag = Math.hypot(vx, vy);
    if (mag > speed) {
      vx = (vx / mag) * speed;
      vy = (vy / mag) * speed;
    }
    body.setVelocity(vx, vy);

    const moving = mag > 0.01;
    if (moving) {
      if (Math.abs(vx) > Math.abs(vy)) this.dir = vx < 0 ? "left" : "right";
      else this.dir = vy < 0 ? "up" : "down";
      this.player.anims.play(walkAnim(this.avatar, this.dir), true);
    } else {
      this.player.anims.stop();
      this.player.setFrame(idleFrame(this.dir));
    }

    if (time - this.lastSent > 80) {
      this.lastSent = time;
      this.net.move(Math.round(body.x), Math.round(body.y), this.dir);
    }
  }

  private updateRemotes() {
    this.remotes.forEach((r) => {
      const dx = r.tx - r.sprite.x;
      const dy = r.ty - r.sprite.y;
      const moving = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
      r.sprite.x += dx * 0.2;
      r.sprite.y += dy * 0.2;
      r.sprite.setDepth(r.sprite.y);
      const char = CHARS[hash([...this.remotes].find(([, v]) => v === r)![0]) %
        CHARS.length];
      if (moving) r.sprite.anims.play(walkAnim(char, r.dir), true);
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

    // doors
    let inDoor: DoorZone | null = null;
    for (const d of this.doors)
      if (Phaser.Geom.Rectangle.Contains(d.rect, fx, fy)) inDoor = d;
    const doorId = inDoor ? inDoor.roomId : null;
    if (doorId !== this.currentDoor) {
      this.currentDoor = doorId;
      if (inDoor && !this.enteredRooms.has(inDoor.roomId))
        bus.emit("near-door", { roomId: inDoor.roomId, name: inDoor.name });
      else bus.emit("leave-door");
    }

    // seats (only matter once room entered)
    if (this.seated) return;
    let inSeat: Seat | null = null;
    for (const s of this.seats)
      if (
        this.enteredRooms.has(s.roomId) &&
        Phaser.Geom.Rectangle.Contains(s.rect, fx, fy)
      )
        inSeat = s;
    if (inSeat !== this.currentSeat) {
      this.currentSeat = inSeat;
      if (inSeat)
        bus.emit("near-seat", { roomId: inSeat.roomId, seatId: inSeat.seatId });
      else bus.emit("leave-seat");
    }
  }

  /** Prevent walking through a door gap until the server has accepted its key. */
  private keepLockedRoomsClosed() {
    const room = this.roomAreas.find((area) =>
      Phaser.Geom.Rectangle.Contains(area.rect, this.player.x, this.player.y + 8)
    );
    if (!room) {
      this.lastPublicPosition.set(this.player.x, this.player.y);
      return;
    }
    if (this.enteredRooms.has(room.roomId)) return;

    this.player.setPosition(this.lastPublicPosition.x, this.lastPublicPosition.y);
    this.player.setVelocity(0, 0);
  }

  /** Detect a genuine walk-out of the private room the player is currently inside. */
  private checkRoomMembership() {
    if (!this.currentRoom) return;
    const area = this.roomAreas.find((a) => a.roomId === this.currentRoom);
    if (!area) return;
    if (!Phaser.Geom.Rectangle.Contains(area.rect, this.player.x, this.player.y + 8)) {
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
      if (this.seated) this.stand();
      else this.trySit();
    }
  }

  private trySit() {
    if (this.seated || !this.currentSeat) return;
    const s = this.currentSeat;
    this.seated = true;
    this.player.setPosition(s.cx, s.cy);
    this.player.setVelocity(0, 0);
    this.dir = s.facing;
    this.player.anims.stop();
    this.player.setFrame(idleFrame(s.facing));
    this.net.sit(s.roomId, s.seatId);
    bus.emit("sat", { roomId: s.roomId, seatId: s.seatId });
  }

  private stand() {
    if (!this.seated) return;
    this.seated = false;
    this.player.y += 18;
    this.net.stand();
    bus.emit("stood");
  }

  private emitPositions(time: number) {
    if (time - this.lastTick < 66) return;
    this.lastTick = time;
    const cam = this.cameras.main;
    const toScreen = (wx: number, wy: number) => ({
      sx: (wx - cam.worldView.x) * cam.zoom,
      sy: (wy - cam.worldView.y) * cam.zoom,
    });
    const players = [
      {
        id: this.net.selfId,
        self: true,
        x: this.player.x,
        y: this.player.y,
        ...toScreen(this.player.x, this.player.y),
      },
      ...[...this.remotes].map(([id, r]) => ({
        id,
        self: false,
        x: r.sprite.x,
        y: r.sprite.y,
        ...toScreen(r.sprite.x, r.sprite.y),
      })),
    ];
    bus.emit("positions", { players, seated: this.seated });
  }
}

function prop(o: Phaser.Types.Tilemaps.TiledObject, name: string): string | undefined {
  const p = (o.properties as { name: string; value: unknown }[] | undefined)?.find(
    (x) => x.name === name
  );
  return p ? String(p.value) : undefined;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
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
