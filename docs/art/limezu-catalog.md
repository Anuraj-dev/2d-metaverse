# LimeZu furniture catalog

Source cuts: `frontend/public/assets/furniture/lz_*.png` (102 props), produced by
`frontend/scripts/gen_limezu_sprites.py` from LimeZu *Modern Interiors* free pack.

To look at a prop, render it directly — the PNGs are 16-48 px, so upscale:
`python3 -c "from PIL import Image; im=Image.open('frontend/public/assets/furniture/lz_sofa_2seat.png'); im.resize((im.width*8, im.height*8), Image.NEAREST).save('/tmp/p.png')"`
To see one in place on the map, use `frontend/scripts/render_region.py`.

**Map key** = `f_` + filename stem (BootScene loads `furniture/<stem>.png` as texture
`f_<stem>`). Place with `furn("f_lz_…", tx, ty, solid)`.

**Solid vs decor (guide only):** solid = a person could not walk through it
(sofas, chairs, desks, cabinets, tall plants, appliances, lamps). Decor = wall
art, rugs, windows, small clutter, string lights. Room 3 already treats small
side tables and wall pieces as decor (`solid=False`).

**Orientation:** most large furniture is **front-facing** (viewer looks at the
front face). Side-profile chairs are called out. Desk modules are **partial
desks** (one tile wide) meant to tile or stand alone.

**No games props in this cut.** Arcade cabinets / board tables are a separate
sprite set (`f_arcade_*`, board table art). There is no chess/dice/controller
sprite here — use seating + tables around the existing game interactables.

Crops flagged **⚠** are usable with caveats. Crops in **Do not use** are broken.

---

## Soft seating

| Map key | Size | Kind | Description |
|---|---|---|---|
| `f_lz_sofa` | 48×32 | solid | Brown/tan solid 3-seat couch, front-facing, simple blocky back, short legs. Lounge / hostel. |
| `f_lz_sofa_gray` | 48×32 | solid | Cool gray modern 3-seat, horizontal seat stripes, front-facing. Office lounge. |
| `f_lz_sofa_white` | 48×32 | solid | Light silver/white modern 3-seat, soft seat panels, front-facing. Bright lounge. |
| `f_lz_sofa_tan` | 48×32 | solid | Warm tan/caramel modern 3-seat with segmented cushions, front-facing. Lounge. |
| `f_lz_sofa_2seat` | 32×32 | solid | Compact white/lavender 2-seat loveseat, soft fabric, front-facing. Small rooms. |
| `f_lz_sofa_purple` | 48×32 | solid | Purple upholstered 3-seat with gold border trim, front-facing. Fancy lounge / purple set. |
| `f_lz_loveseat_purple` | 32×32 | solid | Purple 2-seat with gold frame trim, front-facing. Matches purple set. |
| `f_lz_armchair` | 16×32 | solid | Wood lounge armchair, front view: brown backrest + seat, short legs. Classic study. |
| `f_lz_armchair_side` | 16×32 | solid | Same wood lounge chair in **side profile** (faces right). Pair with front for seating rows. |
| `f_lz_armchair_gray` | 32×32 | solid | Wide gray modern armchair (reads almost like a mini 2-seat), horizontal stripes. Modern lounge. |
| `f_lz_armchair_white` | 32×32 | solid | Wide white/silver modern armchair, soft panels. Bright lounge. |
| `f_lz_ottoman` | 16×32 | solid | Gray modern cube ottoman / footstool, front view. Lounge footrest. |
| `f_lz_bench_gold` | 32×32 | solid | Purple upholstered bench with gold top rail and scalloped gold base. Fancy lobby. |
| `f_lz_side_table` | 16×16 | decor | Tiny round honey-wood tabletop (top-down-ish). Beside couch; walkable as decor. |
| `f_lz_side_table_gold` | 16×32 | solid | Purple side table with gold trim and single front drawer. Purple set accent. |
| `f_lz_coffee_table` | 32×16 | solid | Low purple table with gold underside glow / lights. Purple lounge set. |
| `f_lz_console` | 32×16 | solid | Low flat honey-wood console / coffee table, plain top. Neutral lounge. |

