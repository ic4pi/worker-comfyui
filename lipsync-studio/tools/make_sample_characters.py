#!/usr/bin/env python3
"""Generate the sample character rigs shipped with Lip Sync Studio.

Produces, for each character, four angle bodies (front / three_quarter / side /
back) plus a mouth sprite per viseme for every angle that shows a mouth, and a
rig.json manifest tying them together.

Run:  python3 tools/make_sample_characters.py
"""
import json
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "characters")

# Canvas for a full-body sprite. Feet sit on ANCHOR_Y so the stage can plant the
# character on the ground plane without per-asset fiddling.
W, H = 512, 1024
ANCHOR = (256, 1000)
MOUTH_BOX = (140, 100)

VISEMES = ["rest", "MBP", "FV", "TH", "L", "WQ", "E", "AI", "O", "U"]

# Per-angle framing: mouth anchor point on the body, mouth width scale, and how
# far the face is turned (drives feature offsets).
ANGLES = {
    "front": dict(mouth=(256, 312), mw=1.00, mouth_visible=True),
    "three_quarter": dict(mouth=(286, 314), mw=0.82, mouth_visible=True),
    "side": dict(mouth=(312, 316), mw=0.55, mouth_visible=True),
    "back": dict(mouth=(256, 312), mw=1.00, mouth_visible=False),
}

CHARACTERS = [
    dict(id="ava", name="Ava", skin="#f0c9a4", hair="#3b2a26", shirt="#3f6ea8",
         pants="#2b3a4a", shoe="#20232a", height_units=1.68),
    dict(id="miles", name="Miles", skin="#8d5a3b", hair="#1d1512", shirt="#c2542f",
         pants="#3a3f46", shoe="#191c21", height_units=1.82),
]


def svg(body, w=W, h=H):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
            f'width="{w}" height="{h}">{body}</svg>')


def shade(hex_colour, factor):
    """Darken (factor < 1) a #rrggbb colour - used for limbs on the far side of
    the body, which read better as a darker tone than a translucent overlay."""
    r, g, b = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    return "#%02x%02x%02x" % tuple(min(255, int(v * factor)) for v in (r, g, b))


def head(c, cx, cy, rx, ry, angle_name):
    """Head, hair and face for one angle. Hair is a full ellipse with the face
    laid on top and shifted down, which leaves a natural cap and side rim."""
    skin, hair = c["skin"], c["hair"]
    parts = [f'<ellipse cx="{cx}" cy="{cy - 8}" rx="{rx + 4}" ry="{ry + 4}" fill="{hair}"/>']
    if angle_name == "back":
        parts.append(f'<ellipse cx="{cx}" cy="{cy - 2}" rx="{rx}" ry="{ry}" fill="{hair}"/>')
        parts.append(f'<path d="M{cx - rx * 0.5:.0f} {cy + ry * 0.55:.0f} q{rx * 0.5:.0f} {ry * 0.3:.0f} {rx:.0f} 0" '
                     f'fill="none" stroke="#00000022" stroke-width="7"/>')
        return parts

    # Face sits lower and inset, so hair reads as a cap rather than a headband.
    face_dx = {"front": 0, "three_quarter": 12, "side": 20}[angle_name]
    parts.append(f'<ellipse cx="{cx + face_dx}" cy="{cy + 14}" rx="{rx - 6}" ry="{ry - 12}" fill="{skin}"/>')
    # ear
    ear_x = {"front": cx - rx + 8, "three_quarter": cx - rx + 22, "side": cx - 14}[angle_name]
    parts.append(f'<circle cx="{ear_x:.0f}" cy="{cy + 16}" r="17" fill="{skin}"/>')
    if angle_name == "front":
        parts.append(f'<circle cx="{cx + rx - 8:.0f}" cy="{cy + 16}" r="17" fill="{skin}"/>')

    # eyes: both for front, both crowded right for 3/4, one for profile
    eyes = {"front": [-34, 34], "three_quarter": [-10, 48], "side": [44]}[angle_name]
    for dx in eyes:
        ex = cx + face_dx + dx
        parts.append(f'<ellipse cx="{ex:.0f}" cy="{cy + 4}" rx="13" ry="15" fill="#ffffff"/>')
        parts.append(f'<circle cx="{ex + 2:.0f}" cy="{cy + 6}" r="7" fill="#20232a"/>')
        parts.append(f'<rect x="{ex - 16:.0f}" y="{cy - 28}" width="32" height="8" rx="4" fill="{hair}"/>')

    # nose, drawn as a silhouette bump once the head turns
    if angle_name == "front":
        nose_x = cx + face_dx
        parts.append(f'<path d="M{nose_x:.0f} {cy + 20} q10 20 -6 26" fill="none" '
                     f'stroke="#00000030" stroke-width="6" stroke-linecap="round"/>')
    else:
        # Break the silhouette so the turn reads at a glance.
        tip = cx + face_dx + (rx - 6) + {"three_quarter": 12, "side": 24}[angle_name]
        parts.append(f'<path d="M{tip - 34:.0f} {cy + 2} L{tip:.0f} {cy + 26} L{tip - 34:.0f} {cy + 44} Z" fill="{skin}"/>')
    return parts


