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

The melodic notes are shifted -1 semitone so the UI chimes sit in the same key
family as the shipped music bed (`music_bed.ogg`, the pack's G# stem
6-Loop(without Drums)); the ambient bed's slowed D# stem is its dominant —
everything that can sound at once is consonant.

Requires: ffmpeg, sox, and the pack zip at repo-root Assets/ (untracked).
Run:  python3 scripts/curate_audio.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = os.path.join(HERE, "..", "..", "Assets", "Cozy Game Sound Pack 1.zip")
OUT_DIR = os.path.join(HERE, "..", "public", "assets", "audio")
PREFIX = "Cozy Game Sound Pack 1/"

STEMS = {
    "drums6": "6-G#-96 BPM/6-Drums Only.opus",
    "drums10": "10-C -65 BPM/10-FullLoop(Drums Only).opus",
    "drums2": "2-G-90 BPM/2-Loop(Drums Only).opus",
    "intro8": "8 - G- 80 BPM/8-Intro.opus",
    "intro9": "9 -F - 120 BPM/Loops(without Crash and Drums)/9-Intro(WO Drums).opus",
    "pad3": "3-D#-104 BPM/3-Loop(without Drums).opus",
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

    # ── Portals: reversed-shimmer swell into a deep boom (the "chill") ──────
    swell = fx(shimmer, "swell",
               "tempo", "-m", "0.35", "reverb", "60", "50", "80", "reverse",
               "trim", "0", "1.0", "fade", "0.35", "1.0", "0.02")
    p_boom = peak_normalize(
        fx(boom, "p_boom", "pitch", "-300", "lowpass", "420", "fade", "0", "0.4", "0.25"),
        "p_boom_n", -12)
    p_note_in = peak_normalize(fx(n_a5, "p_note_in", "reverb", "50", "50", "70"), "p_note_in_n", -15)
    portal_in = mix("portal_in_mix",
                    (peak_normalize(swell, "swell_n", -14), 0.0),
                    (p_boom, 0.92),
                    (p_note_in, 0.95))
    encode(peak_normalize(fx(portal_in, "portal_in_fx", "fade", "0", "2.0", "0.4"),
                          "portal_in_n", -11), "portal_in")

    # portal_out: the mirror — boom first, sparkle decays away downward.
    sparkle = fx(shimmer, "sparkle",
                 "tempo", "-m", "0.45", "reverb", "55", "50", "70",
                 "trim", "0", "1.2", "fade", "0.01", "1.2", "0.6")
    p_note_out = peak_normalize(fx(n_a4, "p_note_out", "reverb", "50", "50", "70"), "p_note_out_n", -15)
    portal_out = mix("portal_out_mix",
                     (p_boom, 0.0),
                     (peak_normalize(sparkle, "sparkle_n", -15), 0.05),
                     (p_note_out, 0.10))
    encode(peak_normalize(fx(portal_out, "portal_out_fx", "fade", "0", "1.6", "0.4"),
                          "portal_out_n", -12), "portal_out")

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


if __name__ == "__main__":
    main()
