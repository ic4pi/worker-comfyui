// Mouth kits: one set of mouth drawings shared by any number of characters.
//
// Mouths are the least character-specific art in a cartoon - a mouth is a jaw
// position, not an identity - so they live outside the rig. A character points
// at a kit and tints, scales and positions it. Only characters whose mouth is a
// defining trait (a muzzle, a beak, a mustache) need their own drawings, and
// those override the kit per shape rather than replacing it.

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load mouth image: ${src}`));
    img.src = src;
  });
}

const cache = new Map();

/** The bundled kits: [{id, name, kind, kit}]. */
export async function loadKitIndex() {
  const res = await fetch("assets/mouths/index.json");
  if (!res.ok) throw new Error("no mouth kits found");
  return res.json();
}

/** Load (and cache) one kit by its index entry. */
export async function loadKit(entry) {
  if (cache.has(entry.id)) return cache.get(entry.id);
  const url = `assets/mouths/${entry.kit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`kit fetch failed: ${url}`);
  const spec = await res.json();
  const base = url.slice(0, url.lastIndexOf("/") + 1);

  const kit = { id: spec.id, name: spec.name, kind: spec.kind, angles: {} };
  for (const [angleName, angleSpec] of Object.entries(spec.angles)) {
    const visemes = {};
    for (const [viseme, src] of Object.entries(angleSpec.visemes)) {
      visemes[viseme] = await loadImage(base + src);
    }
    kit.angles[angleName] = { visemes };
  }
  cache.set(entry.id, kit);
  return kit;
}
