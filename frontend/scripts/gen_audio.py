#!/usr/bin/env python3
"""Generate the curated game soundscape as small, normalized .ogg clips.

The event SFX (door, footstep, portal, chimes, presence) are synthesized here
rather than shipped from a foley pack: the delivered asset packs contained a
cozy *music* pack (used for the music bed, see below) but no door/footstep/
portal foley, so these are tastefully synthesized, peak-normalized to a
consistent target, and transcoded to Ogg Vorbis. Swap any clip by dropping a
same-named .ogg in public/assets/audio/ and updating the attribution manifest.

The music bed is transcoded from LiivingGameaudio's free "Cozy Game Sound Pack
1" (Ogg Opus source) to a small looping .ogg — see ATTRIBUTIONS.md.

Run:  python3 scripts/gen_audio.py [--music /path/to/cozy/loop.opus]
Requires: numpy, ffmpeg on PATH.
"""
import argparse
import os
import subprocess
import tempfile
import wave

import numpy as np

RATE = 44100
OUT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "public", "assets", "audio")
)


def _fade(sig, ms=6):
    n = int(RATE * ms / 1000)
    n = min(n, len(sig) // 2)
    if n <= 0:
        return sig
    env = np.ones(len(sig))
    env[:n] = np.linspace(0, 1, n)
    env[-n:] = np.linspace(1, 0, n)
    return sig * env


def _norm(sig, peak_db=-3.0):
    peak = np.max(np.abs(sig)) or 1.0
    target = 10 ** (peak_db / 20.0)
    return sig * (target / peak)


def _write_ogg(name, sig, loop=False, bitrate="72k"):
    sig = _norm(_fade(sig, 2 if loop else 6))
    pcm = np.clip(sig, -1.0, 1.0)
    pcm16 = (pcm * 32767).astype("<i2")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = tmp.name
    with wave.open(wav_path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm16.tobytes())
    dst = os.path.join(OUT, name)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", wav_path,
         "-c:a", "libvorbis", "-b:a", bitrate, dst],
        check=True,
    )
    os.remove(wav_path)
    kb = os.path.getsize(dst) / 1024
    print(f"  {name:22s} {len(sig)/RATE:5.2f}s  {kb:6.1f} KB")


def t(dur):
    return np.linspace(0, dur, int(RATE * dur), endpoint=False)


def sine(freq, dur, decay=0.0):
    x = t(dur)
    s = np.sin(2 * np.pi * freq * x)
    if decay:
        s *= np.exp(-decay * x)
    return s


def bell(freq, dur, decay=5.0):
    """A soft bell: fundamental + a couple of inharmonic partials, decaying."""
    x = t(dur)
    env = np.exp(-decay * x)
    s = (
        1.00 * np.sin(2 * np.pi * freq * x)
        + 0.35 * np.sin(2 * np.pi * freq * 2.01 * x)
        + 0.18 * np.sin(2 * np.pi * freq * 3.02 * x)
    )
    return s * env


def noise(dur):
    return np.random.uniform(-1, 1, int(RATE * dur))


def lowpass(sig, cutoff):
    """One-pole lowpass — cheap, enough for shaping noise."""
    a = np.exp(-2 * np.pi * cutoff / RATE)
    out = np.empty_like(sig)
    prev = 0.0
    for i, v in enumerate(sig):
        prev = (1 - a) * v + a * prev
        out[i] = prev
    return out


def highpass(sig, cutoff):
    return sig - lowpass(sig, cutoff)


def pad(sig, dur):
    n = int(RATE * dur)
    return np.concatenate([sig, np.zeros(max(0, n - len(sig)))])[:n] if n > len(sig) else sig


