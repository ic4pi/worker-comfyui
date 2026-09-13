#!/usr/bin/env python3
"""Generate a wide three-layer sample backdrop.

The layers are deliberately much wider than the stage so the camera can pan
across them, and they are separated so the renderer can give each one its own
parallax factor.

Run:  python3 tools/make_sample_background.py
"""
import json
import os
import random

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "backgrounds", "boulevard")
W, H = 4096, 1536
HORIZON = 0.62  # fraction of H where the ground plane vanishes


def svg(body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
            f'width="{W}" height="{H}">{body}</svg>')


def far_layer():
    hy = H * HORIZON
    p = [f'<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">'
         f'<stop offset="0%" stop-color="#9fd0ef"/><stop offset="70%" stop-color="#dcecf7"/>'
         f'<stop offset="100%" stop-color="#f2e3cf"/></linearGradient></defs>',
         f'<rect width="{W}" height="{H}" fill="url(#sky)"/>']
    rnd = random.Random(7)
    for i in range(26):  # distant skyline
        bw = rnd.randint(120, 260)
        bh = rnd.randint(180, 520)
        x = i * (W / 26) + rnd.randint(-30, 30)
        p.append(f'<rect x="{x:.0f}" y="{hy - bh:.0f}" width="{bw}" height="{bh}" fill="#b8c6d4"/>')
    for i in range(9):  # clouds
        x = rnd.randint(0, W)
        y = rnd.randint(80, 420)
        p.append(f'<ellipse cx="{x}" cy="{y}" rx="{rnd.randint(90, 190)}" ry="{rnd.randint(30, 60)}" fill="#ffffffcc"/>')
    return svg("".join(p))


def mid_layer():
    hy = H * HORIZON
    p = ['<g>']
    rnd = random.Random(21)
    palette = ["#d9b08c", "#c98a72", "#8fae9a", "#c7b199", "#9aa7c0"]
    for i in range(18):  # street-facing storefronts
        bw = rnd.randint(180, 300)
        bh = rnd.randint(280, 620)
        x = i * (W / 18) + rnd.randint(-20, 20)
        col = palette[i % len(palette)]
        p.append(f'<rect x="{x:.0f}" y="{hy - bh:.0f}" width="{bw}" height="{bh}" fill="{col}"/>')
        for r in range(int(bh // 110)):  # windows
            for cc in range(int(bw // 80)):
                p.append(f'<rect x="{x + 26 + cc * 80:.0f}" y="{hy - bh + 40 + r * 110:.0f}" '
                         f'width="44" height="62" rx="4" fill="#3d4a5a" opacity="0.75"/>')
        p.append(f'<rect x="{x - 8:.0f}" y="{hy - bh - 18:.0f}" width="{bw + 16}" height="22" fill="#00000022"/>')
    p.append('</g>')
    return svg("".join(p))


def near_layer():
    hy = H * HORIZON
    p = [f'<rect x="0" y="{hy:.0f}" width="{W}" height="{H - hy:.0f}" fill="#6f6a63"/>',
         f'<rect x="0" y="{hy:.0f}" width="{W}" height="34" fill="#8c884f"/>',
         f'<rect x="0" y="{H - 120:.0f}" width="{W}" height="120" fill="#5d5952"/>']
    rnd = random.Random(4)
    for i in range(int(W // 240)):  # lane dashes on the road
        p.append(f'<rect x="{i * 240 + 60}" y="{hy + 210:.0f}" width="120" height="12" rx="6" fill="#e8e2d4" opacity="0.8"/>')
    for i in range(11):  # street trees and lamps, foreground
        x = i * (W / 11) + rnd.randint(-40, 40)
        p.append(f'<rect x="{x:.0f}" y="{hy - 150:.0f}" width="18" height="170" fill="#5b4534"/>')
        p.append(f'<ellipse cx="{x + 9:.0f}" cy="{hy - 190:.0f}" rx="92" ry="72" fill="#4e7d56"/>')
        p.append(f'<ellipse cx="{x + 48:.0f}" cy="{hy - 150:.0f}" rx="66" ry="52" fill="#5c8d63"/>')
    return svg("".join(p))


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)


if __name__ == "__main__":
    write(os.path.join(OUT, "far.svg"), far_layer())
    write(os.path.join(OUT, "mid.svg"), mid_layer())
    write(os.path.join(OUT, "near.svg"), near_layer())
    write(os.path.join(OUT, "backdrop.json"), json.dumps({
        "name": "Boulevard",
        "width": W,
        "height": H,
        "horizon": HORIZON,
        "layers": [
            {"src": "far.svg", "parallax": 0.25},
            {"src": "mid.svg", "parallax": 0.55},
            {"src": "near.svg", "parallax": 1.0},
        ],
    }, indent=2) + "\n")
    print("wrote sample backdrop to assets/backgrounds/boulevard/")
