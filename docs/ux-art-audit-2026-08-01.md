# hyprverse — UI / art / feel audit

> Hands-on playthrough of the running world (mock backend, `frontend` dev server, 1440×900 Chrome).
> Date: 2026-08-01. Author: Claude (browser session). **This is a verdict + evidence document, not a plan.**
> Planning happens after Raja reads this.

---

## 1. The verdict in one paragraph

**The engineering is well ahead of the art.** Everything works — movement, chat, proximity roster,
fullscreen map, two arcade games, a server-authoritative Connect-4 with a practice bot, settings,
minimap. That is a lot of working product. But **the world does not feel like a place.** It feels
like a large, correct, empty test level. The single dominant problem is not sprite *quality* —
the Pipoya-family art is fine — it is **density**: 174 furniture objects spread over 12,982
walkable tiles, 45% of them the same chair sprite, with 96% of the map surface bare tile. The
second problem is that the app speaks **five different visual languages** at once (pixel world,
dark modern HUD, Material-white dialogs, vector-cartoon Flappy, graph-paper Snake), so it never
reads as one product.

**How much better can it get? A lot — and mostly without buying anything.** My estimate:

| Area | Now | Realistic ceiling | Effort to get there |
| --- | --- | --- | --- |
| Outdoor world (plaza, grass, trees) | 6.5 / 10 | 8.5 | Low — variation + props |
| Interiors (hostels, stage, arcade) | **2.5 / 10** | 8 | Medium — needs new tiles + a real pass |
| Character & avatar feel | 5 / 10 | 8 | Medium — shadows, sit poses, name plates |
| HUD / chrome | 5.5 / 10 | 8.5 | Low — it's CSS, not art |
| Arcade + board games | 6 / 10 | 8 | Low-medium — mostly restyling |
| Onboarding / affordances | 4 / 10 | 8 | Low |
| **Cohesion across all of it** | **3 / 10** | 9 | Low — a decision, then discipline |

The cheapest large win is **cohesion + density**, not new sprites. New sprites are the *second*
lever, and I do have a specific recommendation for that (§6).

---

## 2. How I tested

Played it as a player, not as a reviewer reading code first:

- Landed on the marketing page, picked a character, entered as `Critic`.
- Walked the plaza, both hostels, the Game Arcade, approached the Stage auditorium.
- Opened the Controls modal (`?`), the fullscreen map (`M`), Settings, the roster, the "Around" panel.
- Played **Flappy** (start → flap → alive) and **Snake** (difficulty → play → game over).
- Sat at a **Connect 4** board table, accepted the match, played a move against the Practice Bot.
- Sent a chat message and got a reply from a mock player.
- Then, and only then, cross-checked what I saw against `campus.json`, `gen_campus.py`,
  the tileset PNGs and `shared/src/constants.ts` to turn impressions into numbers.

Everything below that says "measured" is a number pulled from the actual map/asset files.

---

## 3. What is genuinely good — don't break these

Being honest about the strengths, because several of them are better than they look:

1. **The landing page is the best-looking screen in the product.** A live world render behind the
   hero, a character picker with real sprites, clear one-line pitch. It sets an expectation the
   world then fails to meet — which is itself the problem, but the page is good.
2. **The exterior tileset work is real.** Grass has 6 variation tiles + flower scatter, stone/grass
   boundaries use proper edge-trim tiles with corners, trees split canopy/trunk/shadow across three
   layers for correct depth. Someone did this carefully.
3. **The fullscreen map (`M`) is a genuinely good feature** — rooms labelled, live player dots,
   roster beside it, `You (you)` highlighted. Most projects this size don't have one.
4. **Board tables are excellent product thinking.** Two-player, server-authoritative, spectatable,
   *with a practice bot so a lone player isn't stuck waiting*. That bot is a really good call.
5. **The interaction prompt exists and is correct** ("Press E to play: Snake", "Press E to leave") —
   it's the *placement* that's wrong, not the presence.
6. **Movement feels right.** 120 px/s walk, 1.6× run, diagonals clamped so they aren't faster.
   No complaints.
7. **Chat with proximity bubbles + a log** works, and the bubble sits correctly above the head.

---

## 4. Findings, ranked

### 🔴 P0 — the things that decide whether this feels like a world

#### F1. The world is empty. This is the whole problem, measured.

