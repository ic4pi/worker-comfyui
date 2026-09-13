#!/usr/bin/env python3
"""Generate the bundled sound-effect bank.

These are the accent hits a comic-book style webisode leans on - the SLAP, the
whoosh, the sting under a title card. They are synthesised rather than sampled
so the whole kit ships with the project, with no licensing attached.

Run:  python3 tools/make_sfx.py
"""
import json
import math
import os
import random
import struct
import wave

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "sfx")
RATE = 22050


def write_wav(path, samples):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    peak = max(1e-6, max(abs(s) for s in samples))
    scale = 0.89 / peak
    frames = b"".join(struct.pack("<h", int(max(-1, min(1, s * scale)) * 32767)) for s in samples)
    with wave.open(path, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(RATE)
        fh.writeframes(frames)


def env(i, n, attack=0.005, decay=None, curve=3.0):
    """Percussive envelope: near-instant attack, exponential tail."""
    t = i / RATE
    total = n / RATE
    decay = decay if decay is not None else total
    if t < attack:
        return t / attack
    return math.exp(-curve * (t - attack) / max(1e-6, decay))


def noise_burst(seconds, curve, lowpass=0.0, seed=1):
    """Filtered noise - the backbone of slaps, whooshes and impacts."""
    rnd = random.Random(seed)
    n = int(RATE * seconds)
    out = []
    prev = 0.0
    for i in range(n):
        white = rnd.uniform(-1, 1)
        # One-pole lowpass; higher `lowpass` means duller.
        prev = prev * lowpass + white * (1 - lowpass)
        out.append(prev * env(i, n, curve=curve))
    return out


def sweep(seconds, f0, f1, curve=4.0, shape="sine"):
    n = int(RATE * seconds)
    out = []
    phase = 0.0
    for i in range(n):
        u = i / n
        f = f0 * (f1 / f0) ** u
        phase += 2 * math.pi * f / RATE
        v = math.sin(phase) if shape == "sine" else (2 * ((phase / (2 * math.pi)) % 1.0) - 1)
        out.append(v * env(i, n, curve=curve))
    return out


def mix(*layers):
    n = max(len(layer) for layer in layers)
    out = [0.0] * n
    for layer in layers:
        for i, v in enumerate(layer):
            out[i] += v
    return out


def slap():
    return mix(noise_burst(0.22, curve=26, lowpass=0.35, seed=7),
               [v * 0.6 for v in sweep(0.14, 900, 180, curve=22)])


def punch():
    return mix(sweep(0.34, 260, 52, curve=7),
               [v * 0.45 for v in noise_burst(0.12, curve=30, lowpass=0.6, seed=3)])


def whoosh():
    n = int(RATE * 0.55)
    rnd = random.Random(11)
    out = []
    prev = 0.0
    for i in range(n):
        u = i / n
        prev = prev * (0.5 + 0.45 * math.sin(math.pi * u)) + rnd.uniform(-1, 1) * 0.35
        # Swell in and out rather than a percussive hit.
        out.append(prev * math.sin(math.pi * u) ** 2)
    return out


def pop():
    return mix(sweep(0.09, 1400, 420, curve=30),
               [v * 0.3 for v in noise_burst(0.04, curve=40, lowpass=0.2, seed=5)])


def ding():
    n = int(RATE * 0.9)
    out = [0.0] * n
    for partial, gain, decay in ((1320, 1.0, 0.30), (2640, 0.42, 0.20), (3960, 0.18, 0.13)):
        for i in range(n):
            out[i] += gain * math.sin(2 * math.pi * partial * i / RATE) * env(i, n, decay=decay, curve=3.2)
    return out


def boing():
    n = int(RATE * 0.5)
    out = []
    phase = 0.0
    for i in range(n):
        u = i / n
        f = 300 * (1 - 0.55 * u) * (1 + 0.35 * math.sin(2 * math.pi * 11 * u))
        phase += 2 * math.pi * f / RATE
        out.append(math.sin(phase) * env(i, n, curve=4.5))
    return out


def zap():
    return mix(sweep(0.3, 2000, 140, curve=8, shape="saw"),
               [v * 0.4 for v in noise_burst(0.18, curve=16, lowpass=0.1, seed=13)])


def thud():
    return mix(sweep(0.42, 130, 38, curve=6),
               [v * 0.3 for v in noise_burst(0.1, curve=26, lowpass=0.8, seed=17)])


def sting():
    """Short dramatic chord for a title card or reveal."""
    n = int(RATE * 1.1)
    out = [0.0] * n
    for f, gain in ((196, 0.9), (233, 0.7), (294, 0.6), (392, 0.4)):
        for i in range(n):
            out[i] += gain * math.sin(2 * math.pi * f * i / RATE) * env(i, n, attack=0.01, decay=0.45, curve=3.0)
    return out


BANK = [
    ("slap", "Slap", slap),
    ("punch", "Punch", punch),
    ("thud", "Thud", thud),
    ("whoosh", "Whoosh", whoosh),
    ("pop", "Pop", pop),
    ("ding", "Ding", ding),
    ("boing", "Boing", boing),
    ("zap", "Zap", zap),
    ("sting", "Sting", sting),
]


if __name__ == "__main__":
    index = []
    for key, name, build in BANK:
        samples = build()
        write_wav(os.path.join(OUT, f"{key}.wav"), samples)
        index.append({"id": key, "name": name, "src": f"{key}.wav",
                      "seconds": round(len(samples) / RATE, 3)})
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "index.json"), "w") as fh:
        json.dump(index, fh, indent=2)
        fh.write("\n")
    print(f"wrote {len(index)} sound effects to assets/sfx/")
