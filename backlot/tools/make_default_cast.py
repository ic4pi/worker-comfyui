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


def legs_and_feet(ch, m, single=False, bare_below=None):
    """Legs, feet, and - when the outfit is shorts - bare skin below the hem."""
    p = []
    skin = SKINS[ch["tone"]]
    shoe = ch["shoe"]
    leg_w = m["limb"] * 1.8
    top = m["hip_y"] - 6
    bottom = FLOOR - 22
    gap = m["hip_half"] * 0.46
    split = top + (bottom - top) * bare_below if bare_below else None
    xs = [CX] if single else [CX - gap, CX + gap]
    for cx in xs:
        x = cx - leg_w / 2
        p.append(f'<rect x="{x:.1f}" y="{top:.1f}" width="{leg_w:.1f}" '
                 f'height="{bottom - top:.1f}" rx="{leg_w / 2:.1f}" '
                 f'fill="{skin if split else ch["pants"]}"/>')
        if split:
            p.append(f'<rect x="{x:.1f}" y="{top:.1f}" width="{leg_w:.1f}" '
                     f'height="{split - top:.1f}" rx="{leg_w / 2:.1f}" fill="{ch["pants"]}"/>')
        rx = leg_w * (0.95 if single else 0.88)
        p.append(f'<ellipse cx="{cx + (leg_w * 0.35 if single else 0):.1f}" cy="{FLOOR - 20:.0f}" '
                 f'rx="{rx:.1f}" ry="{leg_w * 0.45:.1f}" fill="{shoe}"/>')
    return p


def torso(ch, m, half_top, half_bottom, hem):
    """Shirt, coat or robe as one tapered slab."""
    return (f'<path d="M{CX - half_top:.1f} {m["sh_y"]:.1f} Q{CX:.0f} {m["sh_y"] - m["limb"] * 0.7:.1f} '
            f'{CX + half_top:.1f} {m["sh_y"]:.1f} L{CX + half_bottom:.1f} {hem:.1f} '
            f'Q{CX:.0f} {hem + m["limb"] * 0.6:.1f} {CX - half_bottom:.1f} {hem:.1f} Z" fill="{ch["shirt"]}"/>')


def dress_shape(ch, m, half_top, hip_half, hem, profile):
    waist = m["hip_y"] - (m["hip_y"] - m["sh_y"]) * 0.18
    flare = hip_half * (0.95 if profile else 1.35)
    return (f'<path d="M{CX - half_top:.1f} {m["sh_y"]:.1f} Q{CX:.0f} {m["sh_y"] - m["limb"] * 0.7:.1f} '
            f'{CX + half_top:.1f} {m["sh_y"]:.1f} L{CX + hip_half * 0.86:.1f} {waist:.1f} '
            f'L{CX + flare:.1f} {hem:.1f} Q{CX:.0f} {hem + m["limb"] * 0.8:.1f} '
            f'{CX - flare:.1f} {hem:.1f} L{CX - hip_half * 0.86:.1f} {waist:.1f} Z" fill="{ch["shirt"]}"/>')