| Metric | Value |
| --- | --- |
| Map size | 120 × 118 tiles (14,160) |
| Walkable (no wall) tiles | **12,982** |
| Furniture objects placed | **174** |
| → of which are one sprite (`f_chair`) | **78 (45%)** |
| Distinct furniture sprites in existence | **19** |
| Sprites used ≤ 2 times | 8 of 19 |
| `ground_decor` coverage (flowers, sprigs) | **305 tiles = 2.2%** |
| `decor_above` coverage (tree canopies) | 212 tiles = 1.5% |

**One prop per ~75 walkable tiles.** Standing anywhere indoors, you can see 300+ tiles of identical
floor. The Stage is 40 copies of the *same chair* in a perfect 8×5 grid with no stage, no screen,
no aisle, no lighting. Mandakini Hostel is a hostel with **no beds** — just office desks repeated
on a grid. Cauvery Hostel had exactly one desk visible in a hall the size of a supermarket.

*Can it be better?* Yes, dramatically, and this is the highest-leverage fix in the document.

#### F2. There is no interior art. The interior tileset is 6 KB.

Measured tileset inventory:

| File | Tiles | Used by `campus.json`? |
| --- | --- | --- |
| `exterior.png` | 2,112 | ✅ yes |
| `floors_walls.png` | **162** | ✅ yes |
| `furniture.png` | 234 | ❌ **never used** |
| `doors_windows.png` | 180 | ❌ **never used** |
| `small_items.png` | 64 | ❌ **never used** |

`campus.json` loads exactly two tilesets. **478 tiles of interior/door/window/prop art already ship
in the repo and are referenced by nothing.** That is why outdoors looks 6.5/10 and indoors looks
2.5/10 — the exterior has 2,112 tiles to draw from, the interior has 162.

Consequences you can see without knowing any of that:
- Interior floor is one flat tan plank tile edge to edge. No rugs, tiles, thresholds, zones.
- Walls are a 1–2 tile brick band with **no roof, no cornice, no baseboard, no windows**.
- Doors are an *unmarked lighter patch* in the wall. There is one `door1.png` in the whole repo,
  used only on private rooms. Finding the exit of the arcade means walking the wall hunting a gap.

#### F3. Five visual languages in one product

| Surface | Language |
| --- | --- |
| World | 16px pixel art, Pipoya family |
| HUD (chat, control bar, roster, map) | Dark modern glass, anti-aliased sans |
| Chat log | **IRC monospace**, `<You>` / `<Aanya>` angle brackets, yellow/blue |
| Room labels in world | 40px anti-aliased white sans with drop shadow, floating in mid-air |
| Player name tags | Yellow **pixel** font with black outline (RPG-Maker default look) |
| Flappy | Smooth vector cartoon, gradient sky, soft shadows |
| Snake | White graph-paper board, Material-blue difficulty buttons, green/white game-over card |
| Settings | **Raw unstyled browser controls** (see F6) |

Nothing here is individually terrible. Together they read as five projects glued together. Room
labels and player name tags disagree *with each other* while sitting 100px apart on screen.

#### F4. The "grass clearing" patches render as flat green placeholder boxes

`gen_campus.py` places 12 hand-listed 2×2 "grass clearings set into the plaza" using only the four
corner-trim tiles `CLR_NW/NE/SW/SE`. A 2×2 made entirely of *corner* tiles has no interior fill and
no decoration on it — so every one of them renders as **a flat, untextured, saturated green square
with a grey outline**, sitting in a desaturated stone plaza. They are the first thing your eye lands
on, they appear on the landing page, and they read unambiguously as "missing sprite."

#### F5. The "olive checkered rug" is a solid block — measured

`FLOOR_MOSS = 39` is commented as *"olive checkered floor — meeting-room carpet"*. Pixel-level check
of `floors_walls.png` tile index 38:

```
colors: [(219 px, RGB 125,104,18), (37 px, RGB 129,108,23)]
```

**Two colours, 4–5 RGB steps apart.** The checker is invisible at any zoom. So every "rug" and
"runner" in the game — the arcade cabinet runner, the arcade centre rug, the meeting-room carpets —
renders as a **solid flat olive rectangle**. In the arcade these are the two largest objects in the
room and they look like untextured collision boxes.

---

### 🟠 P1 — things that actively hurt the feel

#### F6. Settings is unstyled browser chrome

