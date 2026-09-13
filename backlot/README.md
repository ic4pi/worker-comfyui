# Backlot

A browser-based 2D animation studio for lip-synced webisodes. Plan a scene,
block the movement, light it, letter it, export it. No build step, no server
code, no accounts — it is static files and runs entirely in the browser.

## Running it

The app uses ES modules and `fetch`, so it must be served over HTTP.
Opening `index.html` from the file system will not work.

**Locally, with Python** (already installed on macOS and Linux):

```sh
cd backlot
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

**Locally, with Node:**

```sh
cd backlot
npx serve
```

**Hosting it for free.** Everything is static, so any static host works:

- **GitHub Pages** — repository Settings → Pages → deploy from branch `main`,
  folder `/`. The app is then at `https://<user>.github.io/<repo>/backlot/`.
- **Netlify / Cloudflare Pages / Vercel** — drag the `backlot` folder in,
  or point them at the repo with that folder as the publish directory.

Use Chrome or Edge. Firefox and Safari render fine but their WebM recording
support is patchier; the PNG sequence export works everywhere.

## The three tabs

**Script** — plan the scene before animating anything. Set the backdrop, add
characters, mark when each is on screen, and write the dialogue lines. Audio
attaches per line, so one character can speak many times and several can talk
in the same scene. Plan the camera here too: from any point on the timeline the
camera can follow a named character, lock off, or hand back to manual keys.

**Character** — fit the art. Outfits, mouth kits, mouth placement, walk cycle,
and the movement templates (cross the frame, enter, exit, approach, depart).

**Shot & FX** — the backdrop and its parallax layers, camera moves, and the
effects track: lighting looks, transitions, screen effects, comic callouts,
speech bubbles, captions, titles and sound effects.

The timeline under the stage shows one lane per character plus camera and
effects. Drag a clip's middle to move it, its edge to resize it, and the ruler
to scrub.

## Bringing your own art

A character is four angles — `front`, `three_quarter`, `side`, `back` — each
with a body image, plus mouth images for the angles that show a mouth. Import a
folder from the Character tab. Either include a `rig.json`, or name files so
they can be read directly:

```
front_body.png        front_mouth_AI.png
side_body.png         side_mouth_closed.png
```

Recognised mouth names include the plain-English ones: `closed`, `open`,
`wide`, `round`, `ah`, `ee`, `oh`, `oo`, `bite`, `tongue`.

Two rules matter more than anything else:

1. **Every angle must use the same canvas size, the same camera distance, and
   the same feet and head positions.** Otherwise the character grows and shrinks
   whenever the angle changes, and nothing in software fixes that cleanly.
2. **Draw the character facing camera-right only.** The app mirrors for the
   other direction — as long as the design is left-right symmetrical.

Start with four front mouths and add more later with **Upgrade selected
character's art**, which merges new drawings into a character already in the
scene without losing its position, keyframes or audio.

## Mouths are shared

Mouths live in kits, not in characters: `female`, `male`, `kid` (boys and girls
share it), `baby` (open or shut, nothing else), `muzzle` and `beak`. A character
picks a kit and the app tints and scales it to their head. Only a character
whose mouth is a defining trait — a muzzle, a beak, a mustache — needs drawings
of its own, and those override the kit one shape at a time.

## Voices

The app does not generate speech. Record it or make it elsewhere, then load the
file onto a dialogue line; any format the browser can decode will do.

The voice filters shift pitch and vocal-tract length **independently**, which is
what lets one recorded voice cover several characters. Moving only the pitch is
what makes a man sound like a chipmunk rather than like a woman.

## Exporting

**WebM** records in real time with all the audio mixed in — a thirty-second
shot takes thirty seconds. **PNG sequence** renders frame by frame into a ZIP,
which is slower to produce but frame-exact, for taking into a real editor.

## Regenerating the bundled assets

```sh
python3 tools/make_default_cast.py     # 87 characters
python3 tools/make_mouth_kits.py       # 6 mouth kits
python3 tools/make_sample_background.py
python3 tools/make_sfx.py              # 9 sound effects
```

They are checked in, so this is only needed after editing a generator.
