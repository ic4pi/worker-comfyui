#!/usr/bin/env python3
"""Generate the shared mouth kits.

A kit is one set of mouth drawings used by any number of characters - the point
being that mouths are not per-character art. A character picks a kit and tints /
scales / positions it; only characters whose mouth is a defining trait need
their own drawings.

Human kits cover 8 shapes across 3 angles. Animal kits cover the same 8 names so
nothing has to fall back, but they are built from fewer real jaw positions,
because a muzzle or a beak only hinges.

Run:  python3 tools/make_mouth_kits.py
"""
import json
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "mouths")

VISEMES = ["rest", "MBP", "FV", "TH", "L", "WQ", "E", "AI", "O", "U"]

# (half width, half height, roundness) - roundness 1 means pursed/protruded.
HUMAN_SHAPES = {
    "rest": (30, 4, 0.0),
    "MBP": (32, 3, 0.0),
    "FV": (28, 7, 0.0),
    "TH": (26, 13, 0.1),
    "L": (26, 19, 0.1),
    "WQ": (15, 15, 1.0),
    "E": (38, 14, 0.0),
    "AI": (34, 34, 0.2),
    "O": (24, 26, 0.8),
    "U": (14, 12, 1.0),
}

# How far the jaw drops, 0 = shut. Animals get this instead of lip shaping.
JAW = {
    "rest": 0.0, "MBP": 0.0, "FV": 0.12, "TH": 0.3, "L": 0.45,
    "WQ": 0.25, "E": 0.35, "AI": 1.0, "O": 0.6, "U": 0.2,
}

# Per-angle horizontal squash. Humans foreshorten hard in profile; muzzles and
# beaks are the opposite - profile is their fullest view.
HUMAN_ANGLE_W = {"front": 1.00, "three_quarter": 0.82, "side": 0.55}
SNOUT_ANGLE_W = {"front": 0.72, "three_quarter": 0.90, "side": 1.00}

KITS = [
    dict(id="female", name="Female", kind="human", box=(140, 100),
         lip="#b0555f", inner="#57202a", teeth="#fdf6ee", tongue="#c4676c",
         wide=0.88, tall=1.05, lip_thickness=8),
    dict(id="male", name="Male", kind="human", box=(140, 100),
         lip="#8a544a", inner="#4e1d1d", teeth="#fdf6ee", tongue="#bc6166",
         wide=1.06, tall=0.94, lip_thickness=5),
    dict(id="muzzle", name="Muzzle (dog / cat / horse)", kind="muzzle", box=(190, 150),
         fur="#b98b5e", inner="#4a1d22", teeth="#fdf6ee", tongue="#d0747a", nose="#2b2429"),
    dict(id="beak", name="Beak (bird)", kind="beak", box=(170, 140),
         upper="#e0a22c", lower="#c88a1e", inner="#7a3a34", tongue="#c4676c"),
    # Elementary-age faces are smaller, so the mouth is scaled and simplified.
    # Boys and girls share it - at this age the drawing is the same.
    dict(id="kid", name="Kid (shared boy / girl)", kind="human", box=(110, 84),
         lip="#a85a5f", inner="#521f26", teeth="#fdf6ee", tongue="#c97b80",
         wide=0.82, tall=0.86, lip_thickness=6),
    # Babies only ever need shut or wailing, so this kit has two real states.
    dict(id="baby", name="Baby (open / closed)", kind="simple", box=(120, 100),
         lip="#c9707a", inner="#5e2028", tongue="#d4838a"),
]


def shade_hex(hex_colour, factor):
    """Darken a #rrggbb colour - the lower jaw reads better a shade down."""
    r, g, b = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    return "#%02x%02x%02x" % tuple(min(255, int(v * factor)) for v in (r, g, b))


def svg(body, w, h):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
            f'width="{w}" height="{h}">{body}</svg>')


