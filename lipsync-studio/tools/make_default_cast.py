#!/usr/bin/env python3
"""Generate the default cast.

Ten character types across three skin tones. Every body is built from one
proportion-driven skeleton rather than hand-placed pixels, so a toddler and an
adult come out of the same code with different head-to-height ratios - which is
what actually reads as age in a cartoon.

None of these characters carry mouth art. They declare a mouth kit instead
(see tools/make_mouth_kits.py) and the renderer composites it, scaled to the
head size recorded in each rig.

Run:  python3 tools/make_default_cast.py
"""
import json
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "characters")

W, H = 512, 1024
FLOOR = 1000          # feet line; also the rig anchor
CX = W / 2
ANGLES = ["front", "three_quarter", "side", "back"]

# Head-to-height ratio is the single strongest age cue. Everything else is
# expressed as a fraction of the 1000px figure height.
AGES = {
    "baby":    dict(heads=4.2,  shoulder=0.300, hip=0.580, sh_w=0.100, hip_w=0.098, limb=0.034, metres=0.74),
    "child":   dict(heads=5.6,  shoulder=0.232, hip=0.525, sh_w=0.094, hip_w=0.086, limb=0.026, metres=1.26),
    "college": dict(heads=7.6,  shoulder=0.176, hip=0.500, sh_w=0.106, hip_w=0.092, limb=0.026, metres=1.73),
    "adult":   dict(heads=7.5,  shoulder=0.178, hip=0.500, sh_w=0.112, hip_w=0.098, limb=0.028, metres=1.74),
    "elder":   dict(heads=7.3,  shoulder=0.198, hip=0.515, sh_w=0.104, hip_w=0.100, limb=0.026, metres=1.67),
}

SKINS = {
    "beige": "#f2cfa8",
    "mixed": "#c58a5e",
    "brown": "#7d4d2e",
}
SKIN_NAMES = {"beige": "Beige", "mixed": "Mixed", "brown": "Brown"}

# Hair that suits each tone, so nobody ends up with an implausible combination.
HAIR_BY_TONE = {"beige": "#6b4526", "mixed": "#3b2a20", "brown": "#191114"}
GREY = "#b9b3ad"
WHITE_HAIR = "#ddd8d2"


def shade(hex_colour, factor):
    r, g, b = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    return "#%02x%02x%02x" % tuple(min(255, int(v * factor)) for v in (r, g, b))


def svg(body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
            f'width="{W}" height="{H}">{body}</svg>')


# --------------------------------------------------------------------- head