## Chairs & stools

| Map key | Size | Kind | Description |
|---|---|---|---|
| `f_lz_chair` | 16×32 | solid | School/office chair, front: tan rectangular back, green legs, gray feet. Classrooms / desks. |
| `f_lz_chair_side` | 16×32 | solid | Light wood chair **side profile** (faces right), stacked seat slats. Dining / cafe. |
| `f_lz_chair_wood` | 16×32 | solid | Redder/orange wood chair **side profile**, same silhouette as `chair_side`. Warmer rooms. |
| `f_lz_stool` | 16×32 | solid | Low stool: tan square seat, green legs, gray feet. Desk overflow seating. |
| `f_lz_stool_wood` | 16×32 | solid | ⚠ **Not a stool** — wooden barrel / keg on a stand with metal bands. Cafe prop / storage, not seating. |
| `f_lz_bar_stool` | 16×32 | solid | Red mushroom-cap bar stool on a thin gold pole. Cafe / bar. |
| `f_lz_lamp` | 16×48 | solid | ⚠ **Misnamed — not a lamp.** Blue dome bar stool on a silver tripod base (taller than `bar_stool`). Use as bar stool only. |

## Desks & office

| Map key | Size | Kind | Description |
|---|---|---|---|
| `f_lz_table` | 16×32 | solid | Plain desk **module**: brown top, green side legs. Tile several for a long desk. |
| `f_lz_table_books` | 16×32 | solid | Desk module with white papers + red/white binder on top. Coworking clutter. |
| `f_lz_table_cup` | 16×32 | solid | Desk module with pen + blue sticky note / cup. Coworking. |
| `f_lz_desk_hat` | 16×32 | solid | Desk module with a brown wide-brim hat resting on top. Characterful hostel/study. |
| `f_lz_desk_green` | 16×32 | solid | Green-top desk, **side/end view** (narrow). Use as desk end-cap or side-on desk. |
| `f_lz_table_green` | 32×32 | solid | Wider green desk/table, front view, brown side panel. Study / office. |
| `f_lz_table_study` | 32×32 | solid | Green study desk with open book + vertical binder on top. Library / study carrel. |
| `f_lz_lectern` | 32×32 | solid | Wide green-top table with open book + thick volume — podium / reading desk. Auditorium or library. |
| `f_lz_computer` | 16×32 | solid | Gray CRT/flat monitor on a white desk unit with mouse. Office desk prop. |
| `f_lz_pc_tower` | 16×32 | solid | White PC tower / mini server rack with dark drive bays. Under-desk tech. |
| `f_lz_filing` | 32×32 | solid | White multi-drawer filing bank (3×4 drawers, colored tabs). Office storage. |
| `f_lz_pinboard` | 32×16 | decor | Cork pinboard strip with sticky notes and a hanging tag. Wall clutter. |
| `f_lz_board` | 32×32 | decor | Dark presentation board / TV-like frame with white diagonal glare. Meeting room wall. |
| `f_lz_chalkboard` | 32×32 | solid/decor | Wall chalkboard with wood frame, chalk tray + eraser. Classroom (usually non-solid wall piece). |
| `f_lz_whiteboard` | 32×32 | solid | Freestanding green board on two white legs with tray (reads more chalkboard than whiteboard). Classroom floor unit. |
| `f_lz_globe` | 16×32 | solid | Blue/green desk globe on gold stand. Study / classroom accent. |
| `f_lz_poster_grid` | 32×32 | decor | Colorful 3×4 grid notice board (calendar/posters). Wall office decor. |
| `f_lz_ac` | 48×32 | decor | White wall air-conditioner unit, horizontal vents. Mount on wall row. |

## Storage & wall

