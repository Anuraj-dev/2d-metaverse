#!/usr/bin/env python3
"""Offline campus region renderer — shared iteration harness for art restyles.

Composites a tile-rect crop of campus.json (tile layers + furniture sprites)
into a PNG so agents can judge layout without a browser.

Usage
-----
  # Inclusive tile coords (x0 y0 x1 y1):
  python3 frontend/scripts/render_region.py 10 100 26 110 /tmp/room3.png
  python3 frontend/scripts/render_region.py 10 100 26 110 /tmp/room3.png --scale 4

  # Named district (from gen_campus.py docstring):
  python3 frontend/scripts/render_region.py HOSTEL /tmp/hostel.png --scale 2
  # PARK HQ AUDITORIUM PLAZA CAFE COWORKING HOSTEL

  # Debug overlays (confirm seats/doors/interactables not covered by props):
  python3 frontend/scripts/render_region.py 10 100 26 110 /tmp/r3.png --grid --markers

Flags
-----
  --scale N     Integer nearest-neighbour upscale (default 3)
  --grid        Draw 1-tile grid + tile coordinate labels on every 4th tile
  --markers     Tint seat (green), board-seat (cyan), door (orange),
                interactable (magenta) rects so frozen objects stay visible
  --no-chairs   Skip the seat/board-seat chair sprites WorldScene draws
                (default: draw them, matching the in-game look)

Furniture anchoring matches WorldScene: each furniture object is a POINT at
tile centre (tx*16+8, ty*16+8); the sprite is drawn centred on that point.
Run from anywhere; paths resolve relative to this script.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "public", "assets")
MAP = os.path.join(ASSETS, "maps", "campus.json")
FURN_DIR = os.path.join(ASSETS, "furniture")

# District bounds (inclusive tile coords) — keep in lockstep with gen_campus.py
# module docstring. Do not invent new names here.
DISTRICTS = {
    "PARK":       (1, 1, 28, 55),
    "HQ":         (30, 1, 79, 24),
    "AUDITORIUM": (81, 1, 118, 44),
    "PLAZA":      (12, 26, 107, 60),
    "CAFE":       (1, 62, 55, 88),
    "COWORKING":  (57, 62, 118, 88),
    "HOSTEL":     (10, 93, 52, 110),
}

FLIP_H, FLIP_V, FLIP_D = 0x80000000, 0x40000000, 0x20000000
GID_MASK = ~(FLIP_H | FLIP_V | FLIP_D) & 0xFFFFFFFF
# Dark void so empty/edge reads as "off-map", never black-confused-with-shadow.
BG = (24, 24, 28, 255)

# Marker colours (semi-transparent overlays)
CLR_SEAT = (40, 220, 80, 110)
CLR_BOARD = (40, 200, 220, 110)
CLR_DOOR = (255, 140, 40, 130)
CLR_IA = (240, 40, 220, 120)
CLR_GRID = (255, 255, 255, 55)
CLR_LABEL = (255, 255, 200, 200)


def load_tilesets(m):
    """Resolve tileset PNGs the same way gen_landing_backdrop does (firstgid order)."""
    out = []
    for t in sorted(m["tilesets"], key=lambda x: x["firstgid"]):
        src = t.get("source") or t.get("image")
        img = Image.open(os.path.join(ASSETS, "maps", src)).convert("RGBA")
        out.append({
            "first": t["firstgid"],
            "img": img,
            "cols": t["columns"],
            "count": t.get("tilecount", (img.width // t["tilewidth"]) * (img.height // t["tileheight"])),
        })
    return out


def resolve(gid, tilesets, ts, cache):
    """Crop + flip a single tile; cache by raw gid (includes flip bits)."""
    hit = cache.get(gid)
    if hit is not None:
        return hit
    real = gid & GID_MASK
    if real == 0:
        cache[gid] = None
        return None
    chosen = None
    for t in tilesets:
        if t["first"] <= real < t["first"] + t["count"]:
            chosen = t
            break
    if chosen is None:
        # Fallback: last tileset whose firstgid <= real (landing-backdrop style)
        for t in tilesets:
            if real >= t["first"]:
                chosen = t
    if chosen is None:
        cache[gid] = None
        return None
    local = real - chosen["first"]
    col, row = local % chosen["cols"], local // chosen["cols"]
    tile = chosen["img"].crop((col * ts, row * ts, col * ts + ts, row * ts + ts))
    if gid & FLIP_H:
        tile = tile.transpose(Image.FLIP_LEFT_RIGHT)
    if gid & FLIP_V:
        tile = tile.transpose(Image.FLIP_TOP_BOTTOM)
    cache[gid] = tile
    return tile


def prop(o, name):
    for p in o.get("properties", []):
        if p["name"] == name:
            return p["value"]
    return None


def alpha_blit(canvas, img, x, y):
    """alpha_composite allowing negative / oversized destinations (clips)."""
    if img is None:
        return
    cw, ch = canvas.size
    iw, ih = img.size
    dx0, dy0 = int(x), int(y)
    sx0 = max(0, -dx0)
    sy0 = max(0, -dy0)
    sx1 = min(iw, cw - dx0)
    sy1 = min(ih, ch - dy0)
    if sx0 >= sx1 or sy0 >= sy1:
        return
    patch = img if (sx0, sy0, sx1, sy1) == (0, 0, iw, ih) else img.crop((sx0, sy0, sx1, sy1))
    canvas.alpha_composite(patch, (dx0 + sx0, dy0 + sy0))


def parse_args(argv):
    p = argparse.ArgumentParser(
        prog="render_region.py",
        description="Composite a campus.json tile region (+ furniture) to PNG.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "region",
        nargs="+",
        help="District name (PARK/HQ/…) OR four inclusive tile ints: x0 y0 x1 y1",
    )
    p.add_argument("out", help="Output PNG path")
    p.add_argument("--scale", type=int, default=3, help="Nearest-neighbour upscale (default 3)")
    p.add_argument("--grid", action="store_true", help="Overlay tile grid + coords")
    p.add_argument("--markers", action="store_true",
                   help="Tint seats / board seats / doors / interactables")
    p.add_argument("--no-chairs", action="store_true",
                   help="Do not draw seat chair sprites (furniture layer only)")
    return p.parse_args(argv)


def resolve_region(tokens):
    if len(tokens) == 1:
        name = tokens[0].upper()
        if name not in DISTRICTS:
            raise SystemExit(
                f"unknown district {tokens[0]!r}; choose one of: "
                + ", ".join(DISTRICTS)
            )
        return DISTRICTS[name]
    if len(tokens) == 4:
        try:
            x0, y0, x1, y1 = (int(t) for t in tokens)
        except ValueError as e:
            raise SystemExit(f"region coords must be ints: {e}") from e
        if x1 < x0 or y1 < y0:
            raise SystemExit(f"region inverted: x0..x1={x0}..{x1} y0..y1={y0}..{y1}")
        return x0, y0, x1, y1
    raise SystemExit(
        "region must be a district name OR four ints x0 y0 x1 y1; "
        f"got {len(tokens)} token(s): {tokens}"
    )


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    if args.scale < 1:
        raise SystemExit("--scale must be >= 1")

    x0, y0, x1, y1 = resolve_region(args.region)
    tw, th = x1 - x0 + 1, y1 - y0 + 1

    m = json.load(open(MAP))
    W, map_h, TS = m["width"], m["height"], m["tilewidth"]
    tilesets = load_tilesets(m)
    by_name = {L["name"]: L for L in m["layers"]}
    tile_cache: dict = {}
    spr_cache: dict = {}

    canvas = Image.new("RGBA", (tw * TS, th * TS), BG)
    px0, py0 = x0 * TS, y0 * TS

    def blit_layer(name):
        layer = by_name.get(name)
        if not layer or layer.get("type") != "tilelayer":
            return
        data = layer["data"]
        # Clamp to map bounds so a district that overshoots still renders.
        ty_lo = max(y0, 0)
        ty_hi = min(y1, map_h - 1)
        tx_lo = max(x0, 0)
        tx_hi = min(x1, W - 1)
        for ty in range(ty_lo, ty_hi + 1):
            row = ty * W
            for tx in range(tx_lo, tx_hi + 1):
                gid = data[row + tx]
                if gid == 0:
                    continue
                tile = resolve(gid, tilesets, TS, tile_cache)
                if tile is not None:
                    canvas.alpha_composite(tile, ((tx - x0) * TS, (ty - y0) * TS))

    # Tile stack under sprites (WorldScene createLayer order).
    blit_layer("ground")
    blit_layer("ground_decor")
    if "decor_below" in by_name:
        blit_layer("decor_below")
    blit_layer("walls")

    def sprite(key):
        if not key:
            return None
        if key in spr_cache:
            return spr_cache[key]
        base = key[2:] if key.startswith("f_") else key
        fn = os.path.join(FURN_DIR, base + ".png")
        img = Image.open(fn).convert("RGBA") if os.path.exists(fn) else None
        if img is None:
            print(f"  !! missing sprite for {key}", file=sys.stderr)
        spr_cache[key] = img
        return img

    # Furniture points + seat chairs, depth-sorted by y (matches WorldScene depth=y).
    draws = []  # (y, img, cx, cy)

    for o in by_name.get("furniture", {}).get("objects", []):
        key = prop(o, "key")
        img = sprite(key)
        if img is None:
            continue
        cx, cy = float(o["x"]), float(o["y"])
        # Cheap cull: skip if the sprite AABB is fully outside the crop.
        half_w, half_h = img.width / 2, img.height / 2
        if (cx + half_w < px0 or cy + half_h < py0
                or cx - half_w > px0 + canvas.width
                or cy - half_h > py0 + canvas.height):
            continue
        draws.append((cy, img, cx, cy))

    # WorldScene.buildFurniture also draws a fallback round table at each room's
    # seat centroid, unless the map already authors a solid there. Replicate it
    # or the render lies about every meeting room.
    if not args.no_chairs:
        solids = [(float(o["x"]), float(o["y"]))
                  for o in by_name.get("furniture", {}).get("objects", [])
                  if prop(o, "solid") is True]
        by_room = {}
        for o in by_name.get("seats", {}).get("objects", []):
            by_room.setdefault(prop(o, "roomId"), []).append(
                (float(o["x"]) + float(o.get("width") or TS) / 2,
                 float(o["y"]) + float(o.get("height") or TS) / 2))
        for pts in by_room.values():
            cx = sum(p[0] for p in pts) / len(pts)
            cy = sum(p[1] for p in pts) / len(pts) - 4
            if any(abs(sx - cx) < TS and abs(sy - cy) < TS for sx, sy in solids):
                continue
            img = sprite("f_table_round")
            if img is not None:
                draws.append((cy, img, cx, cy))

    if not args.no_chairs:
        for group in ("seats", "board_seats"):
            for o in by_name.get(group, {}).get("objects", []):
                # Seats are tile-aligned rects; centre matches WorldScene seat.cx/cy.
                cx = float(o["x"]) + float(o.get("width") or TS) / 2
                cy = float(o["y"]) + float(o.get("height") or TS) / 2
                facing = prop(o, "facing") or "down"
                if facing == "right":
                    img = sprite("f_chair_side")
                    if img is not None:
                        img = img.transpose(Image.FLIP_LEFT_RIGHT)
                elif facing == "left":
                    img = sprite("f_chair_side")
                elif facing == "up":
                    img = sprite("f_chair")
                    if img is not None:
                        img = img.transpose(Image.ROTATE_180)
                else:
                    img = sprite("f_chair")
                if img is None:
                    continue
                half_w, half_h = img.width / 2, img.height / 2
                if (cx + half_w < px0 or cy + half_h < py0
                        or cx - half_w > px0 + canvas.width
                        or cy - half_h > py0 + canvas.height):
                    continue
                draws.append((cy, img, cx, cy))

    for _, img, cx, cy in sorted(draws, key=lambda d: d[0]):
        # Centre the sprite on the point — same as Phaser Image default origin 0.5,0.5.
        alpha_blit(canvas, img, cx - img.width / 2 - px0, cy - img.height / 2 - py0)

    # decor_above is depth 3000 in WorldScene — over players/furniture.
    blit_layer("decor_above")

    if args.markers:
        overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        def rect_tint(o, color):
            rx, ry = float(o["x"]) - px0, float(o["y"]) - py0
            rw = float(o.get("width") or TS)
            rh = float(o.get("height") or TS)
            draw.rectangle([rx, ry, rx + rw - 1, ry + rh - 1], fill=color, outline=color[:3] + (200,))

        for o in by_name.get("seats", {}).get("objects", []):
            rect_tint(o, CLR_SEAT)
        for o in by_name.get("board_seats", {}).get("objects", []):
            rect_tint(o, CLR_BOARD)
        for o in by_name.get("doorZones", {}).get("objects", []):
            rect_tint(o, CLR_DOOR)
        for o in by_name.get("interactables", {}).get("objects", []):
            rect_tint(o, CLR_IA)
        canvas = Image.alpha_composite(canvas, overlay)

    if args.grid:
        overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        # Try a tiny default font; fall back to bitmap if unavailable.
        try:
            font = ImageFont.load_default()
        except Exception:
            font = None
        for tx in range(x0, x1 + 1):
            gx = (tx - x0) * TS
            draw.line([(gx, 0), (gx, canvas.height - 1)], fill=CLR_GRID)
        for ty in range(y0, y1 + 1):
            gy = (ty - y0) * TS
            draw.line([(0, gy), (canvas.width - 1, gy)], fill=CLR_GRID)
        # Outer edge
        draw.rectangle([0, 0, canvas.width - 1, canvas.height - 1], outline=CLR_GRID)
        # Label every 4th tile (and origin of crop) so agents can read coords.
        for ty in range(y0, y1 + 1):
            for tx in range(x0, x1 + 1):
                if (tx - x0) % 4 == 0 and (ty - y0) % 4 == 0:
                    gx = (tx - x0) * TS + 1
                    gy = (ty - y0) * TS + 1
                    draw.text((gx, gy), f"{tx},{ty}", fill=CLR_LABEL, font=font)
        canvas = Image.alpha_composite(canvas, overlay)

    if args.scale != 1:
        canvas = canvas.resize(
            (canvas.width * args.scale, canvas.height * args.scale),
            Image.NEAREST,
        )

    out_path = args.out
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    canvas.convert("RGB").save(out_path, optimize=True)
    print(
        f"wrote {out_path} ({canvas.width}x{canvas.height}) "
        f"tiles {x0},{y0}..{x1},{y1} ({tw}x{th}) scale={args.scale}"
    )


if __name__ == "__main__":
    main()