def gen_sfx():
    print("SFX:")
    # message: soft two-note rise
    _write_ogg("message.ogg", np.concatenate([sine(660, 0.10, 6), sine(880, 0.18, 6)]) * 0.6)
    # join: bright ascending bell arpeggio
    _write_ogg("join.ogg", np.concatenate([bell(523, 0.10, 7), bell(659, 0.10, 7), bell(784, 0.22, 5)]) * 0.6)
    # leave: gentle descending pair
    _write_ogg("leave.ogg", np.concatenate([bell(659, 0.12, 7), bell(440, 0.24, 5)]) * 0.55)
    # sit: short low wooden blip
    _write_ogg("sit.ogg", (sine(300, 0.10, 12) + 0.4 * lowpass(noise(0.10), 800)) * 0.6)

    # footstep: brief soft filtered-noise tap
    step = highpass(lowpass(noise(0.07), 1400), 200) * np.exp(-40 * t(0.07))
    _write_ogg("footstep.ogg", step * 0.9)

    # door_open: low wooden creak that opens up + a soft latch click
    creak_f = 140 + 60 * t(0.42) / 0.42
    creak = np.sin(2 * np.pi * np.cumsum(creak_f) / RATE) * np.exp(-3.5 * t(0.42))
    creak += 0.3 * lowpass(noise(0.42), 500) * np.exp(-4 * t(0.42))
    click = pad(highpass(noise(0.02), 2000) * np.exp(-120 * t(0.02)), 0.02) * 0.5
    _write_ogg("door_open.ogg", np.concatenate([creak * 0.7, click]))
    # door_close: a firmer thud + latch
    thud = sine(120, 0.16, 22) + 0.5 * pad(lowpass(noise(0.10), 400) * np.exp(-30 * t(0.10)), 0.16)
    _write_ogg("door_close.ogg", np.concatenate([pad(thud, 0.16), click]) * 0.8)

    # portal_in: rising whoosh — band-limited noise swelling in, a pitch-swept
    # resonant tone, and a shimmer tail.
    dur = 0.75
    x = t(dur)
    air = highpass(lowpass(noise(dur), 3000), 400)
    swell = (x / dur) ** 1.3 * np.exp(-1.2 * np.maximum(0, x - 0.5))
    sweep_f = 220 + 1400 * (x / dur) ** 2
    tone = np.sin(2 * np.pi * np.cumsum(sweep_f) / RATE) * swell * 0.4
    shimmer = 0.25 * bell(880, dur, 3.0) * (x / dur)
    _write_ogg("portal_in.ogg", (air * swell * 1.4 + tone + shimmer))
    # portal_out: the same whoosh reversed (falling)
    _write_ogg("portal_out.ogg", (air * swell * 1.4 + tone + shimmer)[::-1].copy())

    # meeting_join: warm three-note major chime
    mj = np.concatenate([bell(523, 0.12, 6), bell(659, 0.12, 6), bell(880, 0.30, 4)])
    _write_ogg("meeting_join.ogg", mj * 0.6)
    # meeting_leave: two-note soft descending chime
    ml = np.concatenate([bell(784, 0.14, 6), bell(523, 0.30, 4)])
    _write_ogg("meeting_leave.ogg", ml * 0.55)


def gen_ambient():
    print("Ambient:")
    # 8s seamless soft-air/wind bed: filtered pink-ish noise with a slow LFO.
    dur = 8.0
    x = t(dur)
    base = lowpass(noise(dur), 350)
    gust = lowpass(noise(dur), 30)
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * x / dur)  # one full cycle -> seamless
    sig = base * (0.35 + 0.4 * (gust - gust.min()) / (np.ptp(gust) or 1)) * lfo
    # crossfade head/tail for a clean loop point
    n = int(RATE * 0.5)
    head, tail = sig[:n].copy(), sig[-n:].copy()
    ramp = np.linspace(0, 1, n)
    sig[:n] = head * ramp + tail * (1 - ramp)
    sig = sig[: len(sig) - n]
    _write_ogg("ambient_outdoor.ogg", sig * 0.9, loop=True, bitrate="64k")


def gen_music(src):
    if not src or not os.path.exists(src):
        print("Music: (no source supplied, skipping music bed)")
        return
    print("Music:")
    dst = os.path.join(OUT, "music_bed.ogg")
    # Transcode + trim to a small looping bed, downmix mono, modest bitrate.
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-t", "70",
         "-ac", "1", "-c:a", "libvorbis", "-b:a", "88k",
         "-af", "afade=t=in:st=0:d=1,afade=t=out:st=69:d=1", dst],
        check=True,
    )
    kb = os.path.getsize(dst) / 1024
    print(f"  music_bed.ogg          {kb:6.1f} KB")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--music", default="")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    np.random.seed(args.seed)
    os.makedirs(OUT, exist_ok=True)
    gen_sfx()
    gen_ambient()
    gen_music(args.music)
    print("done ->", OUT)
