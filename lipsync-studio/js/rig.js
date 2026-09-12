// Character rigs: a small bundle of still images plus the numbers needed to
// composite and scale them.
//
// A rig is four angles (front / three_quarter / side / back). Each angle has one
// body image and, unless it is the back, one image per viseme. Two anchors do
// all the work: `anchor` is where the feet meet the ground (so the stage can
// plant the character on its ground plane) and each angle's `mouth` is where the
// mouth sprite is centred.

import { VISEMES } from "./lipsync.js";

/** The four shapes a character needs before it can talk at all. */
export const CORE_VISEMES = ["MBP", "AI", "E", "O"];

export const ANGLE_ORDER = ["front", "three_quarter", "side", "back"];

const ANGLE_ALIASES = {
  front: "front", f: "front", forward: "front",
  three_quarter: "three_quarter", threequarter: "three_quarter", tq: "three_quarter",
  "3q": "three_quarter", "34": "three_quarter", quarter: "three_quarter",
  side: "side", profile: "side", s: "side",
  back: "back", rear: "back", behind: "back", b: "back",
};

const VISEME_ALIASES = (() => {
  const map = {};
  VISEMES.forEach((v) => {
    map[v.toLowerCase()] = v;
  });
  Object.assign(map, {
    closed: "MBP", shut: "MBP", m: "MBP", idle: "rest", neutral: "rest",
    open: "AI", a: "AI", ah: "AI", wide: "E", flat: "E", ee: "E",
    round: "O", oh: "O", oo: "U", w: "WQ", f: "FV", bite: "FV", tongue: "L",
  });
  return map;
})();

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load image: ${src}`));
    img.src = src;
  });
}

/** Fill in the derived numbers a freshly parsed manifest needs. */
function finalise(rig) {
  const anchorY = rig.anchor[1];
  // How many image pixels represent one world unit. Art is expected to be framed
  // with the top of the head at the top edge of the canvas.
  rig.pixelsPerUnit = rig.pixelsPerUnit || anchorY / rig.heightUnits;
  return rig;
}

async function buildRig(manifest, resolveSrc) {
  const rig = {
    id: manifest.id || manifest.name || "character",
    name: manifest.name || manifest.id || "Character",
    heightUnits: manifest.heightUnits || 1.7,
    anchor: manifest.anchor ? manifest.anchor.slice() : null,
    pixelsPerUnit: manifest.pixelsPerUnit || 0,
    angles: {},
  };

  for (const angleName of Object.keys(manifest.angles)) {
    const spec = manifest.angles[angleName];
    const body = await loadImage(resolveSrc(spec.body));
    const visemes = {};
    for (const [v, src] of Object.entries(spec.visemes || {})) {
      visemes[v] = await loadImage(resolveSrc(src));
    }
    rig.angles[angleName] = {
      body,
      mouth: spec.mouth ? spec.mouth.slice() : [body.naturalWidth / 2, body.naturalHeight * 0.29],
      mouthSize: spec.mouthSize ? spec.mouthSize.slice() : [body.naturalWidth * 0.27, body.naturalWidth * 0.2],
      mouthScale: spec.mouthScale ?? 1,
      visemes,
    };
  }

  if (!rig.anchor) {
    const any = rig.angles[Object.keys(rig.angles)[0]];
    rig.anchor = [any.body.naturalWidth / 2, any.body.naturalHeight];
  }
  return finalise(rig);
}

/** Load a rig from a rig.json URL. */
export async function loadRigFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`rig fetch failed: ${url}`);
  const manifest = await res.json();
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  return buildRig(manifest, (src) => (/^(https?:|data:|blob:)/.test(src) ? src : base + src));
}

// --- importing a folder of loose images -------------------------------------

function normalisePath(file) {
  return (file.webkitRelativePath || file.name).toLowerCase();
}

/**
 * Guess a manifest from file names, so a user can drop in a folder without
 * hand-writing JSON. Recognised shapes, case-insensitive, any separator:
 *
 *   front/body.png          front_body.png        front-body.png
 *   front/mouth_AI.png      front_mouth_ai.png    front_ai.png
 *
 * Anything the rules cannot place is reported back so the UI can say what was
 * skipped rather than silently dropping it.
 */
export function inferManifest(files) {
  const angles = {};
  const skipped = [];

  for (const file of files) {
    if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(file.name)) continue;
    const path = normalisePath(file);
    const tokens = path.replace(/\.[a-z]+$/, "").split(/[\/\\._\- ]+/).filter(Boolean);

    let angle = null;
    for (const tok of tokens) {
      if (ANGLE_ALIASES[tok]) {
        angle = ANGLE_ALIASES[tok];
        break;
      }
    }
    if (!angle) {
      skipped.push(`${file.name} (no angle in name)`);
      continue;
    }

    const isBody = tokens.includes("body") || tokens.includes("base") || tokens.includes("torso");
    let viseme = null;
    for (const tok of tokens) {
      const hit = VISEME_ALIASES[tok];
      if (hit && !(tok === "b" || tok === "f" || tok === "s") ) {
        viseme = hit;
        break;
      }
    }

    const entry = (angles[angle] ||= { visemes: {}, files: {} });
    if (isBody || (!viseme && !entry.body)) {
      entry.body = file;
    } else if (viseme) {
      entry.visemes[viseme] = file;
    } else {
      skipped.push(`${file.name} (not a body, no viseme in name)`);
    }
  }

  return { angles, skipped };
}

/** Build a rig from a FileList / File[] picked in the browser. */
export async function loadRigFromFiles(files, meta = {}) {
  const list = Array.from(files);
  const manifestFile = list.find((f) => /(^|\/)rig\.json$/i.test(normalisePath(f)));
  const urls = new Map();
  const urlFor = (file) => {
    if (!urls.has(file)) urls.set(file, URL.createObjectURL(file));
    return urls.get(file);
  };

  if (manifestFile) {
    const manifest = JSON.parse(await manifestFile.text());
    const byPath = new Map();
    list.forEach((f) => {
      const p = normalisePath(f);
      byPath.set(p, f);
      byPath.set(p.slice(p.lastIndexOf("/") + 1), f);
    });
    const resolve = (src) => {
      const key = src.toLowerCase();
      const file = byPath.get(key) || byPath.get(key.slice(key.lastIndexOf("/") + 1));
      if (!file) throw new Error(`rig.json references a missing file: ${src}`);
      return urlFor(file);
    };
    const rig = await buildRig({ ...manifest, ...meta }, resolve);
    return { rig, skipped: [] };
  }

  const { angles, skipped } = inferManifest(list);
  if (!Object.keys(angles).length) {
    throw new Error("No usable images found. Name files like front_body.png and front_mouth_AI.png.");
  }
  const manifest = {
    id: meta.id || "imported",
    name: meta.name || "Imported character",
    heightUnits: meta.heightUnits || 1.7,
    angles: {},
  };
  for (const [angleName, entry] of Object.entries(angles)) {
    if (!entry.body) {
      skipped.push(`${angleName}: no body image, angle dropped`);
      continue;
    }
    manifest.angles[angleName] = {
      body: urlFor(entry.body),
      visemes: Object.fromEntries(Object.entries(entry.visemes).map(([v, f]) => [v, urlFor(f)])),
    };
  }
  const rig = await buildRig(manifest, (src) => src);
  return { rig, skipped };
}

/**
 * Pick the best available mouth image for a viseme, walking a fallback chain so
 * a rig with only three mouth drawings still animates.
 */
const FALLBACK = {
  rest: ["rest", "MBP", "L"],
  MBP: ["MBP", "rest", "L"],
  FV: ["FV", "E", "L", "rest"],
  TH: ["TH", "L", "E", "AI"],
  L: ["L", "E", "AI"],
  WQ: ["WQ", "U", "O"],
  E: ["E", "AI", "L"],
  AI: ["AI", "E", "O"],
  O: ["O", "U", "AI"],
  U: ["U", "O", "WQ"],
};

export function mouthImage(angle, viseme) {
  const chain = FALLBACK[viseme] || [viseme];
  for (const v of chain) {
    if (angle.visemes[v]) return angle.visemes[v];
  }
  const first = Object.values(angle.visemes)[0];
  return first || null;
}

/** Angles a rig actually provides, in canonical order. */
export function availableAngles(rig) {
  return ANGLE_ORDER.filter((a) => rig.angles[a]);
}


// --- growing a rig over time -------------------------------------------------

/**
 * Merge a second drop of images into an existing rig. This is how a character
 * gets upgraded: start with four front mouths, add angles and shapes later
 * without rebuilding the character or losing its placement in the scene.
 *
 * New files win over old ones with the same name.
 */
export async function mergeRigFiles(rig, files) {
  const { angles, skipped } = inferManifest(Array.from(files));
  const added = [];
  const template = rig.angles.front || rig.angles[Object.keys(rig.angles)[0]];

  for (const [angleName, entry] of Object.entries(angles)) {
    let target = rig.angles[angleName];

    if (!target) {
      if (!entry.body) {
        skipped.push(`${angleName}: a new angle needs a body image`);
        continue;
      }
      const body = await loadImage(URL.createObjectURL(entry.body));
      // Borrow the mouth placement from an existing angle - a sane starting
      // point the user can nudge, rather than a guess from scratch.
      const scale = template ? body.naturalHeight / template.body.naturalHeight : 1;
      rig.angles[angleName] = target = {
        body,
        mouth: template
          ? [body.naturalWidth / 2, template.mouth[1] * scale]
          : [body.naturalWidth / 2, body.naturalHeight * 0.29],
        mouthSize: template
          ? [template.mouthSize[0] * scale, template.mouthSize[1] * scale]
          : [body.naturalWidth * 0.27, body.naturalWidth * 0.2],
        mouthScale: template ? template.mouthScale : 1,
        visemes: {},
      };
      added.push(`${angleName} body`);
    } else if (entry.body) {
      target.body = await loadImage(URL.createObjectURL(entry.body));
      added.push(`${angleName} body (replaced)`);
    }

    for (const [viseme, file] of Object.entries(entry.visemes)) {
      target.visemes[viseme] = await loadImage(URL.createObjectURL(file));
      added.push(`${angleName}/${viseme}`);
    }
  }
  return { added, skipped };
}

/**
 * How complete a rig is, and what drawing it next. Nothing here blocks
 * playback - a rig missing shapes falls back (see mouthImage) - it only tells
 * the user what upgrading would buy them.
 */
export function rigCoverage(rig) {
  const angles = availableAngles(rig);
  const speaking = angles.filter((a) => a !== "back");
  const counts = speaking.map((a) => Object.keys(rig.angles[a].visemes).length);
  const fewest = counts.length ? Math.min(...counts) : 0;

  let tier = "draft";
  if (angles.length >= 4 && fewest >= 8) tier = "full";
  else if (angles.length >= 3 && fewest >= 6) tier = "standard";
  else if (angles.length >= 1 && fewest >= CORE_VISEMES.length) tier = "quick";

  const next = [];
  const missingAngles = ANGLE_ORDER.filter((a) => !rig.angles[a]);
  if (missingAngles.length) next.push(`angles: ${missingAngles.join(", ")}`);
  for (const a of speaking) {
    const have = rig.angles[a].visemes;
    const missingCore = CORE_VISEMES.filter((v) => !have[v]);
    const missingRest = VISEMES.filter((v) => !have[v] && !CORE_VISEMES.includes(v));
    if (missingCore.length) next.push(`${a}: core shapes ${missingCore.join(", ")}`);
    else if (missingRest.length) next.push(`${a}: extra shapes ${missingRest.join(", ")}`);
  }

  return { tier, angles: angles.length, fewestMouths: fewest, next };
}