def accessories(ch, m, half_top, hem, angle):
    """Small marks that do most of the work of telling outfits apart."""
    p = []
    trim = ch["trim"]
    chest = m["sh_y"] + (hem - m["sh_y"]) * 0.10
    if angle == "back":
        if "hood" in ch["acc"]:
            p.append(f'<ellipse cx="{CX:.0f}" cy="{m["sh_y"] + m["limb"] * 0.2:.1f}" '
                     f'rx="{half_top * 0.62:.1f}" ry="{m["limb"] * 1.5:.1f}" fill="{trim}"/>')
        return p
    if "hood" in ch["acc"]:
        p.append(f'<ellipse cx="{CX:.0f}" cy="{m["sh_y"] + m["limb"] * 0.1:.1f}" '
                 f'rx="{half_top * 0.66:.1f}" ry="{m["limb"] * 1.3:.1f}" fill="{trim}"/>')
    if "lapels" in ch["acc"]:
        for side in (-1, 1):
            p.append(f'<path d="M{CX:.0f} {m["sh_y"]:.1f} L{CX + side * half_top * 0.62:.1f} '
                     f'{m["sh_y"] + m["limb"] * 0.3:.1f} L{CX:.0f} {chest + m["limb"] * 2.2:.1f} Z" fill="{trim}"/>')
    if "vneck" in ch["acc"]:
        p.append(f'<path d="M{CX - half_top * 0.46:.1f} {m["sh_y"] - m["limb"] * 0.2:.1f} '
                 f'L{CX:.0f} {chest + m["limb"] * 1.6:.1f} L{CX + half_top * 0.46:.1f} '
                 f'{m["sh_y"] - m["limb"] * 0.2:.1f} Z" fill="{trim}"/>')
    if "tie" in ch["acc"]:
        p.append(f'<path d="M{CX:.0f} {m["sh_y"] + m["limb"] * 0.2:.1f} l{m["limb"] * 0.42:.1f} {m["limb"] * 0.6:.1f} '
                 f'l-{m["limb"] * 0.42:.1f} {m["limb"] * 3.4:.1f} l-{m["limb"] * 0.42:.1f} -{m["limb"] * 3.4:.1f} Z" '
                 f'fill="{ch["tie"]}"/>')
    if "collar" in ch["acc"]:
        p.append(f'<rect x="{CX - m["limb"] * 0.85:.1f}" y="{m["sh_y"] - m["limb"] * 0.5:.1f}" '
                 f'width="{m["limb"] * 1.7:.1f}" height="{m["limb"] * 0.6:.1f}" rx="4" fill="#ffffff"/>')
    if "hivis" in ch["acc"]:
        for k in (0.32, 0.56):
            y = m["sh_y"] + (hem - m["sh_y"]) * k
            p.append(f'<rect x="{CX - half_top * 0.95:.1f}" y="{y:.1f}" width="{half_top * 1.9:.1f}" '
                     f'height="{m["limb"] * 0.55:.1f}" fill="{trim}"/>')
    if "buttons" in ch["acc"]:
        for k in (0.24, 0.44, 0.64):
            p.append(f'<circle cx="{CX:.0f}" cy="{m["sh_y"] + (hem - m["sh_y"]) * k:.1f}" '
                     f'r="{m["limb"] * 0.22:.1f}" fill="{trim}"/>')
    if "sash" in ch["acc"]:
        p.append(f'<path d="M{CX - half_top:.1f} {m["sh_y"] + m["limb"] * 0.6:.1f} '
                 f'L{CX + half_top:.1f} {m["sh_y"] + m["limb"] * 0.6:.1f} L{CX + half_top:.1f} '
                 f'{hem:.1f} L{CX - half_top:.1f} {hem:.1f} Z" fill="{trim}" opacity="0.55"/>')
    return p


def body_svg(ch, angle):
    m = metrics(ch)
    skin = SKINS[ch["tone"]]
    kind = ch["outfit_kind"]
    profile = angle == "side"
    p = []

    hems = {
        "robe": FLOOR - 30,
        "coat": m["hip_y"] + (FLOOR - m["hip_y"]) * 0.42,
        "dress": m["hip_y"] + (FLOOR - m["hip_y"]) * 0.42,
    }
    hem = hems.get(kind, m["hip_y"] + m["limb"])

    sh_half = m["sh_half"] * (0.52 if profile else 1.0)
    hip_half = m["hip_half"] * 1.5 if kind == "robe" else m["hip_half"] * (0.58 if profile else 1.0)

    # far-side limbs first, a shade down
    if kind != "robe":
        far_x = CX - m["limb"] * 0.9 if profile else CX - m["hip_half"] * 0.9
        if profile or angle == "three_quarter":
            p.append(f'<rect x="{far_x:.1f}" y="{m["hip_y"] - 6:.1f}" width="{m["limb"] * 1.8:.1f}" '
                     f'height="{FLOOR - 22 - m["hip_y"]:.1f}" rx="{m["limb"] * 0.9:.1f}" '
                     f'fill="{shade(ch["pants"], 0.75)}"/>')

    if kind == "robe":
        p.append(torso(ch, m, sh_half, hip_half, hem))
    else:
        p.extend(legs_and_feet(ch, m, single=profile,
                               bare_below=0.30 if kind == "shorts" else None))
        if kind == "dress":
            p.append(dress_shape(ch, m, sh_half, hip_half, hem, profile))
        else:
            p.append(torso(ch, m, sh_half, hip_half, hem))

    p.extend(accessories(ch, m, sh_half, hem, angle))

    # arms
    arm_top = m["sh_y"] + m["limb"] * 0.2
    arm_bottom = m["hip_y"] + m["limb"] * (0.5 if kind == "dress" else 1.4)
    arm_len = arm_bottom - arm_top
    arm_x = sh_half + m["limb"] * 0.62
    short_sleeve = "shortsleeve" in ch["acc"]
    for side in ([1] if profile else [-1, 1]):
        far = (side < 0 and angle == "three_quarter")
        colour = shade(ch["shirt"], 0.8) if far else ch["shirt"]
        hand = shade(skin, 0.84) if far else skin
        x = CX + side * arm_x - m["limb"] / 2
        p.append(f'<rect x="{x:.1f}" y="{arm_top:.1f}" width="{m["limb"]:.1f}" height="{arm_len:.1f}" '
                 f'rx="{m["limb"] / 2:.1f}" fill="{shade(skin, 0.98) if short_sleeve else colour}"/>')
        if short_sleeve:
            p.append(f'<rect x="{x:.1f}" y="{arm_top:.1f}" width="{m["limb"]:.1f}" '
                     f'height="{arm_len * 0.42:.1f}" rx="{m["limb"] / 2:.1f}" fill="{colour}"/>')
        p.append(f'<circle cx="{x + m["limb"] / 2:.1f}" cy="{arm_top + arm_len:.1f}" '
                 f'r="{m["limb"] * 0.62:.1f}" fill="{hand}"/>')

    p.append(f'<rect x="{CX - m["limb"] * 0.75:.1f}" y="{m["neck_y"]:.1f}" '
             f'width="{m["limb"] * 1.5:.1f}" height="{m["sh_y"] - m["neck_y"] + 8:.1f}" fill="{skin}"/>')
    if "collar" in ch["acc"] and angle != "back":
        p.append(f'<rect x="{CX - m["limb"] * 0.85:.1f}" y="{m["sh_y"] - m["limb"] * 0.5:.1f}" '
                 f'width="{m["limb"] * 1.7:.1f}" height="{m["limb"] * 0.6:.1f}" rx="4" fill="#ffffff"/>')
    p.extend(head_parts(ch, m, angle))
    return svg("".join(p))