def head_parts(ch, m, angle):
    """Hair, face and features. Hair is a full ellipse with the face laid on top
    and shifted down, which reads as a hairline rather than a headband."""
    skin = SKINS[ch["tone"]]
    hair = ch["hair"]
    rx, ry, cy = m["head_rx"], m["head_ry"], m["head_cy"]
    style = ch["hair_style"]
    p = []

    # Skull, in hair colour except where the style is bald on top.
    p.append(f'<ellipse cx="{CX:.0f}" cy="{cy - ry * 0.06:.1f}" rx="{rx + 4:.1f}" ry="{ry + 4:.1f}" fill="{hair}"/>')
    if style == "receding":
        p.append(f'<ellipse cx="{CX:.0f}" cy="{cy - ry * 0.18:.1f}" rx="{rx * 0.88:.1f}" '
                 f'ry="{ry * 0.82:.1f}" fill="{skin}"/>')
    if style == "long":
        locks = [-1, 1] if angle != "side" else [-1]
        for side in locks:
            p.append(f'<ellipse cx="{CX + side * rx * 0.82:.1f}" cy="{cy + ry * 0.62:.1f}" '
                     f'rx="{rx * 0.34:.1f}" ry="{ry * 0.72:.1f}" fill="{hair}"/>')
    if style == "bun":
        p.append(f'<circle cx="{CX - rx * 0.86:.1f}" cy="{cy - ry * 0.72:.1f}" r="{rx * 0.34:.1f}" fill="{hair}"/>')

    if angle == "back":
        p.append(f'<ellipse cx="{CX:.0f}" cy="{cy:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="{hair}"/>')
        return p

    face_dx = {"front": 0, "three_quarter": rx * 0.13, "side": rx * 0.21}[angle]
    fx = CX + face_dx
    p.append(f'<ellipse cx="{fx:.1f}" cy="{cy + ry * 0.17:.1f}" rx="{rx * 0.86:.1f}" '
             f'ry="{ry * 0.83:.1f}" fill="{skin}"/>')
    if style == "receding":
        # Fringe of hair around the sides only.
        p.append(f'<path d="M{CX - rx:.1f} {cy + ry * 0.1:.1f} q{rx * 0.1:.1f} -{ry * 0.55:.1f} '
                 f'{rx * 0.42:.1f} -{ry * 0.62:.1f} q-{rx * 0.30:.1f} {ry * 0.28:.1f} '
                 f'-{rx * 0.12:.1f} {ry * 0.62:.1f} Z" fill="{hair}"/>')

    ear_x = {"front": CX - rx + 6, "three_quarter": CX - rx + rx * 0.34, "side": CX - rx * 0.16}[angle]
    p.append(f'<circle cx="{ear_x:.1f}" cy="{cy + ry * 0.16:.1f}" r="{rx * 0.17:.1f}" fill="{skin}"/>')
    if angle == "front":
        p.append(f'<circle cx="{CX + rx - 6:.1f}" cy="{cy + ry * 0.16:.1f}" r="{rx * 0.17:.1f}" fill="{skin}"/>')

    eyes = {"front": [-0.36, 0.36], "three_quarter": [-0.10, 0.50], "side": [0.46]}[angle]
    eye_r = rx * (0.17 if ch["age"] in ("baby", "child") else 0.13)
    for k in eyes:
        ex = fx + rx * k
        p.append(f'<ellipse cx="{ex:.1f}" cy="{cy + ry * 0.04:.1f}" rx="{eye_r:.1f}" '
                 f'ry="{eye_r * 1.12:.1f}" fill="#ffffff"/>')
        p.append(f'<circle cx="{ex + 2:.1f}" cy="{cy + ry * 0.06:.1f}" r="{eye_r * 0.54:.1f}" fill="#20232a"/>')
        if ch["age"] != "baby":
            p.append(f'<rect x="{ex - eye_r * 1.2:.1f}" y="{cy - ry * 0.24:.1f}" '
                     f'width="{eye_r * 2.4:.1f}" height="{ry * 0.06:.1f}" rx="3" fill="{ch["brow"]}"/>')

    if angle == "front":
        p.append(f'<path d="M{fx:.1f} {cy + ry * 0.2:.1f} q{rx * 0.11:.1f} {ry * 0.16:.1f} '
                 f'-{rx * 0.06:.1f} {ry * 0.2:.1f}" fill="none" stroke="#00000030" '
                 f'stroke-width="{max(4, rx * 0.06):.1f}" stroke-linecap="round"/>')
    else:
        tip = fx + (rx - 6) + rx * (0.12 if angle == "three_quarter" else 0.24)
        p.append(f'<path d="M{tip - rx * 0.34:.1f} {cy + ry * 0.02:.1f} L{tip:.1f} {cy + ry * 0.24:.1f} '
                 f'L{tip - rx * 0.34:.1f} {cy + ry * 0.4:.1f} Z" fill="{skin}"/>')

    # Age lines - cheap, but they do the work of reading as "older".
    if ch["age"] == "elder":
        p.append(f'<path d="M{fx - rx * 0.5:.1f} {cy + ry * 0.52:.1f} q{rx * 0.5:.1f} {ry * 0.1:.1f} '
                 f'{rx * 1.0:.1f} 0" fill="none" stroke="#00000022" stroke-width="4"/>')
    return p


# --------------------------------------------------------------------- body

def metrics(ch):
    a = AGES[ch["age"]]
    head_h = FLOOR / a["heads"]
    sh_w_mul = 0.90 if ch["sex"] == "female" else 1.0
    hip_w_mul = 1.10 if ch["sex"] == "female" else 1.0
    return dict(
        head_ry=head_h / 2,
        head_rx=head_h / 2 * (0.92 if ch["age"] == "baby" else 0.80),
        head_cy=head_h / 2,
        neck_y=head_h * 0.94,
        sh_y=FLOOR * a["shoulder"],
        hip_y=FLOOR * a["hip"],
        sh_half=FLOOR * a["sh_w"] * sh_w_mul,
        hip_half=FLOOR * a["hip_w"] * hip_w_mul,
        limb=FLOOR * a["limb"],
        metres=a["metres"],
    )


def legs_and_feet(ch, m, single=False):
    """Legs, or a robe/skirt hem where the outfit covers them."""
    p = []
    shoe = ch["shoe"]
    leg_w = m["limb"] * 1.8
    top = m["hip_y"] - 6
    gap = m["hip_half"] * 0.46
    if single:
        p.append(f'<rect x="{CX - leg_w / 2:.1f}" y="{top:.1f}" width="{leg_w:.1f}" '
                 f'height="{FLOOR - 22 - top:.1f}" rx="{leg_w / 2:.1f}" fill="{ch["pants"]}"/>')
        p.append(f'<ellipse cx="{CX + leg_w * 0.35:.1f}" cy="{FLOOR - 20:.0f}" rx="{leg_w * 0.95:.1f}" '
                 f'ry="{leg_w * 0.45:.1f}" fill="{shoe}"/>')
        return p
    for side in (-1, 1):
        x = CX + side * gap - leg_w / 2
        p.append(f'<rect x="{x:.1f}" y="{top:.1f}" width="{leg_w:.1f}" '
                 f'height="{FLOOR - 22 - top:.1f}" rx="{leg_w / 2:.1f}" fill="{ch["pants"]}"/>')
        p.append(f'<ellipse cx="{x + leg_w / 2:.1f}" cy="{FLOOR - 20:.0f}" rx="{leg_w * 0.88:.1f}" '
                 f'ry="{leg_w * 0.45:.1f}" fill="{shoe}"/>')
    return p