The panel is dark, and inside it: default Chrome blue `<input type=range>` sliders, **default white
square checkboxes**, and a **raw native `<select>`** for "Reduce motion" complete with the Chrome
chevron. Four white OS widgets on a dark panel. There are no sections, no slider value readouts, no
close button, and "Desktop alerts" wraps to two lines. This is the single most obviously
unfinished-looking screen in the app.

#### F7. Characters don't touch the ground, and don't sit

- **No character shadow.** Trees have heavy opaque elliptical shadows; players have none, so avatars
  float on top of the floor instead of standing on it.
- **No occlusion.** Walk onto a wall tile and the avatar draws *over* the brick. Walls have no height.
- **Sitting is invisible.** I sat at the Connect 4 table — the panel opened, the match ran, "Press E
  to leave" appeared, and my avatar **stayed standing, facing forward, not on a chair.** From the
  outside there is no way to tell anyone is playing.
- **Board tables have only one chair sprite for two seats**, so half the seats are bare floor.
- The **back-facing sprite is illegible** at this zoom — a grey blob of hair over a grey body.

#### F8. Board tables don't look like board tables

The Connect 4 / Tic-Tac-Toe tables are a plain navy desk sprite. **No board is drawn on them.**
Nothing distinguishes the Connect-4 table from the Tic-Tac-Toe table from a desk. The only way to
discover them is to walk over the right tile and read a prompt at the bottom of the screen.

#### F9. Arcade cabinets are 24×40 px and interchangeable

Both cabinets are the same dark-navy box with 2–3 coloured bars for a screen. No marquee art, no
per-game identity, no glow, no shadow, no base. **The vending machine next to them has more detail
than either cabinet.** Meanwhile the actual games behind them are fully-featured.

#### F10. Interaction zones are invisible, offset, and have dead gaps

Arcade zones are 32×64 world px, placed at `(1136,1536)` and `(1216,1536)` — leaving a **48px dead
gap between two cabinets that are only 80px apart**. I visually overlapped the Snake cabinet three
separate times with no prompt before finding the live tile. The zone doesn't line up with the sprite,
and there's no floor decal, glow, or hover state marking it.

#### F11. Overlays fight each other

- The **control bar renders on top of the fullscreen map**, cutting a horizontal band through the
  bottom of the campus and covering Mandakini Hostel / Game Arcade. (`STATE.md` documents the
  ControlBar being mounted last on purpose for meetings — it needs a map exception.)
- The **board-table panel completely covers the minimap** and runs to the viewport edge.
- Room labels are world-anchored 40px text with **no viewport clamping** — I watched
  "Cauvery Hostel" get cut to "…ery Hostel" and collide with the connection pill.

#### F12. The "Around" panel never resolves

Top-left, occupying prime real estate, `Finding who's around…` was still showing **after 20+ minutes**
with 4 players connected and an active chat exchange. Meanwhile the top-right roster pill correctly
lists You / Aanya / Mei / Rohan. Two competing "who's here" widgets, one of them apparently dead
(at least in mock mode). The Controls modal points you at the *top-right* one — so the broken one
isn't even the documented one.

---

### 🟡 P2 — polish, but cheap polish

- **F13.** The load-in state is ugly and visible: for a second or two you get bare tiles, no props,
  no trees, and wayfinding labels floating over emptiness. First impression of the world is its
  worst frame. No loading screen or fade-in.
- **F14.** "TAP TO START" on Flappy — **clicking the canvas does nothing.** It's Space-only, and it
  says "tap".
- **F15.** Flappy is titled **"FLAPPY BIRD"** verbatim, with Mario-green pipes. That's a trademarked
  name on a shipped screen. Rename it (`Hyprbird`, `Flap`) — costs nothing now, costs more later.
- **F16.** Snake's board is a **white rectangle in a dark shell** — eye-searing, and the 3-segment
  snake occupies <0.1% of a huge board. It reads as a spreadsheet, not an arcade cabinet.
- **F17.** Score is drawn twice on both games — big outlined number on the canvas *and* in the
  header row.
- **F18.** The arcade side panel is ~85% empty dark space below the leaderboard card.
- **F19.** Snake's difficulty picker (Easy/Normal/Hard) gives no idea what the difference is.
- **F20.** Minimap labels overflow their box and collide — "Mandakini Hostel" runs off the left edge
  and overlaps "Game Arcade"; "Cauvery Hostel" is clipped at the top. No legend, no player facing.