| Map key | Size | Kind | Description |
|---|---|---|---|
| `f_lz_bookshelf` | 32×32 | solid | Warm wood open shelf, books + binders, top rail. Study / lounge wall. |
| `f_lz_shelf_jars` | 32×32 | solid | Same wood shelf form stocked with jars, boxes, checkered item. Kitchen / pantry. |
| `f_lz_bookshelf_tall` | 32×32 | solid | White metal/open shelf, 3 tiers of colorful books. Modern office. |
| `f_lz_shelf_white` | 32×32 | solid | White double-bay bookshelf with books. Office / hostel. |
| `f_lz_lockers` | 32×32 | solid | Twin wood cubby/lockers; right door open with blue item inside. Corridor / gym. |
| `f_lz_wardrobe` | 32×48 | solid | Tall honey-wood double-door wardrobe. Bedroom / hostel. |
| `f_lz_wardrobe_glass` | 32×32 | solid | Shorter wood wardrobe with two tall glass mirror panels. Bedroom. |
| `f_lz_cabinet` | 32×48 | solid | Tall ornate wood cabinet; **broom + dustpan glued on the right edge**. Storage room / kitchen. |
| `f_lz_cabinet_glass` | 32×48 | solid | Tall wood display cabinet with glass doors + clutter; **broom + mop on both sides**. Utility / kitchen. |
| `f_lz_cabinet_purple` | 32×32 | solid | Short purple cabinet with gold handles and gold top rail. Purple set storage. |
| `f_lz_sideboard` | 32×32 | solid | Low wood sideboard, two drawers, checkered top. Lounge / dining. |
| `f_lz_vanity` | 32×48 | solid | Dressing table with centered mirror and side curves. Hostel / bedroom. |
| `f_lz_nightstand` | 16×16 | solid | Tiny 2-drawer honey nightstand (1 stray gray pixel on right edge — minor). Beside bed. |
| `f_lz_crate` | 32×16 | solid | Closed wooden crate with rope/tape detail, low profile. Storage / backroom. |
| `f_lz_boxes` | 32×16 | solid | Two cardboard boxes (one open, one closed). Moving clutter. |
| `f_lz_chest` | 32×16 | solid | Low storage chest / trunk, brown lid over dark blue body with gold clasp. Bedroom / loot prop. |
| `f_lz_worldmap` | 32×32 | decor | Framed world map, green continents on blue ocean. Classroom / travel wall. |
| `f_lz_window` | 32×32 | decor | Wood-frame double window with center latch, blue glass. Wall window. |
| `f_lz_window_curtains` | 48×32 | decor | Window with beige drapes tied back, gold holdbacks. Fancy room window. |
| `f_lz_window_wood` | 32×32 | decor | Red-brown 4-pane wood window. Cabin / warm interiors. |
| `f_lz_window_blinds` | 32×32 | decor | Gray horizontal blinds (two panels). Office window. |
| `f_lz_mirror` | 16×32 | decor | Vertical wall mirror, wood frame, blue glass. Bathroom / bedroom wall. |
| `f_lz_mirror_floor` | 16×48 | solid | Freestanding full-length wood mirror on a base. Dressing corner. |
| `f_lz_painting` | 32×32 | decor | Framed seascape (blue waves / sky). Neutral wall art. |
| `f_lz_painting2` | 32×32 | decor | Framed portrait/people scene (figure + blue field). Wall art. |
| `f_lz_tv` | 32×32 | decor | Wall TV / monitor showing a red circular scene on blue. Lounge wall. |
| `f_lz_art_small` | 16×16 | decor | Tiny landscape frame (blue field, wood border). Sparse; only for dense clutter walls. |
| `f_lz_art_flame` | 16×16 | decor | Tiny frame with orange/yellow fleck (barely readable as flame). Weak; prefer larger art. |

## Kitchen & cafe