def torso(ch, m, half_top, half_bottom, hem):
    """Shirt, dress or cassock as one tapered slab."""
    return (f'<path d="M{CX - half_top:.1f} {m["sh_y"]:.1f} Q{CX:.0f} {m["sh_y"] - m["limb"] * 0.7:.1f} '
            f'{CX + half_top:.1f} {m["sh_y"]:.1f} L{CX + half_bottom:.1f} {hem:.1f} '
            f'Q{CX:.0f} {hem + m["limb"] * 0.6:.1f} {CX - half_bottom:.1f} {hem:.1f} Z" fill="{ch["shirt"]}"/>')


def body_svg(ch, angle):
    m = metrics(ch)
    skin = SKINS[ch["tone"]]
    p = []
    robe = ch["outfit"] == "cassock"
    dress = ch["outfit"] == "dress"
    hem = FLOOR - 30 if robe else (m["hip_y"] + (FLOOR - m["hip_y"]) * 0.42 if dress else m["hip_y"] + m["limb"])

    profile = angle == "side"
    sh_half = m["sh_half"] * (0.52 if profile else 1.0)
    hip_half = m["hip_half"] * (0.58 if profile else 1.0) if not robe else m["hip_half"] * 1.5

    # far-side limbs first, a shade down
    if not robe:
        if profile:
            p.append(f'<rect x="{CX - m["limb"] * 0.9:.1f}" y="{m["hip_y"] - 6:.1f}" '
                     f'width="{m["limb"] * 1.8:.1f}" height="{FLOOR - 22 - m["hip_y"]:.1f}" '
                     f'rx="{m["limb"] * 0.6:.1f}" fill="{shade(ch["pants"], 0.75)}"/>')
        elif angle == "three_quarter":
            p.append(f'<rect x="{CX - m["hip_half"] * 0.9:.1f}" y="{m["hip_y"] - 6:.1f}" '
                     f'width="{m["limb"] * 1.8:.1f}" height="{FLOOR - 22 - m["hip_y"]:.1f}" '
                     f'rx="{m["limb"] * 0.6:.1f}" fill="{shade(ch["pants"], 0.75)}"/>')

    if robe:
        p.append(torso(ch, m, sh_half, hip_half, hem))
    else:
        p.extend(legs_and_feet(ch, m, single=profile))
        if dress:
            waist = m["hip_y"] - (m["hip_y"] - m["sh_y"]) * 0.18
            flare = hip_half * (0.95 if profile else 1.35)
            p.append(f'<path d="M{CX - sh_half:.1f} {m["sh_y"]:.1f} Q{CX:.0f} {m["sh_y"] - m["limb"] * 0.7:.1f} '
                     f'{CX + sh_half:.1f} {m["sh_y"]:.1f} L{CX + hip_half * 0.86:.1f} {waist:.1f} '
                     f'L{CX + flare:.1f} {hem:.1f} Q{CX:.0f} {hem + m["limb"] * 0.8:.1f} '
                     f'{CX - flare:.1f} {hem:.1f} L{CX - hip_half * 0.86:.1f} {waist:.1f} Z" fill="{ch["shirt"]}"/>')
        else:
            p.append(torso(ch, m, sh_half, hip_half, hem))

    # arms
    arm_top = m["sh_y"] + m["limb"] * 0.2
    arm_bottom = m["hip_y"] + m["limb"] * (0.5 if dress else 1.4)
    arm_len = arm_bottom - arm_top
    # Sit the arm just outside the torso edge so it reads as a limb, not a seam.
    arm_x = sh_half + m["limb"] * 0.62
    sides = [1] if profile else [-1, 1]
    for side in sides:
        far = (side < 0 and angle == "three_quarter")
        colour = shade(ch["shirt"], 0.8) if far else ch["shirt"]
        hand = shade(skin, 0.84) if far else skin
        x = CX + side * arm_x - m["limb"] / 2
        p.append(f'<rect x="{x:.1f}" y="{arm_top:.1f}" width="{m["limb"]:.1f}" height="{arm_len:.1f}" '
                 f'rx="{m["limb"] / 2:.1f}" fill="{colour}"/>')
        p.append(f'<circle cx="{x + m["limb"] / 2:.1f}" cy="{arm_top + arm_len:.1f}" '
                 f'r="{m["limb"] * 0.62:.1f}" fill="{hand}"/>')

    # neck, then head
    p.append(f'<rect x="{CX - m["limb"] * 0.75:.1f}" y="{m["neck_y"]:.1f}" '
             f'width="{m["limb"] * 1.5:.1f}" height="{m["sh_y"] - m["neck_y"] + 8:.1f}" fill="{skin}"/>')
    if robe and angle != "back":
        p.append(f'<rect x="{CX - m["limb"] * 0.85:.1f}" y="{m["sh_y"] - m["limb"] * 0.5:.1f}" '
                 f'width="{m["limb"] * 1.7:.1f}" height="{m["limb"] * 0.6:.1f}" rx="4" fill="#ffffff"/>')
    p.extend(head_parts(ch, m, angle))
    return svg("".join(p))