- **F21.** The Controls modal is **anchored to the top-left corner**, not centred, and renders keys
  as plain text rather than keycap chips.
- **F22.** Chat panel is ~350×250 of mostly-empty black, always open, permanently occupying the
  bottom-left quarter.
- **F23.** A potted plant sits in the middle of an open lawn. Two armchairs face each other in the
  arcade with nothing between them. Desk chairs are maroon in a stated "cool office palette".
- **F24.** Each desk has a small dashed 5-dot artifact underneath it that reads as a rendering bug.
- **F25.** I was **completely unable to move south** from the Cauvery Hostel threshold for four
  consecutive attempts across all input paths; `a` (west) worked immediately from the same tile.
  I could not reproduce it elsewhere, so I'm flagging it rather than diagnosing it — but a player
  hitting that would think the game froze.

---

### ⚪ Design question, not a bug

**F26.** `roomBounds` exists for only **6 small private rooms (607 tiles)**. The four big halls —
Cauvery, Mandakini, the Stage auditorium, the Game Arcade — have **no `roomBounds` rect**. Per the
audio-zone rule in `AGENTS.md` (zone = `roomBounds`, everything else = `OUTDOOR_ZONE`), that means
**a 40-seat auditorium is in the same voice zone as the plaza outside it.** Someone talking on the
lawn is audible to someone sitting in the Stage. That may be deliberate ("halls are public"), but
it's worth an explicit decision rather than an accident of map authoring.

---

## 5. Root cause — why it looks this way

Almost every P0/P1 finding traces to **two** upstream facts:

1. **The prop library is 20 sprites and 162 interior tiles.** You cannot furnish a 14,160-tile campus
   from that. The generator did the best it could: it repeated `f_chair` 78 times. The emptiness is
   not laziness in map authoring — it's an inventory problem.
2. **Nobody owns "how hyprverse looks."** Each feature landed with the styling that was fastest for
   that feature — hence five languages. There's no token set, no shared panel/button/dialog, no rule
   about pixel vs. anti-aliased type.

Fix those two and roughly 18 of the 26 findings dissolve. That's the good news: this is not
26 separate problems.

---

## 6. The art question: buy, or draw it myself?

**Recommendation: buy. Do not hand-draw a tileset.**

Reasoning: you need *hundreds* of interior tiles in a consistent style. That's 100–200 hours of
pixel art, it's not where your leverage is, and there is a pack that is almost exactly this project's
use case for the price of a coffee. I'd only hand-draw the ~5 hero props that carry identity
(arcade marquees, the two board tables, room signage) — and even those are better as recolours of
purchased tiles.

### First choice — and it's not close

