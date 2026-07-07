#!/usr/bin/env python3
"""Compose the landing hero backdrop (PRD 19) from the real campus map.

Renders a fixed tile-rect crop of the central campus park/plaza — the exact same
tiles, tilesets and furniture the game draws — into a single palette-quantised PNG
that the landing page uses as its diorama backdrop. No new art is authored: this is
a pure composition of already-attributed pack assets (see ATTRIBUTIONS.md), so the
landing stays inside the locked Pipoya-family art direction and the backdrop is
reproducible from source instead of being a hand-captured screenshot.

Run from anywhere:  python3 frontend/scripts/gen_landing_backdrop.py
Output:            frontend/public/assets/landing/campus-hero.png
"""
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "public", "assets")
MAP = os.path.join(ASSETS, "maps", "campus.json")
OUT = os.path.join(ASSETS, "landing", "campus-hero.png")

# Crop rectangle in tile coordinates: the tree park flowing into the open plaza,
# with the auth card's future home (the plainer right-hand plaza) kept uncluttered.
CROP = dict(tx=1, ty=19, tw=62, th=33)

FLIP_H, FLIP_V, FLIP_D = 0x80000000, 0x40000000, 0x20000000
GID_MASK = ~(FLIP_H | FLIP_V | FLIP_D) & 0xFFFFFFFF
# Fallback grass so any (impossible) gap reads as lawn, never black.
GRASS = (120, 170, 90, 255)


def load_tilesets(m):
    out = []
    for t in sorted(m["tilesets"], key=lambda x: x["firstgid"]):
        src = t.get("source") or t.get("image")
        img = Image.open(os.path.join(ASSETS, "maps", src)).convert("RGBA")
        out.append({"first": t["firstgid"], "img": img, "cols": t["columns"]})
    return out


def resolve(gid, tilesets, ts):
    real = gid & GID_MASK
    if real == 0:
        return None
    chosen = None
    for t in tilesets:
        if real >= t["first"]:
            chosen = t
    local = real - chosen["first"]
    col, row = local % chosen["cols"], local // chosen["cols"]
    tile = chosen["img"].crop((col * ts, row * ts, col * ts + ts, row * ts + ts))
    if gid & FLIP_H:
        tile = tile.transpose(Image.FLIP_LEFT_RIGHT)
    if gid & FLIP_V:
        tile = tile.transpose(Image.FLIP_TOP_BOTTOM)
    return tile


def main():
    m = json.load(open(MAP))
    W, H, TS = m["width"], m["height"], m["tilewidth"]
    tilesets = load_tilesets(m)
    by_name = {L["name"]: L for L in m["layers"]}

    canvas = Image.new("RGBA", (W * TS, H * TS), GRASS)
    for name in ("ground", "ground_decor", "walls", "decor_above"):
        for i, gid in enumerate(by_name[name]["data"]):
            if gid == 0:
                continue
            tile = resolve(gid, tilesets, TS)
            if tile is not None:
                canvas.alpha_composite(tile, ((i % W) * TS, (i // W) * TS))

    # Furniture objects are standalone PNGs keyed as f_<name> -> furniture/<name>.png.
    for o in by_name["furniture"]["objects"]:
        key = next((p["value"] for p in o.get("properties", []) if p["name"] == "key"), None)
        if not key or not key.startswith("f_"):
            continue
        fn = os.path.join(ASSETS, "furniture", key[2:] + ".png")
        if os.path.exists(fn):
            canvas.alpha_composite(Image.open(fn).convert("RGBA"), (int(o["x"]), int(o["y"])))

    box = (CROP["tx"] * TS, CROP["ty"] * TS,
           (CROP["tx"] + CROP["tw"]) * TS, (CROP["ty"] + CROP["th"]) * TS)
    crop = canvas.crop(box).convert("RGB")

    # Pixel art has a small palette: quantise (no dither) so the PNG stays tiny and
    # crisp. It ships in public/, so it never touches the entry-JS bundle budget,
    # but keeping it light still helps first paint.
    quant = crop.quantize(colors=128, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    quant.save(OUT, optimize=True)
    print(f"wrote {OUT} ({crop.width}x{crop.height})")


if __name__ == "__main__":
    main()