# ------------------------------------------------------------------- roster

def role(key, name, age, sex, outfit, hair_style, shirt, pants, shoe, kit, grey=False):
    return dict(key=key, name=name, age=age, sex=sex, outfit=outfit,
                hair_style=hair_style, shirt=shirt, pants=pants, shoe=shoe,
                kit=kit, grey=grey)


ROLES = [
    role("elder_man", "Older man", "elder", "male", "pants", "receding", "#6d7f8c", "#4a4f57", "#2b2e33", "male", grey=True),
    role("elder_woman", "Older woman", "elder", "female", "dress", "bun", "#9a7fa5", "#5b5560", "#38343c", "female", grey=True),
    role("man", "Man", "adult", "male", "pants", "short", "#3f6ea8", "#2b3a4a", "#20232a", "male"),
    role("woman", "Woman", "adult", "female", "dress", "long", "#b8546b", "#4a3b47", "#2a2028", "female"),
    role("college_man", "College man", "college", "male", "pants", "short", "#4f9d69", "#39414d", "#23262c", "male"),
    role("college_woman", "College woman", "college", "female", "pants", "long", "#e08a3c", "#3d4550", "#24272d", "female"),
    role("boy", "Boy", "child", "male", "pants", "short", "#d6543f", "#3b4654", "#23262c", "male"),
    role("girl", "Girl", "child", "female", "dress", "long", "#57b2c4", "#46505e", "#262a30", "female"),
    role("baby", "Baby", "baby", "neutral", "pants", "short", "#f2e3a8", "#cfd6e0", "#e8e2d4", "baby"),
    role("priest", "Priest", "adult", "male", "cassock", "short", "#1c1c20", "#1c1c20", "#17171a", "male"),
]


def make_character(r, tone):
    hair = HAIR_BY_TONE[tone]
    if r["grey"]:
        hair = WHITE_HAIR if r["age"] == "elder" and r["sex"] == "female" else GREY
    return dict(
        id=f'{r["key"]}_{tone}',
        name=f'{r["name"]} ({SKIN_NAMES[tone]})',
        tone=tone, age=r["age"], sex=r["sex"], outfit=r["outfit"],
        hair=hair, brow=shade(hair, 0.9), hair_style=r["hair_style"],
        shirt=r["shirt"], pants=r["pants"], shoe=r["shoe"], kit=r["kit"],
        role=r["key"],
    )


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)


def build(ch):
    m = metrics(ch)
    root = os.path.join(OUT, ch["id"])
    manifest = {
        "id": ch["id"],
        "name": ch["name"],
        "role": ch["role"],
        "tone": ch["tone"],
        "heightUnits": round(m["metres"], 2),
        "anchor": [int(CX), FLOOR],
        "mouthKit": ch["kit"],
        "angles": {},
    }
    for angle in ANGLES:
        write(os.path.join(root, angle, "body.svg"), body_svg(ch, angle))
        face_dx = {"front": 0, "three_quarter": m["head_rx"] * 0.13,
                   "side": m["head_rx"] * 0.21, "back": 0}[angle]
        manifest["angles"][angle] = {
            "body": f"{angle}/body.svg",
            # Mouth sits on the lower face and is sized from the head, so a kit
            # mouth lands correctly on a toddler and on an adult alike.
            "mouth": [round(CX + face_dx, 1), round(m["head_cy"] + m["head_ry"] * 0.52, 1)],
            "mouthSize": [round(m["head_rx"] * 1.15, 1), round(m["head_rx"] * 0.8, 1)],
            "visemes": {},
        }
    write(os.path.join(root, "rig.json"), json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    built = []
    for r in ROLES:
        for tone in SKINS:
            built.append(build(make_character(r, tone)))
    write(os.path.join(OUT, "index.json"),
          json.dumps([{"id": m["id"], "name": m["name"], "role": m["role"],
                       "tone": m["tone"], "rig": f"{m['id']}/rig.json"} for m in built], indent=2) + "\n")
    print(f"wrote {len(built)} characters to assets/characters/")