**[Modern Interiors — RPG Tileset (16×16), by LimeZu](https://limezu.itch.io/moderninteriors)**

- **Why this one:** it is *the* asset pack behind the Gather-Town-like genre. Thousands of interior
  tiles across classrooms, libraries, gyms, offices, bedrooms, shops, restaurants — i.e. exactly the
  rooms hyprverse has and can't furnish. 100+ animated objects. Modular wall / floor / carpet tiles,
  which is precisely what F2 and F5 are missing.
- **Sizes:** ships 16×16, 32×32 *and* 48×48. **Your map is 16px tiles → take the 16×16 set.** Drop-in.
- **Characters:** includes a character generator (200 hairstyles, 80 accessories, idle/run/lift/throw
  animations) at 32×32 — the same size as your current Pipoya sprites. This is a credible path off
  Pipoya later *without* a re-theme, and it would fix F7's illegible back-facing sprite.
- **Price:** free version has basics; **full pack is $1.50+** (~₹130), 149 MB.
- **License:** commercial use allowed, editing allowed, **credit to LimeZu required**, reselling
  prohibited. That fits `ATTRIBUTIONS.md` cleanly — one row, one link.
- **What to actually download:** the paid `Modern_Interiors_v#` archive → use the `16x16` folder.
  Before buying, **check the theme list on the page for a gaming/arcade room** — if it's there you
  get F9 (real cabinets) for free too.

### Second — only if you also want the campus exterior lifted

**[Modern Exteriors — RPG Tileset (16×16), by LimeZu](https://limezu.itch.io/modernexteriors)**
— $2.50 (50% off $5.00), same license, same three sizes. Streets, buildings, roofs, animated
vehicles, city props. **Lower priority:** your exterior is already the good half. Buy this only when
you want roofs and real building facades (which would fix "buildings are roofless brown rectangles").

### Third — for the HUD, if you decide to go pixel-native

**[Modern User Interface — RPG asset pack (16×16), by LimeZu](https://limezu.itch.io/modernuserinterface)**
— $3.90 (35% off $6.00), same license. Window frames, **42 buttons with states**, sliders, dialogue
boxes, portrait generator.

⚠️ **Buy this only after you answer the cohesion question** (§8, Q1). If you decide the HUD stays
modern-glass and only the *world* is pixel, this pack is wrong for you and F6 is a pure CSS job. Same
author as the other two, so if you do go pixel-HUD, the three packs match perfectly — which is the
real argument for standardising on LimeZu across the board.

### Zero-cost fallback (if you want to spend ₹0)

- **[Kenney — Roguelike Modern City](https://kenney.nl/assets/roguelike-modern-city)** — 1,036 assets,
  **CC0** (no attribution required at all).
- **[Kenney — Roguelike/RPG pack](https://kenney.nl/assets/roguelike-rpg-pack)** — 1,700 assets, CC0.
- **[Anokolisa — Free Topdown Tileset 16×16](https://anokolisa.itch.io/free-pixel-art-asset-pack-topdown-tileset-rpg-16x16-sprites)** — free, 16×16.

Honest caveat: **Kenney's style will not blend with Pipoya.** It's cleaner, flatter, more saturated.
Per `AGENTS.md` ("reject a style-mismatched asset rather than blending it"), using Kenney means
committing to re-skinning the *whole* world in Kenney, not mixing. LimeZu at ₹130 is the better deal;
Kenney is the answer only if the constraint is strictly zero spend.

### What I'd draw by hand (or generate) instead of buying

1. **Two arcade cabinet marquees** — a Snake cabinet and a Flappy cabinet that look different from
   each other. ~1 hour, fixes F9. Extend `scripts/gen_arcade_sprites.py`.
2. **Two board-table tops** — a 3×3 grid and a 7×6 grid painted onto the table sprite. Fixes F8
   outright and it's ~20 lines of Python in `gen_campus.py`'s sprite pass.
3. **Room signage** — a hanging sign prop per room, so labels stop being 40px floating text (F3, F11).
4. **A proper grass-clearing tile** — one interior fill tile so F4's twelve green boxes get a texture.
5. **A character drop shadow** — a 16×6 soft ellipse. Fixes F7's floating avatars for every character
   at once.

**Do not download anything yet.** Confirm the direction in §8 first — Q1 changes whether you need one
pack or three.

---

## 7. What I'd do, in order

Not a plan you've approved — this is my recommended sequencing, cheapest-first.

**Tier 0 — free, no new assets, biggest visible delta per hour**
1. Fix F5 (rug tile is a flat block) and F4 (green placeholder squares) — both are tile-index bugs.
2. Give every character a drop shadow, and a sit pose when seated (F7).
3. Clamp room labels to the viewport; put the control bar *under* the map; move the board panel off
   the minimap (F11).
4. Move the "Press E" prompt from the screen bottom to just above the object (F10), and add a floor
   decal or pulse on interactable tiles.
5. Restyle Settings — kill the four native browser widgets (F6).
6. Pick one type system: chat log, name tags and room labels must stop disagreeing (F3).
7. Rename "FLAPPY BIRD" (F15). Make "TAP TO START" respond to a tap (F14).
8. Fix or delete the "Around" panel (F12).

**Tier 1 — buy Modern Interiors, do one furnishing pass**
9. Wire `furniture.png` / `doors_windows.png` / `small_items.png` into the map — **478 tiles you
   already own and don't use** (F2). This may be most of the fix on its own.
10. Re-author the four halls: beds in the hostels, a stage + screen + aisles in the auditorium,
    posters/neon/counter in the arcade. Target ~1 prop per 12 walkable tiles indoors, not 1 per 75.
11. Real doorways with frames, mats and thresholds, instead of gaps in a brick line.

**Tier 2 — identity**
12. Arcade cabinet marquees, board-game table tops, room signage props.
13. Decide the HUD question and, if pixel, buy Modern UI and restyle the chrome as one system.
14. Re-skin Snake and Flappy into one arcade-native look so all five languages collapse into two
    (world + chrome) or one.

---

## 8. Open questions I need answered before planning

**Q1 — Is the HUD pixel or modern?** This is the fork everything else hangs off. Two coherent answers:
- **(a) Pixel-native**: buy Modern UI, pixel fonts everywhere, chat log in a pixel frame. Very
  charming, more work, harder to keep readable at small sizes.
- **(b) Clean split**: world is pixel, *all* chrome is modern-glass — but then the chat log's IRC
  monospace and the yellow pixel name tags both have to go. This is the cheaper, safer answer and
  it's what most of the HUD already is.

I'd pick **(b)**. But it's your call, and it decides whether you buy one pack or three.

**Q2 — Are the four big halls supposed to be private voice zones?** (F26.) Adding four `roomBounds`
rects makes the Stage aurally private. One-line change, real gameplay consequence.

**Q3 — ₹130 for Modern Interiors: yes or no?** Everything in Tier 1 depends on it. The zero-cost path
exists but means committing to a full Kenney re-skin, which is more work, not less.

**Q4 — Is the campus layout itself up for revision?** Right now it's four enormous rectangular halls
around one big plaza. Even perfectly furnished, a 35×25 rectangle is a hard room to make cosy.
Smaller, more numerous, more irregular rooms would carry the art far better. **Say the word and this
becomes a map-design question, not just an art question** — I've deliberately not assumed that.

---

## 9. Not covered

Being explicit about the gaps in this audit:

- **Stage interior** — I saw the seating grid clearly from the corridor but got wall-blocked before
  entering. Not assessed from inside.
- **Private meeting rooms** — saw one from outside (round table, 8 chairs, olive rug, a proper door
  sprite). Never entered one, never triggered the meeting countdown or the portal transition.
- **Screen-share, video, LiveKit voice** — untested; mock backend, no real media.
- **Tic-Tac-Toe** — untested (played Connect 4 only).
- **Audio** — **not evaluated at all.** No sound in this session. The whole `soundMixer` /
  day-night-ambience layer is unjudged, and it may be carrying more of the "feel" than I can see.
- **Mobile / small viewports, and real-network latency** — untested.
- **Day/night tint** — I saw a dark frame early on but it turned out to be a partial load, not the
  tint. Unassessed.

---

**Sources for §6:**
[Modern Interiors — LimeZu](https://limezu.itch.io/moderninteriors) ·
[Modern Exteriors — LimeZu](https://limezu.itch.io/modernexteriors) ·
[Modern User Interface — LimeZu](https://limezu.itch.io/modernuserinterface) ·
[Kenney — Roguelike Modern City](https://kenney.nl/assets/roguelike-modern-city) ·
[Kenney — Roguelike/RPG pack](https://kenney.nl/assets/roguelike-rpg-pack) ·
[Anokolisa — Free Topdown Tileset 16×16](https://anokolisa.itch.io/free-pixel-art-asset-pack-topdown-tileset-rpg-16x16-sprites)

---

# Appendix A — Audit of the existing `Assets/` library (2026-08-01)

Raja pointed at the untracked repo-root `Assets/` folder (223 MB, 22 archives) and asked:
*is what I already have enough to make it beautiful, smooth and alive?*

Every archive was listed, the relevant sheets extracted and measured, and every tilesheet
viewed. This appendix supersedes §7 (the buy-recommendation) of the main report.

## A.1 Headline

**Yes for "beautiful" — and the single biggest win needs no new asset at all, because
the best interior pack in the folder is already shipped in the repo and only ~4 % of it is used.**
"Alive" is half-covered. "Smooth" is not covered at all — none of these findings are asset problems.

## A.2 Inventory

| Archive | Size | What it actually is | Verdict |
| --- | --- | --- | --- |
| `Top-Down_Retro_Interior.zip` | 60 K | 6 sheets, 16 px: floors/walls (162 t), furniture (234 t), small items (64 t), doors/windows (180 t), **`FurnitureState2` (234 t)**, `FloorsAndWalls_OpenDoors` (24 t) | **Already shipped, barely used.** md5-identical to `frontend/public/assets/tilesets/*`. 2 of the 6 sheets were never even copied into the repo. |
| `Office-Furniture-Pixel-Art.zip` | 38 K | 43 discrete props, 16/32 px, cool desaturated palette | **Already partly shipped** (19 of 43 cut out). 24 props unused, same palette. ⚠ **no license file in the zip.** |
| `New Assets/Modern_Interiors_Free_v2.2.zip` | 1.1 M | LimeZu free tier: `Interiors_free_16x16` **1 424 tiles**, `Room_Builder_free_16x16` **391 tiles**, 4 characters (Adam/Alex/Amelia/Bob) with idle-anim / run / **sit ×3** / phone | Best art in the folder. **⚠ LICENCE BLOCKER — see A.4.** |
| `New Assets/Serene_Village_revamped_v1.9.zip` | 637 K | 855-tile rural village: red-roof cottages, stone bridges, wooden fences, forest, animated campfire/door/water | **Wrong theme** (fantasy village ≠ modern campus). Trees / bushes / flower beds / rocks / hedgerows are salvageable for outdoor greenery; the buildings are not. |
| `Pipoya RPG Tileset 32x32.zip` | 6.3 M | Source of the shipped `exterior.png` | In use. Animated water/waterfall/flowers variants unused. |
| `PIPOYA FREE RPG Character Sprites 32x32.zip` | 1.4 M | 380+ character sheets incl. **Japanese school uniforms ×4 + teachers** | In use (char5–char12). The school-uniform set is a perfect, untapped fit for a student campus. |
| `Pipoya Character Sprite 32 Generator` + `CharaMEL` | 24 M | CharacterManaJ layered generator for the exact Pipoya style | **Unlimited on-style student avatars, free.** Not exploited. |
| `Cozy Game Sound Pack 1.zip` | 176 M | 10 tracks × stems: *Full / Loop with-drums / without-drums / drums-only* (`.opus`) | Already mined for SFX (`gen_audio.py`). **The stems are the unexploited part — see A.5.** |
| `New Assets/DSArcadePack01.zip` | 23 M | **Unity 3D** — FBX meshes, prefabs, materials, PSDs | **Useless.** 3D assets for a 2D pixel game. 23 MB of dead weight. |
| `Unorganized Parts.zip` (`addwork.png`) | 262 K | RPG-Maker MV painterly 32/48 px: gravestones, ruins, medieval bridges | Wrong theme *and* wrong resolution/style. Discard. |
| `Pack_AH_16x16`, `Pack_AH_RMMV/RMVXAce` | 335 K | Tiny fantasy inn/dragon tileset | Wrong theme. |
| `Tiny garden_free pack.zip` | 27 K | Flowers, plants, dirt, water | Very saturated; usable only if outdoor palette shifts. |
| `raou_free_top_down_adventure.zip` | 79 K | Adventure base tiles + 6 chars | Style mismatch with Pipoya. |
| `16x16 Animated Top-down Character V1.1.zip` | 21 K | 1 character, walk/slash/pull/death | Combat animations — irrelevant. |
| `Door_Animation.zip` | 20 K | 3 Pipoya door sheets | **Already superseded** — ATTRIBUTIONS records it was replaced by `gen_door.py` (wrong tile density). |
| `MetroCity 2.0/2.1.rar`, `Interior Furniture 2D.rar` | 60 K | (rar, not inspected — tiny) | Low priority. |

## A.3 The finding that changes the plan

`campus.json` loads **exactly two** tilesets: `floors_walls` (162 t) and `exterior` (2 112 t).
The whole world is furnished from **20 cut-out PNGs** in `public/assets/furniture/`.

Sitting unused:

| Already in `frontend/public/assets/` but never referenced | Tiles |
| --- | ---: |
| `furniture.png` | 234 |
| `doors_windows.png` | 180 |
| `small_items.png` | 64 |
| **subtotal (shipped, dead)** | **478** |
| In `Assets/` but never copied into the repo: `TopDownHouse_FurnitureState2.png` | 234 |
| In `Assets/` but never copied: `TopDownHouse_FloorsAndWalls_OpenDoors.png` | 24 |
| Office pack props downloaded but not cut out | 24 props |

Visual inspection of `furniture.png` alone found: 4 sofas, 2 armchairs, 3 bookshelves,
kitchen counters + stove + fridge, grandfather clock, fireplace, coat rack, floor lamps,
dressers, mirror, **3 patterned rugs**, side tables, bath/sink/toilet.
`small_items.png` has plates, cups, wine glasses, food, books, wall clocks, potted plants,
picture frames, candles, **a checkerboard**. `doors_windows.png` has staircases,
12 door variants and 12 window variants.

This directly retires most of the main report's P0/P1 list **at zero asset cost**:

- **F1 (emptiness)** — ~60 usable prop tiles + 24 office props, vs the current 20.
- **F2 (interior starvation)** — the interior set was never 162 tiles; it is 640 shipped, 898 available.
- **F5 (flat olive "rug")** — the pack ships 3 real patterned rugs, parquet, brick and tile floors. `gen_campus.py` picked a flat swatch (`FLOOR_MOSS = 39`) out of a sheet that has better options 20 tiles away.
- **F8 (board tables have no board)** — `small_items.png` contains a checkerboard tile.
- **Hostel with no beds** — `furniture.png` has beds/dressers; `FurnitureState2` has their alternate states.

## A.4 ⚠ Licence blocker on Modern Interiors Free

`Modern tiles_Free/LICENSE.txt`, verbatim:

> YOU CAN USE THE ASSET IN NON COMMERCIAL PROJECTS · YOU CAN EDIT THE SPRITES AND USE THEM IN NON COMMERCIAL PROJECTS
> YOU CAN'T USE THE ASSET IN COMMERCIAL PROJECTS · YOU CAN'T EDIT THE SPRITES AND USE THEM IN COMMERCIAL PROJECTS

Its `READ ME.txt` also states the free tier is *"around 1 % of material of the full asset"*
and prices the full version at **$1.20** (≈ ₹105), which carries the commercial licence.

Consequence:
- If hyprverse stays a private, free, non-commercial student world → the free tier is usable as-is.
- If it may ever be monetised, sponsored, or shipped as a product → **do not use the free tier at all**; $1.20 removes the problem permanently.

Independently: `Office-Furniture-Pixel-Art.zip` ships **no licence file**. `ATTRIBUTIONS.md`
already flags pre-PRD-12 provenance as *"best-effort — confirm before any commercial release."*
That confirmation is now overdue for this pack.

## A.5 What the assets can and cannot fix

**Assets solve (all available now):** world emptiness, interior variety, floor/rug texture,
board-table tops, door/window variety, staircases, wall dressing, outdoor greenery
(Serene Village trees/flowers/rocks), unlimited on-style student avatars (CharaMEL),
school-uniform sprites.

**Assets half-solve:** *alive*. Modern Interiors ships sit / idle-anim / phone poses — but only
for its own 4 characters, drawn 16 px wide × 32 tall against Pipoya's squat 32×32. Adopting
them means replacing every avatar, not mixing. The Cozy pack's **stems** are the cheapest
"alive" win in the folder: play `Loop(without Drums)` indoors and `Loop(with Drums)` on the
plaza off the same track and the world gains adaptive music for one file each. Format is
`.opus` — browser-native, but the pipeline currently emits Ogg Vorbis.

**Assets do not touch at all:** F6 raw browser widgets, F7 shadows / occlusion / depth-sorting,
F10 offset interaction zones, F11 overlay collisions, F12 stuck "Around" panel, F13 load-in
state, F14 "TAP TO START", F15 the *Flappy Bird* name, F16–F22 arcade & HUD chrome, F25.
**"Smooth" is 100 % code.** No purchase changes it.

## A.6 Revised recommendation (supersedes §7)

1. **Tier 0 — ₹0, buy nothing.** Load `furniture` / `small_items` / `doors_windows` as real
   tilesets in `gen_campus.py`, copy in `FurnitureState2` + `FloorsAndWalls_OpenDoors`, cut the
   24 remaining office props, and fix `FLOOR_MOSS` to a real floor tile. This is the largest
   single quality jump available and it is entirely a generator change.
2. **Decide the interior language before mixing anything.** Top-Down Retro Interior is warm,
   brown, hard-outlined. LimeZu Modern Interiors is cooler, softer, more saturated. In one room
   they read as two games. Pick one and commit; do not blend.
3. **If LimeZu wins, pay the $1.20 and replace the interior tileset wholesale** — never ship the
   free tier in anything commercial.
4. **Confirm the Office Furniture pack's licence** and add the real row to `ATTRIBUTIONS.md`.
5. **Delete `DSArcadePack01.zip`** (23 MB of Unity 3D) and `addwork.png` from consideration.
6. **Unexploited, free, on-style, high-value:** CharaMEL avatar generator, Pipoya school
   uniforms, Pipoya animated water/flowers, Cozy pack drum stems.