# ------------------------------------------------------------------ outfits

def outfit(name, kind, shirt, pants, shoe, trim="#ffffff", tie="#8c2f39", acc=()):
    return dict(name=name, kind=kind, shirt=shirt, pants=pants, shoe=shoe,
                trim=trim, tie=tie, acc=list(acc))


OUTFITS = {
    "casual_m": outfit("Casual", "pants", "#3f6ea8", "#2b3a4a", "#20232a", trim="#2a4a72", acc=["buttons"]),
    "suit_m": outfit("Suit", "pants", "#2e3440", "#2e3440", "#17181c", trim="#3b4252", acc=["lapels", "tie"]),
    "work_m": outfit("Work", "pants", "#d8a12a", "#43505e", "#23262c", trim="#f0e6cf", acc=["hivis"]),
    "cardigan": outfit("Cardigan", "coat", "#6d7f8c", "#4a4f57", "#2b2e33", trim="#55636e", acc=["buttons"]),
    "overalls": outfit("Overalls", "pants", "#4a6a8a", "#3b566f", "#2a2d33", trim="#d9c48a", acc=["sash", "shortsleeve"]),

    "dress_f": outfit("Dress", "dress", "#b8546b", "#4a3b47", "#2a2028", trim="#d98aa0"),
    "blouse_f": outfit("Blouse & slacks", "pants", "#e8dfe8", "#4a4356", "#2a2530", trim="#b9a9c4", acc=["buttons"]),
    "suit_f": outfit("Suit", "pants", "#3a3545", "#3a3545", "#1e1c24", trim="#4c4557", acc=["lapels"]),
    "gown_e": outfit("Day dress", "dress", "#9a7fa5", "#5b5560", "#38343c", trim="#c0aecb"),
    "scrubs": outfit("Scrubs", "pants", "#3f9c8f", "#3f9c8f", "#e8e2d4", trim="#2f7d72", acc=["vneck"]),

    "hoodie": outfit("Hoodie", "pants", "#4f9d69", "#39414d", "#23262c", trim="#3d7d53", acc=["hood"]),
    "jersey": outfit("Athletic", "shorts", "#e08a3c", "#e08a3c", "#f0efe9", trim="#b96c25", acc=["shortsleeve", "vneck"]),
    "campus_f": outfit("Campus", "pants", "#e08a3c", "#3d4550", "#24272d", trim="#b96c25", acc=["shortsleeve"]),

    "kid_casual_b": outfit("Casual", "shorts", "#d6543f", "#3b4654", "#23262c", trim="#a8402f", acc=["shortsleeve"]),
    "kid_school_b": outfit("School", "pants", "#41577d", "#2f3a4a", "#23262c", trim="#e8e2d4", acc=["buttons", "tie"], tie="#8c2f39"),
    "kid_winter_b": outfit("Winter coat", "coat", "#2f6b5d", "#3b4654", "#23262c", trim="#d9c48a", acc=["buttons", "hood"]),
    "kid_casual_g": outfit("Casual", "dress", "#57b2c4", "#46505e", "#262a30", trim="#3d8f9e"),
    "kid_school_g": outfit("School", "dress", "#5a6b93", "#46505e", "#262a30", trim="#e8e2d4", acc=["buttons"]),
    "kid_winter_g": outfit("Winter coat", "coat", "#c4577f", "#46505e", "#262a30", trim="#f0dfe6", acc=["buttons", "hood"]),

    "onesie": outfit("Onesie", "pants", "#f2e3a8", "#cfd6e0", "#e8e2d4", trim="#dfc97e", acc=["buttons"]),
    "pyjamas": outfit("Pyjamas", "pants", "#a8c4e0", "#a8c4e0", "#e8e2d4", trim="#7fa3c9", acc=["buttons"]),

    "cassock": outfit("Cassock", "robe", "#1c1c20", "#1c1c20", "#17171a", trim="#ffffff", acc=["collar"]),
    "vestment": outfit("Vestment", "robe", "#f0ece2", "#f0ece2", "#17171a", trim="#3f7d4f", acc=["sash", "collar"]),
    "clerical": outfit("Clerical shirt", "pants", "#23252b", "#2e3138", "#17171a", trim="#ffffff", acc=["collar"]),
}