| Map key | Size | Kind | Description |
|---|---|---|---|
| `f_lz_counter` | 48×32 | solid | 3-bay kitchen counter run: left bay has oven window, middle/right drawers, warm wood tops. Cafe / kitchen back wall. |
| `f_lz_fridge` | 16×32 | solid | Tall cool blue refrigerator / cooler, single door. Kitchen. |
| `f_lz_mini_fridge` | 16×32 | solid | ⚠ **Not a fridge** — red wood stove / heater with glass door and chimney cap. Kitchen appliance look, use as stove. |
| `f_lz_kiosk` | 32×32 | solid | Small market stall / service counter with striped awning and two display panes. Cafe service. |
| `f_lz_display_cab` | 32×32 | solid | Glass-front wood display cabinet; **pair of white slippers under it**. Shop / cafe. |
| `f_lz_drawer_row` | 32×16 | solid | Low wood 2-drawer run. Under-counter storage. |
| `f_lz_fruit_bowl` | 16×32 | decor | Bowl of citrus + green fruit on a stand. Cafe table clutter. |
| `f_lz_table_food` | 32×16 | solid | Tabletop with cake/dessert + napkin. Cafe surface (no legs — place on floor as low table or on counter). |
| `f_lz_table_cafe` | 32×16 | solid | Tabletop with silver lamp + two books. Cafe surface (same low crop style). |
| `f_lz_shop_shelf` | 32×48 | solid | Tall stocked grocery/shop shelf (green/purple packages). Shop / pantry. |
| `f_lz_vending_shelf` | 32×32 | solid | Shorter stocked shelf, colorful top row + green/blue products. Cafe / shop. |
| `f_lz_basket` | 16×32 | solid | Round brown woven basket. Market / clutter. |
| `f_lz_basket_lid` | 16×32 | solid | Green lidded basket / bin with white lid. Kitchen / laundry. |

## Auditorium / stage-adjacent

| Map key | Size | Kind | Description |
|---|---|---|---|
| `f_lz_fireplace` | 32×48 | solid | Stone/brick fireplace with lit orange fire, dark chimney stack. Lounge hall / stage-side hearth. |
| `f_lz_lectern` | 32×32 | solid | *(Also listed under desks.)* Wide reading table / podium with open book — stage or library front. |
| `f_lz_whiteboard` | 32×32 | solid | *(Also desks.)* Freestanding board on legs — good at room front. |
| `f_lz_chalkboard` | 32×32 | decor | *(Also desks.)* Wall chalkboard for classroom/auditorium walls. |

## Greenery, lamps & clutter

| Map key | Size | Kind | Description |
|---|---|---|---|
| `f_lz_plant` | 32×48 | solid | Large leafy round tree in brown square planter. Corners, lobby. |
| `f_lz_plant_small` | 16×32 | solid | Medium bushy green plant in terracotta pot. Room corners. |
| `f_lz_palm` | 32×32 | solid | Potted palm, fronds + brown planter. Tropical accent. |
| `f_lz_plant_pot` | 16×32 | decor | ⚠ Tiny grass tuft with yellow pot base — mostly empty upper space. Weak; only as floor micro-clutter. |
| `f_lz_floor_lamp` | 16×48 | solid | Beige conical shade floor lamp on wood pole + round base. Living room. |
| `f_lz_floor_lamp_blue` | 16×48 | solid | Blue dome shade on wood tripod base (reads close to a tall stool/lamp hybrid). Modern lounge. |
| `f_lz_string_lights` | 32×16 | decor | White fairy-light string, sagging garland. Wall/ceiling decor only. |
| `f_lz_books` | 16×16 | decor | Small stack: one upright brown book + stacked books. Desk clutter. |
| `f_lz_books2` | 16×16 | decor | Alternate book stack (beige/gray tones). Desk clutter. |
| `f_lz_papers` | 32×32 | decor | Messy desk pile: white papers, blue folder, green book, sticky notes. Floor/desk clutter (irregular silhouette OK). |
| `f_lz_bin` | 16×32 | solid | Crumpled brown paper bag / soft trash bag (not a hard bin). Soft waste prop. |
| `f_lz_rug_red` | 64×32 | decor | Large red/gold concentric-border rug (widest rug). Lounge centrepiece — keep walkable, `solid=False`. |
| `f_lz_rug_beige` | 48×32 | decor | Beige rug with green Greek-key border. Neutral rooms. |
| `f_lz_rug_blue` | 32×32 | decor | Small blue rug with gold rectangular border. Accent. |
| `f_lz_rug_olive` | 32×32 | decor | Olive/sage square rug with nested borders. Quiet rooms. |
| `f_lz_rug_green` | 32×32 | — | **Do not use** — see below. |

