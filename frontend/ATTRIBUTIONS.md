# Asset attributions

Every third-party asset shipped in `frontend/public/assets/` is listed here with
its source, author, and license. **Adding an asset without a row here is not
allowed** (see `README.md` → *Sound + polish pipeline*). Project-original assets
(hand-drawn or procedurally generated in this repo) are listed too, marked as
such.

Art direction is top-down pixel art in the Pipoya-compatible family; audio is a
small, normalized soundscape. See the README for the cohesion rules.

## Audio (`public/assets/audio/`)

Every clip below derives from **[Cozy Game Sound Pack 1](https://livinggameaudio.itch.io/)**
by LiivingGameaudio (IG @livinggameaudio) — free for any project, **no credit
required** (credit appreciated). The pack ships music stems only (verified: 44
audio files, all song loops/stems — no foley/UI folders), so the event SFX are
**cut from the pack's recorded material** — individually chosen percussive hits
and melodic notes, layered/pitched/filtered into foley-style cues by
`scripts/curate_audio.py` (exact stem + timestamp per clip documented there).
Nothing is synthesized from oscillators.

| File | Source material (within the pack) | Treatment |
| --- | --- | --- |
| `music_bed.ogg` | Ogg Opus stem `6-Loop(without Drums)` (G#) | Transcoded to a small mono looping `.ogg`. |
| `ambient_outdoor.ogg` | `3-Loop(without Drums)` pad (D#, the bed's dominant) | 34s slowed 2×, darkened (LP 950Hz), long reverb, seamless splice loop — a distant, warm outdoor "air" bed. |
| `footstep.ogg`, `sit.ogg` | Low drum hit, `6-Drums Only` @ 10.06s | Pitched down, low-passed, shortened — soft weight / cushioned thud. |
| `door_open.ogg`, `door_close.ogg` | Mid knock (`2-Loop(Drums Only)` @ 97.33s) + low thump (above) | Two-layer wooden foley: handle click into swing contact (open), firm shut (close), light room reverb. |
| `message.ogg`, `join.ogg`, `leave.ogg` | Melodic notes from the `8-Intro` arpeggio | Shifted −1 st into the music bed's key family; single soft blip / rising / falling two-note chimes. |
| `meeting_join.ogg`, `meeting_leave.ogg` | Four `8-Intro` notes | Up/down arpeggio in the bed's key with a warm room reverb. |
| `portal_in.ogg`, `portal_out.ogg` | Bright metallic hit (`2-Loop(Drums Only)` @ 94.67s) + deep boom (`10-FullLoop(Drums Only)` @ 96.06s) + note tails | Time-stretched, reverbed, **reversed** shimmer swelling into a sub boom (in); boom with a decaying sparkle tail (out). |
| `arcade_start.ogg`, `arcade_point.ogg`, `arcade_over.ogg` | **Project-original** — synthesized square-wave chiptune (`scripts/curate_audio.py` → `synth_arcade`) | Diegetic 8-bit arcade blips (open arpeggio, score blip, game-over descend). Intentionally a different family from the recorded foley — a cozy pack has no arcade beeps to cut. Project asset (no third-party source). |

## Sprites & tilesets (`public/assets/`)

Character sprites and tilesets predate PRD 12; provenance below is by source pack
(the packs live in the repo-root `Assets/` folder, untracked). Per-file
provenance for pre-PRD-12 assets is best-effort — confirm before any commercial
release.

| File(s) | Source pack | Author | License |
| --- | --- | --- | --- |
| `characters/char5..char12.png` | PIPOYA FREE RPG Character Sprites 32x32 | Pipoya | Free for commercial/non-commercial use per Pipoya's terms; redistribution of the raw pack prohibited. |
| `characters/char1..char4.png` | Penzilla-style interior characters | (interior character pack) | Free-use pixel character set. |
| `tilesets/exterior.png` | Pipoya RPG Tileset 32x32 (exterior) | Pipoya | Per Pipoya's free-use terms. |
| `tilesets/floors_walls.png`, `tilesets/doors_windows.png`, `tilesets/small_items.png`, `tilesets/furniture.png` | Top-Down Retro Interior / Office Furniture pixel packs | (respective pack authors) | Free-use pixel interior sets. |
| `doors/door1.png` | Composed in-repo (`scripts/gen_door.py`) from `tilesets/doors_windows.png` (Top-Down Retro Interior) | (pack author) | Free-use pixel interior set — frame + closed/ajar door leaves recomposed into an aligned 3-frame sheet (replaces the Pipoya Door Animation sheet, which was drawn at RPG-Maker tile density). |
| `furniture/*.png` (desk, chair, sofa, plant, water, vending, …) | Top-Down Retro Interior / Office Furniture pixel packs | (respective pack authors) | Free-use pixel furniture; cool office palette. |
| `furniture/table_round.png` | Project-original | Redrawn in-repo (PRD 12) | Project asset — replaces the prior flat placeholder, matched to the furniture palette. |
| `furniture/arcade_snake.png`, `furniture/arcade_flappy.png`, `furniture/arcade_2048.png` | Project-original | Generated in-repo (PRD 11, `scripts/gen_arcade_sprites.py`) | Project asset — 32×32 upright arcade cabinets in the cool-office palette, marquee/screen tinted per game (teal/amber/pink). Not derived from any third-party pack. |

## How to add a row

When you curate a new asset: pick only what you use, optimize it (see the README
pipeline), drop it under `public/assets/…`, and add a row here naming the
**source, author, and license**. If a source pack forbids redistributing the raw
pack, that's fine — we ship only the curated derivative, but still credit it.
