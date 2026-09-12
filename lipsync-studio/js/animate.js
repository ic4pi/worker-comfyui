// Timeline evaluation: keyframes, the procedural walk cycle, and the "hold"
// quantiser that gives limited animation its deliberate, choppy look.

import { unitPxAt } from "./stage.js";
import { visemeAt } from "./lipsync.js";
import { availableAngles } from "./rig.js";

const smoothstep = (u) => u * u * (3 - 2 * u);

/** Interpolate a sorted keyframe list at time t. Fields listed in `numeric`
 *  are eased; everything else steps at the key. */
export function sampleKeys(keys, t, numeric) {
  if (!keys.length) return null;
  if (t <= keys[0].t) return { ...keys[0] };
  if (t >= keys[keys.length - 1].t) return { ...keys[keys.length - 1] };

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  const u = span > 1e-6 ? smoothstep((t - a.t) / span) : 0;
  const out = { ...a, t };
  for (const field of numeric) {
    if (typeof a[field] === "number" && typeof b[field] === "number") {
      out[field] = a[field] + (b[field] - a[field]) * u;
    }
  }
  return out;
}

export function sortKeys(keys) {
  return keys.sort((p, q) => p.t - q.t);
}

/** Insert or replace a key at time t (within a small tolerance). */
export function putKey(keys, key, tolerance = 1 / 120) {
  const existing = keys.find((k) => Math.abs(k.t - key.t) < tolerance);
  if (existing) Object.assign(existing, key);
  else keys.push({ ...key });
  return sortKeys(keys);
}

export const CAMERA_FIELDS = ["x", "y", "zoom"];
const ACTOR_FIELDS = ["x", "y"];

export function evalCamera(keys, t, fallback) {
  const k = sampleKeys(keys, t, CAMERA_FIELDS);
  return k ? { x: k.x, y: k.y, zoom: k.zoom } : { ...fallback };
}

/** Velocity in world px/s, by finite difference on the actor's own keys. */
function velocity(actor, t) {
  const dt = 1 / 30;
  const a = sampleKeys(actor.keys, Math.max(0, t - dt), ACTOR_FIELDS);
  const b = sampleKeys(actor.keys, t + dt, ACTOR_FIELDS);
  if (!a || !b) return { vx: 0, vy: 0 };
  const span = (t + dt) - Math.max(0, t - dt);
  return { vx: (b.x - a.x) / span, vy: (b.y - a.y) / span };
}

/**
 * Pick a shooting angle from the direction of travel. Deliberately coarse - four
 * discrete angles that snap, which is exactly the limited-animation look.
 */
function angleFromMotion(actor, vx, vy) {
  const have = availableAngles(actor.rig);
  const has = (a) => have.includes(a);
  const speed = Math.hypot(vx, vy);
  if (speed < 4) return { angle: actor.restAngle || have[0], flip: actor.flip };

  const lateral = Math.abs(vx);
  const towardCamera = vy > 0;
  let angle;
  if (lateral > Math.abs(vy) * 2.2 && has("side")) angle = "side";
  else if (lateral > Math.abs(vy) * 0.5 && has("three_quarter")) angle = "three_quarter";
  else if (towardCamera) angle = has("front") ? "front" : have[0];
  else angle = has("back") ? "back" : have[0];

  // Art is drawn facing one way; mirror it when travelling the other way.
  const mirrored = (angle === "side" || angle === "three_quarter") && vx < 0;
  return { angle, flip: actor.flip !== mirrored };
}

/**
 * Resolve every actor's pose at time t.
 * @param {object} stage
 * @param {number} time - seconds
 * @param {{holdFps?:number}} [opts] - holdFps quantises motion onto N frames a
 *   second while audio keeps running at full rate.
 */
export function evaluateScene(stage, time, opts = {}) {
  const holdFps = opts.holdFps || 0;
  const t = holdFps > 0 ? Math.floor(time * holdFps) / holdFps : time;

  const poses = [];
  for (const actor of stage.actors) {
    if (actor.visible === false) continue;
    const base = sampleKeys(actor.keys, t, ACTOR_FIELDS);
    if (!base) continue;

    const { vx, vy } = velocity(actor, t);
    const auto = actor.autoAngle !== false ? angleFromMotion(actor, vx, vy) : null;
    const angle = (auto && auto.angle) || base.angle || actor.restAngle || availableAngles(actor.rig)[0];
    const flip = auto ? auto.flip : Boolean(actor.flip);

    let bob = 0;
    let lean = 0;
    const walking = actor.walk?.enabled && Math.hypot(vx, vy) > 4;
    if (walking) {
      const unit = unitPxAt(stage, base.y);
      const hz = actor.walk.stepHz || 2.2;
      // Two contacts per stride, so the body rises twice per cycle.
      bob = -Math.abs(Math.sin(Math.PI * 2 * hz * t)) * (actor.walk.bobUnits ?? 0.055) * unit;
      lean = Math.sin(Math.PI * 2 * hz * t) * (actor.walk.leanRad ?? 0.012);
    }

    // Lip sync always samples real time, never the held time - mouths must stay
    // locked to the audio even when the body animates on twos or fours.
    const viseme = actor.track ? visemeAt(actor.track, time - (actor.audioOffset || 0)) : "rest";

    poses.push({ actor, x: base.x, y: base.y, angle, flip, bob, lean, viseme });
  }
  return poses;
}

/** Longest time referenced by the scene, used to size the timeline. */
export function sceneDuration(stage, cameraKeys) {
  let end = 0;
  for (const actor of stage.actors) {
    for (const k of actor.keys) end = Math.max(end, k.t);
    if (actor.track) end = Math.max(end, (actor.audioOffset || 0) + actor.track.duration);
  }
  for (const k of cameraKeys) end = Math.max(end, k.t);
  return Math.max(end, 1);
}

/**
 * Build a straight-line walk: two position keys plus the walk flag. The camera
 * can be left alone (character crosses the frame) or told to follow (character
 * stays put and the backdrop slides behind them).
 */
export function makeWalk(actor, from, to, startT, endT) {
  actor.keys = sortKeys([
    { t: startT, x: from.x, y: from.y },
    { t: endT, x: to.x, y: to.y },
  ]);
  actor.walk = { ...(actor.walk || {}), enabled: true };
  return actor;
}

/** Camera keys that keep `actor` centred for the span of their own keys. */
export function followActor(actor, zoom, sampleCount = 24) {
  if (actor.keys.length < 2) return [];
  const t0 = actor.keys[0].t;
  const t1 = actor.keys[actor.keys.length - 1].t;
  const keys = [];
  for (let i = 0; i <= sampleCount; i++) {
    const t = t0 + ((t1 - t0) * i) / sampleCount;
    const p = sampleKeys(actor.keys, t, ACTOR_FIELDS);
    keys.push({ t, x: p.x, y: p.y - 200, zoom });
  }
  return keys;
}