## Games

No arcade, board, or game-controller sprites in this LimeZu cut. Seat players on soft
seating / stools around the existing `f_arcade_*` cabinets and board-table seats; do not
hunt for a game prop here.

---

## Do not use

These crops failed visual QA (sheet bleed, dual sprites, or unusable). Prefer the
alternatives listed.

| Map key | Size | Problem | Prefer instead |
|---|---|---|---|
| `f_lz_rug_green` | 32×32 | Crop includes the green/gold rug **plus a detached gold bar** in the bottom half (gap of empty rows — neighbour-tile bleed). | `f_lz_rug_blue`, `f_lz_rug_olive`, or `f_lz_rug_beige` |
| `f_lz_table_lamp` | 16×32 | Dual crop: blue table lamp floating in the top half **and** a separate beige dual-knob radio in the bottom half, with a large transparent gap. Not a clean lamp. | `f_lz_floor_lamp` or `f_lz_floor_lamp_blue` |
| `f_lz_table_lamp_beige` | 16×32 | Same dual-sprite failure as above (beige/wood lamp base + same radio below). | `f_lz_floor_lamp` |

## Caveats worth remembering (usable, but honest)

| Map key | Note |
|---|---|
| `f_lz_lamp` | Name is a legacy lie — blue tripod **bar stool**, not lighting. Room 3 already places it as a stool. |
| `f_lz_mini_fridge` | Red wood **stove/heater**, not a mini-fridge. Use `f_lz_fridge` for cold storage. |
| `f_lz_stool_wood` | **Barrel/keg**, not a seat. |
| `f_lz_cabinet` / `f_lz_cabinet_glass` | Cleaning tools baked into the crop (broom/mop) — fine for utility, odd in a clean lobby. |
| `f_lz_display_cab` | White slippers under the cabinet are part of the art. |
| `f_lz_table_food` / `f_lz_table_cafe` | Surface-only crops (no full legs) — read as low tables or counter tops. |
| `f_lz_art_small` / `f_lz_art_flame` / `f_lz_plant_pot` | Very low visual weight at game scale; use sparingly. |
| `f_lz_whiteboard` | Green writing surface on legs — functions as freestanding chalkboard more than a dry-erase board. |

## Quick room kits (suggested palettes)

- **Neutral hostel lounge:** `sofa` + `side_table` + `bookshelf` + `plant` / `palm` + `window` + `board` / `worldmap`
- **Modern gray office:** `sofa_gray` + `armchair_gray` + `filing` + `computer` + `pinboard` + `window_blinds` + `ac`
- **Purple fancy set:** `sofa_purple` + `loveseat_purple` + `bench_gold` + `coffee_table` + `side_table_gold` + `cabinet_purple`
- **Cafe:** `counter` + `fridge` + `bar_stool` / `lamp`(stool) + `table_cafe` + `fruit_bowl` + `vending_shelf` + `basket`
- **Classroom:** `chair` + `table` modules + `chalkboard` / `whiteboard` + `globe` + `poster_grid` + `bookshelf_tall`
- **Kitchen service:** `counter` + `mini_fridge`(stove) + `drawer_row` + `cabinet_glass` + `shelf_jars`

---

*Catalog authored by G0-A2 after reading the full contact sheet. 99 props recommended for placement; 3 in Do not use. Regenerate crops via `python3 frontend/scripts/gen_limezu_sprites.py` only if coordinates change — this file must stay in sync.*