def body_svg(c, angle_name, a):
    """One full-body sprite, mouthless - the mouth is composited at runtime.

    Geometry is written out per angle rather than derived from a single turn
    parameter, because a believable profile is a different drawing, not a
    squashed front view."""
    skin, hair, shirt, pants, shoe = c["skin"], c["hair"], c["shirt"], c["pants"], c["shoe"]
    p = []

    if angle_name == "side":
        # Facing +x. One arm and one leg carry the whole silhouette.
        p.append(f'<rect x="234" y="660" width="44" height="320" rx="20" fill="{shade(pants, 0.72)}"/>')  # far leg
        p.append(f'<ellipse cx="268" cy="978" rx="46" ry="20" fill="{shade(shoe, 0.7)}"/>')
        p.append(f'<rect x="222" y="400" width="96" height="290" rx="34" fill="{shirt}"/>')
        p.append(f'<rect x="246" y="660" width="46" height="320" rx="21" fill="{pants}"/>')
        p.append(f'<ellipse cx="290" cy="978" rx="52" ry="22" fill="{shoe}"/>')
        p.append(f'<rect x="252" y="412" width="40" height="240" rx="20" fill="{shirt}"/>')  # near arm
        p.append(f'<circle cx="272" cy="664" r="21" fill="{skin}"/>')
        p.append(f'<rect x="248" y="330" width="42" height="86" fill="{skin}"/>')
        p.extend(head(c, 262, 250, 96, 112, "side"))
        return svg("".join(p))

    if angle_name == "three_quarter":
        p.append(f'<rect x="206" y="660" width="46" height="320" rx="21" fill="{shade(pants, 0.72)}"/>')
        p.append(f'<ellipse cx="228" cy="978" rx="44" ry="20" fill="{shade(shoe, 0.7)}"/>')
        p.append(f'<rect x="252" y="660" width="48" height="320" rx="22" fill="{pants}"/>')
        p.append(f'<ellipse cx="284" cy="978" rx="50" ry="21" fill="{shoe}"/>')
        p.append(f'<path d="M196 404 Q262 378 330 404 L340 686 Q262 708 190 686 Z" fill="{shirt}"/>')
        p.append(f'<rect x="170" y="414" width="38" height="244" rx="19" fill="{shade(shirt, 0.78)}"/>')  # far arm
        p.append(f'<rect x="322" y="414" width="40" height="244" rx="20" fill="{shirt}"/>')
        p.append(f'<circle cx="189" cy="666" r="20" fill="{shade(skin, 0.82)}"/>')
        p.append(f'<circle cx="342" cy="666" r="21" fill="{skin}"/>')
        p.append(f'<rect x="240" y="330" width="44" height="86" fill="{skin}"/>')
        p.extend(head(c, 254, 250, 98, 112, "three_quarter"))
        return svg("".join(p))

    # front and back share a symmetric build
    p.append(f'<rect x="204" y="660" width="48" height="320" rx="22" fill="{pants}"/>')
    p.append(f'<rect x="260" y="660" width="48" height="320" rx="22" fill="{pants}"/>')
    p.append(f'<ellipse cx="224" cy="978" rx="46" ry="21" fill="{shoe}"/>')
    p.append(f'<ellipse cx="288" cy="978" rx="46" ry="21" fill="{shoe}"/>')
    p.append(f'<path d="M176 404 Q256 376 336 404 L346 688 Q256 710 166 688 Z" fill="{shirt}"/>')
    p.append(f'<rect x="138" y="414" width="40" height="246" rx="20" fill="{shirt}"/>')
    p.append(f'<rect x="334" y="414" width="40" height="246" rx="20" fill="{shirt}"/>')
    p.append(f'<circle cx="158" cy="668" r="21" fill="{skin}"/>')
    p.append(f'<circle cx="354" cy="668" r="21" fill="{skin}"/>')
    p.append(f'<rect x="234" y="330" width="44" height="86" fill="{skin}"/>')
    p.extend(head(c, 256, 250, 100, 114, angle_name))
    return svg("".join(p))


