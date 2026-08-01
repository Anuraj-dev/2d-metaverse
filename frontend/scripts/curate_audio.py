#!/usr/bin/env python3
"""Curate the game soundscape from the owner-supplied Cozy Game Sound Pack 1.

Replaces the synthesized `gen_audio.py` clips (PRD 12 review round 1, finding
1): every event SFX and the outdoor ambience are now cut from REAL produced
recordings in the pack — individually chosen percussive hits and melodic notes,
layered/pitched/filtered into foley-style cues. Nothing here is oscillator
output.

Sources (documented per clip below; timestamps into the pack's stems):
  - low thump        6-G#-96 BPM / 6-Drums Only.opus            @ 10.060s
  - deep boom        10-C -65 BPM / 10-FullLoop(Drums Only).opus @ 96.055s
  - wood click       2-G-90 BPM / 2-Loop(Drums Only).opus        @ 97.330s
  - bright shimmer   2-G-90 BPM / 2-Loop(Drums Only).opus        @ 94.670s
  - melodic notes    8 - G- 80 BPM / 8-Intro.opus  (A-major arpeggio set)
  - soft pluck       9 -F - 120 BPM / Loops(without Crash and Drums)/9-Intro(WO Drums).opus
  - ambient bed      3-D#-104 BPM / 3-Loop(without Drums).opus  (slowed 2x)
  - music pool       10-C/1-Ab/4-G "without Drums" stems (PRD 21, see MUSIC_STEMS)

The melodic notes are shifted -1 semitone into the G# key family of the
pack's stem 6 — historically the shipped music bed (`music_bed.ogg`, retired
by PRD 21 and replaced by the calm pool below); the ambient bed's slowed D#
stem is its dominant — everything that can sound at once is consonant.

Requires: ffmpeg, sox, and the pack zip at repo-root Assets/ (untracked). Point
COZY_PACK at the zip if it lives elsewhere on your machine.

Run:  python3 scripts/curate_audio.py                 # regenerate everything
      python3 scripts/curate_audio.py --only arcade   # just one step
      python3 scripts/curate_audio.py --only arcade,board

`--only` exists so a change that adds a few clips (e.g. issue #163's per-event
arcade cues and board-table foley) does not have to re-encode — and therefore
re-commit — every already-shipped clip. Known steps: see STEPS at the bottom.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = os.environ.get(
    "COZY_PACK", os.path.join(HERE, "..", "..", "Assets", "Cozy Game Sound Pack 1.zip")
)
OUT_DIR = os.path.join(HERE, "..", "public", "assets", "audio")
PREFIX = "Cozy Game Sound Pack 1/"

# The meeting-portal transition clips (PRD 16) are curated from the owner's
# personal CC0 sound-effects library (Freesound.org, CC0 per its README) rather
# than the Cozy pack — a cozy foley pack has no cinematic whoosh/riser material.
# Machine-specific path (like PACK above); the portal step is skipped with a
# warning if the library is not mounted.
DSLR_LIB = "/run/media/raja/New Volume/DSLR (The beast)/Sound Effects"

# Owner's standalone Snake game (sibling repo) — source wavs for the arcade
# Snake port. Machine-specific path; curate_snake_sounds() skips with a warning
# if the directory is not present.
SNAKE_GAME_SOUND = "/home/raja/Anuraj-Dev/Snake-game/sound"

STEMS = {
    "drums6": "6-G#-96 BPM/6-Drums Only.opus",
    "drums10": "10-C -65 BPM/10-FullLoop(Drums Only).opus",
    "drums2": "2-G-90 BPM/2-Loop(Drums Only).opus",
    "intro8": "8 - G- 80 BPM/8-Intro.opus",
    "intro9": "9 -F - 120 BPM/Loops(without Crash and Drums)/9-Intro(WO Drums).opus",
    "pad3": "3-D#-104 BPM/3-Loop(without Drums).opus",
}

# PRD 21: the curated calm-music pool that replaces the single looping
# `music_bed.ogg` (retired — see ATTRIBUTIONS.md). Three sparse "without
# drums"/"no drums" stems, chosen distinctly slower and quieter (measured via
# `ffmpeg -af volumedetect`) than the retired bed (G#, 96 BPM, -14.2dB mean)
# so the pool reads as calm rather than driving:
#   music_calm_1  10-C, 65 BPM   mean -17.5dB  (slowest, sparsest)
#   music_calm_2  1-Ab, 67 BPM   mean -22.0dB  (quietest)
#   music_calm_3  4-G, 91.5 BPM  mean -20.8dB
# Curation, not composition (locked audio direction): same already-attributed
# pack as every other clip, no new third-party sourcing. Each of format
# (member path within the pack, peak-normalize target dB).
MUSIC_STEMS = {
    "music_calm_1": ("10-C -65 BPM/10-FullLoop(without Drums).opus", -14),
    "music_calm_2": ("1-Ab-67 BPM/1-Loop(without Drums).opus", -14),
    "music_calm_3": ("4-G-91.5 BPM/4-Loop(No Drums).opus", -14),
}

TMP = tempfile.mkdtemp(prefix="curate_audio_")


def run(cmd: list[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"FAILED: {' '.join(cmd)}\n{r.stderr[-2000:]}")


def decode_stems() -> dict[str, str]:
    """Extract the needed .opus stems from the pack zip and decode to wav."""
    wavs: dict[str, str] = {}
    with zipfile.ZipFile(PACK) as z:
        for key, member in STEMS.items():
            src = os.path.join(TMP, f"{key}.opus")
            with z.open(PREFIX + member) as f, open(src, "wb") as o:
                shutil.copyfileobj(f, o)
            wav = os.path.join(TMP, f"{key}.wav")
            run(["ffmpeg", "-y", "-i", src, "-ac", "1", "-ar", "48000", wav])
            wavs[key] = wav
    return wavs


def slice_(wav: str, start: float, dur: float, name: str) -> str:
    out = os.path.join(TMP, f"{name}.wav")
    run(["sox", wav, out, "trim", str(start), str(dur)])
    return out


def fx(src: str, name: str, *effects: str) -> str:
    out = os.path.join(TMP, f"{name}.wav")
    run(["sox", src, out, *effects])
    return out


def peak_normalize(src: str, name: str, peak_db: float) -> str:
    out = os.path.join(TMP, f"{name}.wav")
    run(["sox", src, out, "gain", "-n", str(peak_db)])
    return out


def mix(name: str, *parts: tuple[str, float]) -> str:
    """Mix parts at the given start offsets (seconds) into one wav."""
    padded = []
    for i, (part, at) in enumerate(parts):
        p = os.path.join(TMP, f"{name}_p{i}.wav")
        run(["sox", part, p, "pad", str(at)])
        padded.append(p)
    out = os.path.join(TMP, f"{name}.wav")
    run(["sox", "-m", *padded, out])
    return out


def encode(src: str, clip: str, quality: str = "3") -> None:
    dst = os.path.join(OUT_DIR, f"{clip}.ogg")
    run(["ffmpeg", "-y", "-i", src, "-ac", "1", "-c:a", "libvorbis", "-q:a", quality, dst])
    print(f"  wrote {clip}.ogg ({os.path.getsize(dst)} bytes)")


def synth_arcade() -> None:
    """Synthesize the arcade cabinet blips (square-wave chiptune).

    Every meaningful beat gets its own cue. The common cabinet/score/death,
    near-miss, and best cues use the square-wave family; Flappy's frequently
    repeated wing/crash pair uses the softer sine/noise treatment from the
    current arcade renderer.
    """
    def blip(name: str, *segs: tuple[float, int], fade: float, peak: float = -3.0) -> str:
        parts = []
        for i, (dur, freq) in enumerate(segs):
            p = os.path.join(TMP, f"{name}_s{i}.wav")
            run(["sox", "-n", p, "synth", str(dur), "square", str(freq)])
            parts.append(p)
        joined = os.path.join(TMP, f"{name}_joined.wav")
        run(["sox", *parts, joined])
        out = os.path.join(TMP, f"{name}.wav")
        run(["sox", joined, out, "fade", "h", "0.005", str(fade), "0.03", "gain", "-n", str(peak)])
        return out

    def sweep(name: str, wave: str, f0: int, f1: int, dur: float, peak_db: float) -> str:
        """One falling/rising voice, faded at both ends and peak-normalized."""
        raw = os.path.join(TMP, f"{name}_raw.wav")
        run(["sox", "-n", raw, "synth", str(dur), wave, f"{f0}:{f1}"])
        return fx(raw, name, "fade", "h", "0.004", str(dur), str(dur * 0.7),
                  "gain", "-n", str(peak_db))

    def puff(name: str, cutoff: int, dur: float, peak_db: float) -> str:
        """Lowpassed noise burst — the air behind a wingbeat / the crash body."""
        raw = os.path.join(TMP, f"{name}_raw.wav")
        run(["sox", "-n", raw, "synth", str(dur), "pinknoise"])
        return fx(raw, name, "lowpass", str(cutoff), "fade", "h", "0.003", str(dur),
                  str(dur * 0.8), "gain", "-n", str(peak_db))

    encode(blip("arcade_point", (0.09, 880), (0.05, 1180), fade=0.14), "arcade_point")
    # Near miss: a fast descending whip — a warning, so quiet and out of the way.
    encode(
        blip("arcade_near", (0.04, 1760), (0.035, 1318), (0.035, 988), fade=0.11, peak=-13.0),
        "arcade_near",
    )
    encode(blip("arcade_start", (0.08, 523), (0.08, 659), (0.12, 784), fade=0.28), "arcade_start")
    encode(blip("arcade_over", (0.14, 440), (0.14, 349), (0.22, 262), fade=0.5), "arcade_over")
    # New personal best: the only rising four-note fanfare in the set.
    encode(
        blip("arcade_best", (0.08, 659), (0.08, 784), (0.08, 988), (0.20, 1319), fade=0.42),
        "arcade_best",
    )

    # Wingbeat: a short downward blip with a breath of air under it. Quiet by
    # design — it fires several times a second.
    encode(mix("arcade_flap",
               (sweep("flap_tone", "sine", 560, 210, 0.09, -13), 0.0),
               (puff("flap_air", 1300, 0.07, -20), 0.0)), "arcade_flap")
    # Crash: a low body thud with a fast pitch drop, no tail.
    encode(mix("arcade_hit",
               (sweep("hit_tone", "sine", 200, 52, 0.26, -5), 0.0),
               (puff("hit_body", 420, 0.14, -11), 0.0)), "arcade_hit")


def curate_board() -> None:
    """Board-table place/win foley from the Cozy pack (issue #163).

    The board tables used to borrow the arcade chiptune for their move/win cues,
    which read as the wrong room — they are wooden tables in the plaza, not a
    cabinet. These are cut from the same recorded pack as the rest of the world
    foley: a dry wooden knock for placing a piece, and a warm rising G#4-C5-G#5
    pluck (the shipped chime key family) with a metallic shine for the win.
    """
    if not os.path.exists(PACK):
        sys.exit(f"pack not found: {PACK}")
    w = decode_stems()
    click = slice_(w["drums2"], 97.330, 0.40, "b_click")      # dry mid-range knock
    shimmer = slice_(w["drums2"], 94.670, 0.40, "b_shimmer")  # bright metallic hit

    def note(name: str, start: float, dur: float) -> str:
        n = slice_(w["intro8"], start, dur, f"{name}_raw")
        return fx(n, name, "pitch", "-100", "fade", "0.005", str(dur), str(min(dur * 0.6, 0.35)))

    # board_place: a short, dry wooden tap with a hint of table room. Quiet —
    # it fires on every move of every visible match.
    place = fx(click, "board_place_fx",
               "pitch", "-250", "lowpass", "3200", "trim", "0", "0.15",
               "fade", "0", "0.15", "0.08", "reverb", "8", "50", "20")
    encode(peak_normalize(place, "board_place_n", -16), "board_place")

    # board_win: rising G#4 → C5 → G#5 pluck with a soft shine on the last note.
    b_a4 = note("b_a4", 4.500, 0.51)
    b_cs5 = note("b_cs5", 10.750, 0.50)
    b_a5 = note("b_a5", 9.750, 0.75)
    shine = peak_normalize(
        fx(shimmer, "b_shine", "trim", "0", "0.35", "fade", "0", "0.35", "0.24"),
        "b_shine_n", -21)
    win = mix("board_win_mix",
              (peak_normalize(fx(b_a4, "bw1", "trim", "0", "0.30"), "bw1_n", -16), 0.0),
              (peak_normalize(fx(b_cs5, "bw2", "trim", "0", "0.32"), "bw2_n", -15), 0.10),
              (peak_normalize(b_a5, "bw3_n", -13), 0.20),
              (shine, 0.20))
    encode(peak_normalize(fx(win, "board_win_fx", "reverb", "20", "50", "45"), "board_win_n", -13),
           "board_win")


def curate_portal_transitions() -> None:
    """Curate the meeting-portal whoosh clips from the CC0 DSLR library (PRD 16).

    portal_in: a rising reversed-cymbal riser + a transition whoosh landing on a
    soft sub-impact — a cinematic "entering a portal" swell. portal_out: a
    softer, lighter descending swoosh with a long fade and NO impact layer, so
    leaving reads gentler than entering. Both mono, peak-normalized, Ogg Vorbis.
    """
    if not os.path.isdir(DSLR_LIB):
        print(f"  [skip] portal transitions — library not mounted at {DSLR_LIB}")
        return

    def mono(src: str, name: str) -> str:
        out = os.path.join(TMP, f"{name}_mono.wav")
        run(["ffmpeg", "-y", "-i", src, "-ac", "1", "-ar", "48000", out])
        return out

    lib = lambda *p: os.path.join(DSLR_LIB, *p)

    # ── portal_in: riser → whoosh → soft impact ─────────────────────────────
    cymbal = mono(lib("riser", "711683__leonseptavaux__cymbal_sound_fx_reverse_1.wav"), "cymbal")
    whoosh = mono(lib("Woosh", "transition woosh", "427823__kinoton__whoosh-1.wav"), "whoosh")
    impact = mono(lib("hit & impact", "394642__screamstudio__sub-impact.wav"), "impact")

    riser_part = fx(cymbal, "riser_part", "trim", "3.47", "1.2", "fade", "h", "0.05", "1.2", "0.15")
    whoosh_part = fx(whoosh, "whoosh_part", "fade", "h", "0.02", "0.8", "0.08")
    impact_trim = fx(impact, "impact_trim", "trim", "0", "0.6", "fade", "h", "0.01", "0.6", "0.3")
    impact_part = fx(impact_trim, "impact_part", "pad", "0.9", "0")
    p_in_mix = os.path.join(TMP, "portal_in_mix.wav")
    run(["sox", "-m", riser_part, whoosh_part, impact_part, p_in_mix])
    p_in = fx(peak_normalize(p_in_mix, "portal_in_norm", -11), "portal_in_final",
              "fade", "h", "0.01", "1.5", "0.2")
    encode(p_in, "portal_in")

    # ── portal_out: soft descending swoosh, no impact ───────────────────────
    swoosh = mono(lib("Woosh", "transition woosh", "517877__the_real_not_important__swoosh_low.mp3"),
                  "swooshlow")
    p_out = fx(peak_normalize(
        fx(swoosh, "portalout_trim", "trim", "0", "1.0", "fade", "h", "0.02", "1.0", "0.5"),
        "portalout_norm", -13), "portalout_final", "fade", "h", "0.01", "1.0", "0.1")
    encode(p_out, "portal_out")


def curate_snake_sounds() -> None:
    """Port the owner's Snake-game wavs into mono peak-normalized Ogg Vorbis.

    Source: sibling repo `/home/raja/Anuraj-Dev/Snake-game/sound/*.wav`
    (MIT, Anuraj Jit Saikia). Five clips: eat, bonus-food, game-over, highscore,
    milestone. Each is converted mono @ 48 kHz, silence-trimmed, peak-normalized
    to ~-4 dB (same loudness family as the other arcade one-shots), then encoded
    as Ogg Vorbis. Skipped with a warning if the source dir is missing.
    """
    if not os.path.isdir(SNAKE_GAME_SOUND):
        print(f"  [skip] snake sounds — source not found at {SNAKE_GAME_SOUND}")
        return

    # (source filename without path, output clip basename, peak dB)
    clips = [
        ("eat.wav", "arcade_eat", -4),
        ("bonus-food.wav", "arcade_bonus", -4),
        ("game-over.wav", "arcade_snake_over", -4),
        ("highscore.wav", "arcade_highscore", -4),
        ("milestone.wav", "arcade_milestone", -4),
    ]
    for src_name, clip, peak_db in clips:
        src = os.path.join(SNAKE_GAME_SOUND, src_name)
        if not os.path.isfile(src):
            print(f"  [skip] {clip} — missing {src}")
            continue
        mono = os.path.join(TMP, f"{clip}_mono.wav")
        run(["ffmpeg", "-y", "-i", src, "-ac", "1", "-ar", "48000", mono])
        # Trim leading/trailing silence (threshold ~1%), keep a short pad so
        # sharp attacks aren't eaten by the silence gate.
        trimmed = os.path.join(TMP, f"{clip}_trim.wav")
        run([
            "sox", mono, trimmed,
            "silence", "1", "0.01", "1%",
            "reverse",
            "silence", "1", "0.01", "1%",
            "reverse",
            "pad", "0", "0.02",
        ])
        encode(peak_normalize(trimmed, f"{clip}_n", peak_db), clip)


def curate_music_pool() -> None:
    """Curate the PRD-21 calm-music pool (see MUSIC_STEMS above).

    Each stem is decoded whole (NOT trimmed to a beat-synced loop point — PRD
    21 plays a track once to completion, then a silence gap, never looping a
    single track), given a short in/out fade so the hard stem edit has no
    click, and peak-normalized alongside the rest of the soundscape.
    """
    with zipfile.ZipFile(PACK) as z:
        for clip, (member, peak_db) in MUSIC_STEMS.items():
            src = os.path.join(TMP, f"{clip}_raw.opus")
            with z.open(PREFIX + member) as f, open(src, "wb") as o:
                shutil.copyfileobj(f, o)
            wav = os.path.join(TMP, f"{clip}.wav")
            run(["ffmpeg", "-y", "-i", src, "-ac", "1", "-ar", "48000", wav])
            faded = fx(wav, f"{clip}_faded", "fade", "t", "0.8", "0", "1.2")
            encode(peak_normalize(faded, f"{clip}_n", peak_db), clip, quality="4")


def main() -> None:
    if not os.path.exists(PACK):
        sys.exit(f"pack not found: {PACK}")
    os.makedirs(OUT_DIR, exist_ok=True)
    w = decode_stems()

    # ── Raw material ────────────────────────────────────────────────────────
    thump = slice_(w["drums6"], 10.060, 0.40, "thump")      # rounded low drum hit
    boom = slice_(w["drums10"], 96.055, 0.40, "boom")       # deep ~100Hz boom
    click = slice_(w["drums2"], 97.330, 0.40, "click")      # dry mid-range knock
    shimmer = slice_(w["drums2"], 94.670, 0.40, "shimmer")  # bright metallic hit
    # A-major arpeggio notes from song 8's intro, shifted -1 st → G# family.
    def note(name: str, start: float, dur: float) -> str:
        n = slice_(w["intro8"], start, dur, f"{name}_raw")
        return fx(n, name, "pitch", "-100", "fade", "0.005", str(dur), str(min(dur * 0.6, 0.35)))
    n_a4 = note("n_a4", 4.500, 0.51)    # → G#4
    n_cs5 = note("n_cs5", 10.750, 0.50)  # → C5
    n_e5 = note("n_e5", 1.750, 0.60)    # → D#5
    n_a5 = note("n_a5", 9.750, 0.75)    # → G#5
    n_cs6 = note("n_cs6", 8.500, 0.45)  # → C6
    pluck = fx(slice_(w["intro9"], 0.250, 0.37, "pluck_raw"), "pluck",
               "pitch", "-100", "fade", "0.003", "0.37", "0.2")

    # ── Movement / furniture foley ──────────────────────────────────────────
    # footstep: darkened, shortened thump — soft weight, fires every 300ms.
    footstep = fx(thump, "footstep_fx",
                  "pitch", "-300", "lowpass", "650", "trim", "0", "0.15",
                  "fade", "0.002", "0.15", "0.09")
    encode(peak_normalize(footstep, "footstep_n", -17), "footstep")

    # sit: slightly longer cushioned thud.
    sit = fx(thump, "sit_fx",
             "pitch", "-200", "lowpass", "1100", "trim", "0", "0.24",
             "fade", "0.002", "0.24", "0.14")
    encode(peak_normalize(sit, "sit_n", -14), "sit")

    # door_open: wooden handle-click into a soft swing contact, roomy.
    do_click = peak_normalize(
        fx(click, "do_click", "pitch", "-400", "trim", "0", "0.20", "fade", "0", "0.20", "0.10"),
        "do_click_n", -16)
    do_thump = peak_normalize(
        fx(thump, "do_thump", "pitch", "-100", "lowpass", "1800", "trim", "0", "0.22",
           "fade", "0.002", "0.22", "0.12"),
        "do_thump_n", -19)
    door_open = fx(mix("door_open_mix", (do_click, 0.0), (do_thump, 0.09)),
                   "door_open_fx", "reverb", "18", "50", "40")
    encode(peak_normalize(door_open, "door_open_n", -14), "door_open")

    # door_close: firm wooden shut — thump leads, click lands with it.
    dc_thump = peak_normalize(
        fx(thump, "dc_thump", "lowpass", "1400", "trim", "0", "0.22", "fade", "0.001", "0.22", "0.12"),
        "dc_thump_n", -13)
    dc_click = peak_normalize(
        fx(click, "dc_click", "pitch", "-500", "trim", "0", "0.16", "fade", "0", "0.16", "0.08"),
        "dc_click_n", -16)
    door_close = fx(mix("door_close_mix", (dc_thump, 0.0), (dc_click, 0.02)),
                    "door_close_fx", "reverb", "12", "50", "30")
    encode(peak_normalize(door_close, "door_close_n", -13), "door_close")

    # ── Presence / chat chimes (all in the music bed's key family) ──────────
    # message: one soft high blip (C6), barely-there.
    encode(peak_normalize(fx(n_cs6, "message_fx", "trim", "0", "0.30", "fade", "0", "0.30", "0.18"),
                          "message_n", -16), "message")

    # join: rising two-note chime G#4 → D#5.
    join = mix("join_mix",
               (peak_normalize(fx(n_a4, "join_a", "trim", "0", "0.30"), "join_a_n", -16), 0.0),
               (peak_normalize(n_e5, "join_b_n", -14), 0.12))
    encode(peak_normalize(join, "join_n", -14), "join")

    # leave: falling two-note, quieter (D#5 → G#4).
    leave = mix("leave_mix",
                (peak_normalize(fx(n_e5, "leave_a", "trim", "0", "0.30"), "leave_a_n", -17), 0.0),
                (peak_normalize(n_a4, "leave_b_n", -15), 0.12))
    encode(peak_normalize(leave, "leave_n", -16), "leave")

    # meeting_join: up-arpeggio G#4 C5 D#5 G#5 with a warm room.
    mj = mix("mj_mix",
             (peak_normalize(fx(n_a4, "mj1", "trim", "0", "0.3"), "mj1_n", -17), 0.0),
             (peak_normalize(fx(n_cs5, "mj2", "trim", "0", "0.3"), "mj2_n", -16), 0.11),
             (peak_normalize(fx(n_e5, "mj3", "trim", "0", "0.35"), "mj3_n", -15), 0.22),
             (peak_normalize(n_a5, "mj4_n", -13), 0.33))
    encode(peak_normalize(fx(mj, "mj_fx", "reverb", "30", "50", "60"), "mj_n", -13), "meeting_join")

    # meeting_leave: mirrored down-arpeggio, softer.
    ml = mix("ml_mix",
             (peak_normalize(fx(n_a5, "ml1", "trim", "0", "0.3"), "ml1_n", -17), 0.0),
             (peak_normalize(fx(n_e5, "ml2", "trim", "0", "0.3"), "ml2_n", -17), 0.11),
             (peak_normalize(fx(n_cs5, "ml3", "trim", "0", "0.3"), "ml3_n", -16), 0.22),
             (peak_normalize(fx(n_a4, "ml4", "trim", "0", "0.4"), "ml4_n", -15), 0.33))
    encode(peak_normalize(fx(ml, "ml_fx", "reverb", "24", "50", "50"), "ml_n", -15), "meeting_leave")

    # ── Portals: cinematic whoosh in / softer whoosh out (PRD 16) ───────────
    # Curated from the CC0 DSLR library (see curate_portal_transitions) — the
    # Cozy pack has no cinematic riser/whoosh material. Skipped with a warning
    # if that library is not mounted (the other clips above still regenerate).
    curate_portal_transitions()

    # ── Outdoor ambience: the pack's sparsest pad, slowed into "air" ────────
    # 30s of the D# pad → 60s at half speed (an octave down, tonality blurred),
    # darkened and softened into a distant, warm outdoor atmosphere; seamless
    # loop via a 4s tail/head crossfade (sox splice).
    amb_seg = fx(w["pad3"], "amb_seg", "trim", "40", "34", "speed", "0.5",
                 "lowpass", "950", "highpass", "70", "reverb", "40", "50", "90")
    # crossfade-loop: fold the last 4s over the first 4s
    amb_main = fx(amb_seg, "amb_main", "trim", "0", "64")
    amb = os.path.join(TMP, "amb_loop.wav")
    run(["sox", amb_main, amb, "splice", "-q", "60,4"])
    amb = fx(amb, "amb_trimmed", "trim", "0", "60")
    encode(peak_normalize(amb, "amb_n", -20), "ambient_outdoor", quality="2")

    # ── Music pool (PRD 21): retires the single music_bed.ogg loop ──────────
    curate_music_pool()
    old_bed = os.path.join(OUT_DIR, "music_bed.ogg")
    if os.path.exists(old_bed):
        os.remove(old_bed)
        print("  removed music_bed.ogg (retired — replaced by the curated pool)")

    # ── Board-table foley (issue #163) ──────────────────────────────────────
    curate_board()

    # ── Arcade cabinet blips (PRD 11) ───────────────────────────────────────
    # Diegetic 8-bit chiptune: the cabinets are retro arcade machines, so their
    # blips are square-wave synth — intentionally a DIFFERENT family from the
    # recorded cozy foley above (a cozy pack has no arcade beeps to cut). Kept
    # short, peak-normalized, and mixed low by the sfx channel like every cue.
    synth_arcade()

    # ── Snake port SFX (owner's standalone Snake-game wavs) ─────────────────
    # Machine-specific sibling-repo path (see SNAKE_GAME_SOUND); skipped with a
    # warning if that tree is not present. Flappy's synth clips above stay put.
    curate_snake_sounds()

    # ── Verification table ──────────────────────────────────────────────────
    print("\nverification:")
    for f in sorted(os.listdir(OUT_DIR)):
        if not f.endswith(".ogg"):
            continue
        path = os.path.join(OUT_DIR, f)
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path],
            capture_output=True, text=True)
        dur = float(json.loads(probe.stdout)["format"]["duration"])
        stat = subprocess.run(["sox", path, "-n", "stat"], capture_output=True, text=True).stderr
        amp = [line for line in stat.splitlines() if "Maximum amplitude" in line]
        print(f"  {f:22s} {dur:6.2f}s  {amp[0].strip() if amp else '?'}  {os.path.getsize(path)//1024}KB")

    shutil.rmtree(TMP, ignore_errors=True)


# Individually runnable steps for `--only` (see the module docstring).
STEPS = {
    "arcade": synth_arcade,
    "board": curate_board,
    "portal": curate_portal_transitions,
    "music": curate_music_pool,
    "snake": curate_snake_sounds,
}


if __name__ == "__main__":
    argv = sys.argv[1:]
    if argv and argv[0] == "--only":
        if len(argv) < 2:
            sys.exit(f"--only needs a step list (known: {', '.join(sorted(STEPS))})")
        os.makedirs(OUT_DIR, exist_ok=True)
        for step in argv[1].split(","):
            fn = STEPS.get(step)
            if fn is None:
                sys.exit(f"unknown step {step!r} (known: {', '.join(sorted(STEPS))})")
            print(f"step: {step}")
            fn()
        shutil.rmtree(TMP, ignore_errors=True)
    elif argv:
        sys.exit(f"unknown arguments: {' '.join(argv)}")
    else:
        main()