def human_mouth(kit, viseme, angle_w):
    bw, bh = kit["box"]
    cx, cy = bw / 2, bh / 2
    hw, hh, roundness = HUMAN_SHAPES[viseme]
    hw *= kit["wide"] * angle_w
    hh *= kit["tall"]
    lip, inner, teeth, tongue = kit["lip"], kit["inner"], kit["teeth"], kit["tongue"]
    thick = kit["lip_thickness"]
    p = []

    if hh <= 5:
        p.append(f'<rect x="{cx - hw:.1f}" y="{cy - hh - thick / 3:.1f}" width="{hw * 2:.1f}" '
                 f'height="{hh * 2 + thick / 1.5:.1f}" rx="{hh + thick / 3:.1f}" fill="{lip}"/>')
    else:
        p.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{hw + thick:.1f}" ry="{hh + thick:.1f}" fill="{lip}"/>')
        p.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{hw:.1f}" ry="{hh:.1f}" fill="{inner}"/>')
        if viseme in ("AI", "E", "L", "TH"):
            p.append(f'<path d="M{cx - hw:.1f} {cy - hh + 2:.1f} h{hw * 2:.1f} v7 h-{hw * 2:.1f} Z" fill="{teeth}"/>')
        if viseme in ("L", "TH"):
            ty = cy + (2 if viseme == "L" else hh - 4)
            p.append(f'<ellipse cx="{cx}" cy="{ty:.1f}" rx="{hw * 0.55:.1f}" ry="7" fill="{tongue}"/>')
    if viseme == "FV":
        p.append(f'<path d="M{cx - hw:.1f} {cy - 2:.1f} h{hw * 2:.1f} v6 h-{hw * 2:.1f} Z" fill="{teeth}"/>')
    if roundness > 0.6:
        p.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{hw + thick + 4:.1f}" ry="{hh + thick + 4:.1f}" '
                 f'fill="none" stroke="{lip}" stroke-width="{thick - 1}"/>')
    return svg("".join(p), bw, bh)


def muzzle_mouth(kit, viseme, angle_w):
    """A snout, drawn in profile pointing right. Hinged at the back corner like
    a real jaw: the upper jaw is fixed and the lower one swings away from it,
    with the mouth cavity filling the wedge between them."""
    bw, bh = kit["box"]
    hinge_x, cy = bw * 0.16, bh * 0.46
    length = bw * 0.74 * angle_w
    drop = JAW[viseme] * bh * 0.30
    depth = bh * 0.20
    fur, inner, teeth, tongue, nose = kit["fur"], kit["inner"], kit["teeth"], kit["tongue"], kit["nose"]
    tip = hinge_x + length
    p = []

    if drop > 2:
        p.append(f'<path d="M{hinge_x:.1f} {cy:.1f} L{tip - 6:.1f} {cy - drop * 0.25:.1f} '
                 f'L{tip - 6:.1f} {cy + drop:.1f} Z" fill="{inner}"/>')
        p.append(f'<path d="M{hinge_x + 8:.1f} {cy + 2:.1f} L{hinge_x + length * 0.6:.1f} '
                 f'{cy + drop * 0.5:.1f} L{hinge_x + 8:.1f} {cy + drop * 0.8:.1f} Z" fill="{tongue}"/>')

    # upper jaw - fixed, with a rounded snout bridge
    p.append(f'<path d="M{hinge_x:.1f} {cy - depth:.1f} Q{hinge_x + length * 0.55:.1f} '
             f'{cy - depth * 1.5:.1f} {tip:.1f} {cy - drop * 0.25 - depth * 0.35:.1f} '
             f'L{tip:.1f} {cy - drop * 0.25:.1f} L{hinge_x:.1f} {cy:.1f} Z" fill="{fur}"/>')
    # lower jaw - swings down from the same hinge
    p.append(f'<path d="M{hinge_x:.1f} {cy:.1f} L{tip - 10:.1f} {cy + drop:.1f} '
             f'Q{hinge_x + length * 0.5:.1f} {cy + drop + depth:.1f} {hinge_x:.1f} '
             f'{cy + depth * 0.9:.1f} Z" fill="{shade_hex(fur, 0.88)}"/>')
    if drop > 8:
        p.append(f'<path d="M{tip - 26:.1f} {cy - drop * 0.22:.1f} l7 13 l-13 1 Z" fill="{teeth}"/>')
        p.append(f'<path d="M{tip - 30:.1f} {cy + drop * 0.92:.1f} l6 -12 l-12 -1 Z" fill="{teeth}"/>')
    p.append(f'<ellipse cx="{tip - 4:.1f} " cy="{cy - drop * 0.25 - depth * 0.2:.1f}" '
             f'rx="{bh * 0.09:.1f}" ry="{bh * 0.07:.1f}" fill="{nose}"/>')
    return svg("".join(p), bw, bh)