def mouth_svg(c, viseme, mw):
    """A single viseme sprite, drawn inside MOUTH_BOX and centred on its middle."""
    bw, bh = MOUTH_BOX
    cx, cy = bw / 2, bh / 2
    lip = "#8c3f3f"
    inner = "#5a1f24"
    teeth = "#fdf6ee"
    tongue = "#c4676c"

    # (half-width, half-height, roundness) per viseme - roundness 1 = pursed.
    shape = {
        "rest": (30, 4, 0.0),
        "MBP":  (32, 3, 0.0),
        "FV":   (28, 7, 0.0),
        "TH":   (26, 13, 0.1),
        "L":    (26, 19, 0.1),
        "WQ":   (15, 15, 1.0),
        "E":    (38, 14, 0.0),
        "AI":   (34, 34, 0.2),
        "O":    (24, 26, 0.8),
        "U":    (14, 12, 1.0),
    }[viseme]
    hw, hh, round_ness = shape
    hw *= mw
    parts = []
    if hh <= 5:
        parts.append(f'<rect x="{cx - hw:.1f}" y="{cy - hh:.1f}" width="{hw * 2:.1f}" '
                     f'height="{hh * 2:.1f}" rx="{hh:.1f}" fill="{lip}"/>')
    else:
        parts.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{hw + 6:.1f}" ry="{hh + 6:.1f}" fill="{lip}"/>')
        parts.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{hw:.1f}" ry="{hh:.1f}" fill="{inner}"/>')
        if viseme in ("AI", "E", "L", "TH"):
            parts.append(f'<path d="M{cx - hw:.1f} {cy - hh + 2:.1f} h{hw * 2:.1f} v7 h-{hw * 2:.1f} Z" fill="{teeth}"/>')
        if viseme in ("L", "TH"):
            ty = cy + (2 if viseme == "L" else hh - 4)
            parts.append(f'<ellipse cx="{cx}" cy="{ty:.1f}" rx="{hw * 0.55:.1f}" ry="7" fill="{tongue}"/>')
    if viseme == "FV":
        parts.append(f'<path d="M{cx - hw:.1f} {cy - 2:.1f} h{hw * 2:.1f} v6 h-{hw * 2:.1f} Z" fill="{teeth}"/>')
    if round_ness > 0.6:
        parts.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{hw + 9:.1f}" ry="{hh + 9:.1f}" '
                     f'fill="none" stroke="{lip}" stroke-width="6"/>')
    return svg("".join(parts), bw, bh)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)


def build(c):
    root = os.path.join(OUT, c["id"])
    manifest = {
        "id": c["id"],
        "name": c["name"],
        "heightUnits": c["height_units"],
        "anchor": list(ANCHOR),
        "angles": {},
    }
    for angle_name, a in ANGLES.items():
        write(os.path.join(root, angle_name, "body.svg"), body_svg(c, angle_name, a))
        entry = {
            "body": f"{angle_name}/body.svg",
            "mouth": list(a["mouth"]),
            "mouthSize": list(MOUTH_BOX),
            "visemes": {},
        }
        if a["mouth_visible"]:
            for v in VISEMES:
                rel = f"{angle_name}/mouth_{v}.svg"
                write(os.path.join(root, rel), mouth_svg(c, v, a["mw"]))
                entry["visemes"][v] = rel
        manifest["angles"][angle_name] = entry
    write(os.path.join(root, "rig.json"), json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    index = [build(c) for c in CHARACTERS]
    write(os.path.join(OUT, "index.json"),
          json.dumps([{"id": m["id"], "name": m["name"], "rig": f"{m['id']}/rig.json"}
                      for m in index], indent=2) + "\n")
    print(f"wrote {len(index)} sample rigs to assets/characters/")
