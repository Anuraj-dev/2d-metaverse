# DESIGN.md — Hyprverse

> Single source of visual truth. UI and world-art changes follow this file; changes are deliberate decisions, not side effects.

## Direction

- **Vibe**: Pixel Art — warm, playful, top-down student campus.
- **Mode**: bright daytime world first; HUD surfaces use opaque warm pixel-paper panels with crisp brown outlines and hard offset shadows. A restrained sepia scrim is reserved for modal backdrops only.
- **References**: the current Pipoya-compatible avatar/world art, the curated LimeZu furniture catalog, and Raja's August 1 campus-review screenshots.

## Color tokens

| Token | Value | Use |
|---|---|---|
| `--background` | `#f7f5ea` | light cards and campus-adjacent surfaces |
| `--foreground` | `#23331c` | body text on light surfaces |
| `--primary` | `#5fa63a` | brand actions and connected state |
| `--primary-foreground` | `#ffffff` | text on primary |
| `--muted` | `#5d6b52` | secondary text |
| `--accent` | `#eeae3c` | warm highlights |
| `--panel` | `#f3e6b2` | compatibility alias for in-world HUD surfaces |
| `--destructive` | `#e2564d` | errors and destructive actions |
| `--hud-paper` | `#f3e6b2` | pixel-HUD panels and controls |
| `--hud-paper-deep` | `#ddcd91` | pixel-HUD button faces and inset fields |
| `--hud-border` | `#754525` | crisp pixel-HUD outlines |
| `--hud-shadow` | `#4c2e1e` | hard-offset pixel-HUD shadows |
| `--hud-active` | `#557f32` | connected and active media states |
| `--hud-danger` | `#a7473f` | muted media states |

Body text contrast stays at least 4.5:1; large text stays at least 3:1.

## Typography

- **Heading and body font**: Nunito Variable, 500–800.
- **Monospace**: the existing system monospace stack for diagnostics only.
- **Scale**: 12 / 14 / 16 / 18 / 24 / 32 / 48.
- Body line-height 1.6, headings 1.2; line length at most 72 characters where prose is shown.

## Spacing and shape

- **Spacing scale**: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 px.
- **World grid**: 16 px source tiles, nearest-neighbour scaling only.
- **Radius**: 8 px controls, 12 px panels, full radius for pills.
- **Shadows**: use crisp 3–5 px hard-offset pixel shadows. Do not use glass blur, floating black pills, or soft generic card shadows in the in-world HUD.
- **Z-index scale**: 10 dropdown / 20 sticky / 30 overlay / 50 modal or toast.

## World-art placement

- Keep the current Pipoya-compatible pixel scale and the curated LimeZu furniture family. Reject style-mismatched assets.
- Empty floor is usable multiplayer space. A prop ships only when it is wall-flush, belongs to a nameable functional cluster, or marks a path junction.
- Wall-hung art stays on a wall row. Indoor furniture stays inside a room or a clearly authored work/service zone.
- Keep door spines, two-tile aisles, room centres, interaction prompts, and major paths clear.
- Gameplay seat sprites are visual and passable. Other substantial floor furniture is solid and its collision footprint must match the generated-map tests.
- Greenery is sparse and structural: paired at entrances, anchored in corners, or grouped on an authored planter pad. Never scatter it across open floor.
- The auditorium reads as a stage through a broad platform, backdrop, and one centered speaking focal point; audience banks retain clear center, side, and cross aisles.

## Motion

- Micro-interactions use 150–250 ms; layout transitions use 300 ms.
- Respect `prefers-reduced-motion`.
- World sprites remain crisp; do not blur or smoothly resample pixel assets.

## Components

- **Library**: existing custom React/Phaser surfaces.
- **Icons**: existing icon system; no emoji used as product icons.
- **Compact chat**: one bottom-left pixel-paper card contains header, transcript, and composer. The transcript uses a thin brown-on-paper scrollbar. Typing `/` opens the full command tray tucked over the card's lower-right edge; a prefix filters it, arrow keys move selection, and Tab or Enter chooses it. Muted/blocked management appears only while at least one entry exists, exposes only populated sections, and collapses independently from the chat card.
- **World speech bubble**: compact cream pixel-paper card with a brown outer edge, gold inner keyline, hard offset shadow, and short centered tail. The existing world nameplate identifies the speaker, so the bubble never repeats a `You` tab or avatar badge.
- **Campus map**: a warm wooden noticeboard holding a framed paper map, a pinned-paper player roster, and one small exploration note. Area labels use restrained blue hostel, purple stage, and terracotta arcade plaques; dark charcoal modal styling is not used.
- **Control bar**: media and settings stay in one compact horizontal bar at bottom-centre. Controls help lives inside Settings and still opens directly with `?`, avoiding a stray floating help button.
- **Stage broadcast**: one `Go Live` action starts microphone audio; the global camera control adds or removes video from that same live session. The only user-facing states are `LIVE` and `NOT LIVE`; never render separate on-air and video-start panels.

## Voice and content

- Friendly, compact, sentence-case UI copy.
- Area names aid wayfinding but must not obscure avatars, doors, furniture, or interaction targets.