# ------------------------------------------------------------------- roster

def role(key, name, age, sex, hair_style, kit, outfits, grey=False):
    return dict(key=key, name=name, age=age, sex=sex, hair_style=hair_style,
                kit=kit, outfits=outfits, grey=grey)


ROLES = [
    role("elder_man", "Older man", "elder", "male", "receding", "male",
         ["cardigan", "suit_m", "overalls"], grey=True),
    role("elder_woman", "Older woman", "elder", "female", "bun", "female",
         ["gown_e", "blouse_f", "suit_f"], grey=True),
    role("man", "Man", "adult", "male", "short", "male",
         ["casual_m", "suit_m", "work_m"]),
    role("woman", "Woman", "adult", "female", "long", "female",
         ["dress_f", "blouse_f", "scrubs"]),
    role("college_man", "College man", "college", "male", "short", "male",
         ["hoodie", "suit_m", "jersey"]),
    role("college_woman", "College woman", "college", "female", "long", "female",
         ["campus_f", "suit_f", "jersey"]),
    role("boy", "Boy", "child", "male", "short", "kid",
         ["kid_casual_b", "kid_school_b", "kid_winter_b"]),
    role("girl", "Girl", "child", "female", "long", "kid",
         ["kid_casual_g", "kid_school_g", "kid_winter_g"]),
    role("baby", "Baby", "baby", "neutral", "short", "baby",
         ["onesie", "pyjamas"]),
    role("priest", "Priest", "adult", "male", "short", "male",
         ["cassock", "vestment", "clerical"]),
]


def make_character(r, outfit_key, tone):
    o = OUTFITS[outfit_key]
    hair = HAIR_BY_TONE[tone]
    if r["grey"]:
        hair = WHITE_HAIR if r["age"] == "elder" and r["sex"] == "female" else GREY
    return dict(
        id=f'{r["key"]}_{outfit_key}_{tone}',
        name=f'{r["name"]} — {o["name"]} ({SKIN_NAMES[tone]})',
        tone=tone, age=r["age"], sex=r["sex"],
        hair=hair, brow=shade(hair, 0.9), hair_style=r["hair_style"],
        outfit_kind=o["kind"], shirt=o["shirt"], pants=o["pants"], shoe=o["shoe"],
        trim=o["trim"], tie=o["tie"], acc=o["acc"],
        kit=r["kit"], role=r["key"], role_name=r["name"],
        outfit=outfit_key, outfit_name=o["name"],
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
        "roleName": ch["role_name"],
        "outfit": ch["outfit"],
        "outfitName": ch["outfit_name"],
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
            "mouth": [round(CX + face_dx, 1), round(m["head_cy"] + m["head_ry"] * 0.52, 1)],
            "mouthSize": [round(m["head_rx"] * 1.15, 1), round(m["head_rx"] * 0.8, 1)],
            "visemes": {},
        }
    write(os.path.join(root, "rig.json"), json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    built = []
    for r in ROLES:
        for outfit_key in r["outfits"]:
            for tone in SKINS:
                built.append(build(make_character(r, outfit_key, tone)))
    write(os.path.join(OUT, "index.json"),
          json.dumps([{"id": m["id"], "name": m["name"], "role": m["role"],
                       "roleName": m["roleName"], "outfit": m["outfit"],
                       "outfitName": m["outfitName"], "tone": m["tone"],
                       "rig": f"{m['id']}/rig.json"} for m in built], indent=2) + "\n")
    print(f"wrote {len(built)} characters to assets/characters/")
