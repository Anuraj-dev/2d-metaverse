# Asset attributions

Every third-party asset shipped in `frontend/public/assets/` is listed here with
its source, author, and license. **Adding an asset without a row here is not
allowed** (see `README.md` → *Sound + polish pipeline*). Project-original assets
(hand-drawn or procedurally generated in this repo) are listed too, marked as
such.

Art direction is top-down pixel art in the Pipoya-compatible family; audio is a
small, normalized soundscape. See the README for the cohesion rules.

## Audio (`public/assets/audio/`)

Every clip below — **except the two portal transitions and the arcade blips,
noted separately** — derives from
**[Cozy Game Sound Pack 1](https://livinggameaudio.itch.io/)**
by LiivingGameaudio (IG @livinggameaudio) — free for any project, **no credit
required** (credit appreciated). The pack ships music stems only (verified: 44
audio files, all song loops/stems — no foley/UI folders), so the event SFX are
**cut from the pack's recorded material** — individually chosen percussive hits
and melodic notes, layered/pitched/filtered into foley-style cues by
`scripts/curate_audio.py` (exact stem + timestamp per clip documented there).
Nothing is synthesized from oscillators.

| File | Source material (within the pack) | Treatment |
| --- | --- | --- |
| `music_calm_1.ogg`, `music_calm_2.ogg`, `music_calm_3.ogg` | Ogg Opus stems `10-FullLoop(without Drums)` (C, 65 BPM), `1-Loop(without Drums)` (Ab, 67 BPM), `4-Loop(No Drums)` (G, 91.5 BPM) | PRD 21 curated calm-music pool (`scripts/curate_audio.py` → `curate_music_pool`), replacing the single looping `music_bed.ogg` (retired — see below). Each stem picked distinctly slower/sparser than the retired bed (measured via `ffmpeg volumedetect`: -17.5/-22.0/-20.8dB mean vs. the bed's -14.2dB) so the pool reads as calm, not driving. Decoded whole (not loop-trimmed — a track plays once to completion, then a silence gap, never loops), short in/out fade, peak-normalized. |
| `ambient_outdoor.ogg` | `3-Loop(without Drums)` pad (D#, the bed's dominant) | 34s slowed 2×, darkened (LP 950Hz), long reverb, seamless splice loop — a distant, warm outdoor "air" bed. |
| `footstep.ogg`, `sit.ogg` | Low drum hit, `6-Drums Only` @ 10.06s | Pitched down, low-passed, shortened — soft weight / cushioned thud. |
| `door_open.ogg`, `door_close.ogg` | Mid knock (`2-Loop(Drums Only)` @ 97.33s) + low thump (above) | Two-layer wooden foley: handle click into swing contact (open), firm shut (close), light room reverb. |
| `message.ogg`, `join.ogg`, `leave.ogg` | Melodic notes from the `8-Intro` arpeggio | Shifted −1 st into the retired music bed's key family (historical — see below); single soft blip / rising / falling two-note chimes. |
| `meeting_join.ogg`, `meeting_leave.ogg` | Four `8-Intro` notes | Up/down arpeggio in the retired bed's key with a warm room reverb. |
| `portal_in.ogg`, `portal_out.ogg` | **CC0 library** (see the note below) — reversed-cymbal riser `711683__leonseptavaux`, transition whoosh `427823__kinoton__whoosh-1`, sub-impact `394642__screamstudio` (in); low swoosh `517877__the_real_not_important__swoosh_low` (out) | PRD 16 cinematic transition: rising riser + whoosh landing on a soft sub-impact (in); softer, lighter descending swoosh, long fade, no impact (out). `scripts/curate_audio.py` → `curate_portal_transitions`. |
| `arcade_start.ogg`, `arcade_point.ogg`, `arcade_over.ogg`, `arcade_flap.ogg`, `arcade_hit.ogg`, `arcade_near.ogg`, `arcade_best.ogg` | **Project-original** — synthesized square-wave chiptune / sine+pink-noise one-shots (`scripts/curate_audio.py` → `synth_arcade`) | Diegetic arcade cues: cabinet open, score, game-over, Flappy wing/crash, Snake near miss, and new-personal-best fanfare. Frequent cues are deliberately quieter. Project asset (no third-party source). |
| `arcade_merge.ogg`, `arcade_nova.ogg` | **Project-original** — synthesized square-wave chiptune (`scripts/curate_audio.py` → `synth_arcade`) | Stellar Forge merge-drop cabinet (Arcade 2.0): a short two-note fusion chime that the mixer repitches per evolution tier (`soundMixer.mergePitchRate`), and a five-note rising supernova fanfare. Same 8-bit family as the blips above. Project asset (no third-party source). |
| `arcade_eat.ogg`, `arcade_bonus.ogg`, `arcade_snake_over.ogg`, `arcade_highscore.ogg`, `arcade_milestone.ogg` | **Owner's Snake game** — [Anuraj-dev/Snake-Game](https://github.com/Anuraj-dev/Snake-Game) `sound/{eat,bonus-food,game-over,highscore,milestone}.wav` by **Anuraj Jit Saikia**, MIT License | Ported for the arcade Snake cabinet (`scripts/curate_audio.py` → `curate_snake_sounds`): mono, silence-trimmed, peak-normalized ~-4 dB, Ogg Vorbis. Eat / bonus food / death / highscore / score-milestone stings; games stay audio-agnostic and emit domain events that the mixer maps to these clips. |
| `board_place.ogg`, `board_place_far.ogg`, `board_win.ogg`, `board_lose.ogg`, `board_draw.ogg`, `board_invalid.ogg` | Mid knock (`2-Loop(Drums Only)` @ 97.33s) + low thump (`6-Drums Only` @ 10.06s) + melodic notes from the `8-Intro` arpeggio | Board tables (`scripts/curate_audio.py` → `curate_board` / `curate_board_sounds`): wooden placement foley at two distances — yours dry and close, your opponent's pitched down, low-passed and roomier — plus three separate outcomes (win/lose/draw) and a hard rejection thud. Plaza furniture, not cabinets, so they sit in the recorded-foley family with the rest of the world. |

**Retired:** `music_bed.ogg` (Ogg Opus stem `6-Loop(without Drums)`, G#) — the
single looping music bed shipped through PRD 20. PRD 21 replaced it with the
curated calm-music pool above (testers muted the constant loop within
seconds); the file is deleted and no longer referenced by any code path.

The two **portal transition** clips (`portal_in.ogg`, `portal_out.ogg`, PRD 16)
are cut from the owner's personal sound-effects library, whose bundled
`README.txt` states every file was sourced from **[Freesound.org](https://freesound.org/)**
under the **[Creative Commons 0 (CC0)](https://creativecommons.org/publicdomain/zero/1.0/)**
public-domain dedication (no attribution required; individual uploader handles
retained above for traceability). The Cozy pack has no cinematic riser/whoosh
material, so these are the one deliberate exception to the single-pack sourcing.

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
| `furniture/arcade_snake.png`, `furniture/arcade_flappy.png` | Project-original | Generated in-repo (PRD 11, `scripts/gen_arcade_sprites.py`) | Project asset — 32×32 upright arcade cabinets in the cool-office palette, marquee/screen tinted per game (teal/amber). Not derived from any third-party pack. |
| `furniture/arcade_merge-drop.png` | Project-original | Generated in-repo (Arcade 2.0, `scripts/gen_arcade_sprites.py`) | Project asset — the Stellar Forge cabinet: same 32×32 body as its neighbours, marquee/screen tinted violet (`#b082ff`). Not derived from any third-party pack. |
| `arcade/snake_tiles.png` | Project-original | Generated in-repo (issue #163, `scripts/gen_snake_sprites.py`) | Project asset — 16×16 sprite tiles for the Snake mini-game (head/body/bend/tail per direction, apple, wall block), replacing the renderer's flat rectangles. Same outline ink and cool palette as the arcade cabinets. Consumed only by the lazy-loaded arcade overlay canvas, not by Phaser/BootScene. Not derived from any third-party pack. |
| `tilesets/room_builder.png`, `furniture/lz_*.png` | [Modern Interiors — RPG Tileset](https://limezu.itch.io/moderninteriors), **free** tier (`Modern_Interiors_Free_v2.2`, `Interiors_free/16x16`) | **LimeZu** | ⚠️ **NON-COMMERCIAL ONLY.** The free tier's `Modern tiles_Free/LICENSE.txt` reads verbatim: *"YOU CAN USE THE ASSET IN NON COMMERCIAL PROJECTS · YOU CAN EDIT THE SPRITES AND USE THEM IN NON COMMERCIAL PROJECTS / YOU CAN'T USE THE ASSET IN COMMERCIAL PROJECTS · YOU CAN'T EDIT THE SPRITES AND USE THEM IN COMMERCIAL PROJECTS · YOU CAN'T EDIT AND RESELL THE SPRITES."* That is fine today because hyprverse is Raja's personal, non-commercial project. **If it is ever monetised, sponsored or shipped as a product, buy the paid pack (~$1.20, carries the commercial licence) before shipping — or strip these assets.** Shipped: `room_builder.png` verbatim (interior floor tiles: brick / cross-tile / mint / screed / herringbone parquet), and 102 prop cutouts from `Interiors_free_16x16.png` cropped by `scripts/gen_limezu_sprites.py` (source tile coordinates named in that script). The raw sheets are **not** committed. Used campus-wide by the district art passes in `scripts/campus_decor/` (see `docs/ux-art-audit-2026-08-01.md` and `docs/art/limezu-catalog.md`). |
| `landing/campus-hero.png` | Composed in-repo (`scripts/gen_landing_backdrop.py`) from `maps/campus.json` + the `exterior.png` / `floors_walls.png` tilesets and `furniture/*.png` (all attributed above) | (respective pack authors) | Landing diorama backdrop (PRD 19) — a pure composition of already-attributed pack assets: a fixed crop of the real campus map re-rendered to one palette-quantised PNG. No new art authored; inherits the licenses of its source tiles/sprites. |

## Fonts (`public/assets/fonts/`)

The app typeface (PRD 18) is one self-hosted variable font — no third-party font
CDN. Applied app-wide via the `--font-app` CSS custom property (HUD, panels,
overlays, landing, and in-canvas Phaser text).

| File | Font | Author | License |
| --- | --- | --- | --- |
| `fonts/nunito-variable.woff2` | [Nunito](https://fonts.google.com/specimen/Nunito) (variable, weight axis, Latin subset) | Vernon Adams, Cyreal, Jacques Le Bailly (The Nunito Project Authors) | [SIL Open Font License 1.1 (OFL-1.1)](https://openfontlicense.org/) — source: [googlefonts/nunito](https://github.com/googlefonts/nunito), redistributed via [Fontsource](https://fontsource.org/fonts/nunito). |

The UI-chrome icons are [lucide](https://lucide.dev/) (`lucide-react`, ISC
license), imported per-icon from source — not shipped under `public/assets/`, so
listed here only for provenance.

## How to add a row

When you curate a new asset: pick only what you use, optimize it (see the README
pipeline), drop it under `public/assets/…`, and add a row here naming the
**source, author, and license**. If a source pack forbids redistributing the raw
pack, that's fine — we ship only the curated derivative, but still credit it.
