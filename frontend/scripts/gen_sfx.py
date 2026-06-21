#!/usr/bin/env python3
"""Generate small placeholder UI sound effects as WAV files.

These are synthesized chimes so the app has working audio out of the box; swap
them for nicer clips (e.g. from itch.io) by dropping same-named files in
public/assets/audio/. Mono, 22.05 kHz, 16-bit.
"""
import math
import os
import struct
import wave

RATE = 22050


def tone(freq, dur, vol=0.5, decay=6.0):
    """A single sine note with an exponential decay envelope."""
    n = int(RATE * dur)
    out = []
    for i in range(n):
        t = i / RATE
        env = math.exp(-decay * t)
        out.append(vol * env * math.sin(2 * math.pi * freq * t))
    return out


def seq(notes):
    """Concatenate (freq, dur, vol) notes into one sample buffer."""
    buf = []
    for spec in notes:
        buf.extend(tone(*spec))
    return buf


def write(name, samples):
    path = os.path.join(OUT, name)
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        frames = b"".join(
            struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767)) for s in samples
        )
        w.writeframes(frames)
    print("wrote", path, f"({len(samples)/RATE:.2f}s)")


OUT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "public", "assets", "audio")
)
os.makedirs(OUT, exist_ok=True)

# message: soft two-note rise
write("message.wav", seq([(660, 0.10, 0.35), (880, 0.18, 0.35)]))
# join: bright ascending arpeggio
write("join.wav", seq([(523, 0.08, 0.4), (659, 0.08, 0.4), (784, 0.16, 0.4)]))
# leave: gentle descending pair
write("leave.wav", seq([(659, 0.10, 0.35), (440, 0.18, 0.35)]))
# sit: short low blip
write("sit.wav", seq([(392, 0.12, 0.35, 9.0)]))