def beak_mouth(kit, viseme, angle_w):
    """A beak only hinges - three real positions dressed up as eight names."""
    bw, bh = kit["box"]
    cx, cy = bw * 0.34, bh / 2
    drop = JAW[viseme] * bh * 0.30
    length = bw * 0.58 * angle_w
    upper, lower, inner, tongue = kit["upper"], kit["lower"], kit["inner"], kit["tongue"]
    p = []
    if drop > 2:
        p.append(f'<path d="M{cx:.1f} {cy:.1f} L{cx + length:.1f} {cy - drop * 0.5:.1f} '
                 f'L{cx + length:.1f} {cy + drop:.1f} Z" fill="{inner}"/>')
        p.append(f'<path d="M{cx + 8:.1f} {cy + 2:.1f} L{cx + length * 0.55:.1f} {cy + drop * 0.4:.1f} '
                 f'L{cx + 8:.1f} {cy + drop * 0.6:.1f} Z" fill="{tongue}"/>')
    p.append(f'<path d="M{cx:.1f} {cy - bh * 0.17:.1f} L{cx + length:.1f} {cy - drop * 0.5:.1f} '
             f'L{cx:.1f} {cy:.1f} Z" fill="{upper}"/>')
    p.append(f'<path d="M{cx:.1f} {cy:.1f} L{cx + length:.1f} {cy + drop:.1f} '
             f'L{cx:.1f} {cy + bh * 0.15 + drop * 0.5:.1f} Z" fill="{lower}"/>')
    return svg("".join(p), bw, bh)


def simple_mouth(kit, viseme, angle_w):
    """Two states dressed up as eight names: shut, or open and howling."""
    bw, bh = kit["box"]
    cx, cy = bw / 2, bh / 2
    open_amount = 1.0 if JAW[viseme] >= 0.3 else 0.0
    lip, inner, tongue = kit["lip"], kit["inner"], kit["tongue"]
    if not open_amount:
        hw = bw * 0.22 * angle_w
        return svg(f'<rect x="{cx - hw:.1f}" y="{cy - 4:.1f}" width="{hw * 2:.1f}" '
                   f'height="8" rx="4" fill="{lip}"/>', bw, bh)
    hw = bw * 0.20 * angle_w
    hh = bh * 0.26
    return svg(
        f'<ellipse cx="{cx}" cy="{cy}" rx="{hw + 6:.1f}" ry="{hh + 6:.1f}" fill="{lip}"/>'
        f'<ellipse cx="{cx}" cy="{cy}" rx="{hw:.1f}" ry="{hh:.1f}" fill="{inner}"/>'
        f'<ellipse cx="{cx}" cy="{cy + hh * 0.45:.1f}" rx="{hw * 0.6:.1f}" ry="{hh * 0.3:.1f}" fill="{tongue}"/>',
        bw, bh)


BUILDERS = {"human": human_mouth, "muzzle": muzzle_mouth, "beak": beak_mouth, "simple": simple_mouth}


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)


def build(kit):
    root = os.path.join(OUT, kit["id"])
    build_one = BUILDERS[kit["kind"]]
    widths = HUMAN_ANGLE_W if kit["kind"] in ("human", "simple") else SNOUT_ANGLE_W
    manifest = {"id": kit["id"], "name": kit["name"], "kind": kit["kind"],
                "box": list(kit["box"]), "angles": {}}
    for angle, angle_w in widths.items():
        visemes = {}
        for v in VISEMES:
            rel = f"{angle}/{v}.svg"
            write(os.path.join(root, rel), build_one(kit, v, angle_w))
            visemes[v] = rel
        manifest["angles"][angle] = {"visemes": visemes}
    # A character seen from behind shows no mouth at all.
    write(os.path.join(root, "kit.json"), json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    built = [build(k) for k in KITS]
    write(os.path.join(OUT, "index.json"),
          json.dumps([{"id": m["id"], "name": m["name"], "kind": m["kind"],
                       "kit": f"{m['id']}/kit.json"} for m in built], indent=2) + "\n")
    print(f"wrote {len(built)} mouth kits to assets/mouths/")
