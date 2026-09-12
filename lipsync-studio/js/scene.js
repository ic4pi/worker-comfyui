// The scene: who is on screen, who is speaking, and what the camera is doing -
// planned before any animation exists.
//
import { clampCamera } from "./stage.js";

// The idea is that a shot is written first. You say where it happens, who is in
// it, how long they are on screen and what they say. Only then do you block the
// movement. Everything here is plain data on a timeline so it can be dragged
// around after the fact.

/** Is `ranges` (a list of {start,end}) covering time t? Empty means always. */
export function inRanges(ranges, t) {
  if (!ranges || !ranges.length) return true;
  return ranges.some((r) => t >= r.start && t <= r.end);
}

/** The dialogue line an actor is speaking at time t, if any. */
export function activeLine(lines, actorId, t) {
  return lines.find((l) => l.actorId === actorId && t >= l.start && t <= l.start + l.duration) || null;
}

export function linesFor(lines, actorId) {
  return lines.filter((l) => l.actorId === actorId).sort((a, b) => a.start - b.start);
}

// --- camera direction --------------------------------------------------------

export const CAMERA_MODES = [
  { id: "manual", name: "Manual (keyframes)" },
  { id: "follow", name: "Follow a character" },
  { id: "fixed", name: "Locked off" },
];

/** The camera segment covering time t - the last one that has started. */
export function activeSegment(segments, t) {
  if (!segments.length) return null;
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  let current = null;
  for (const seg of sorted) {
    if (seg.start <= t) current = seg;
    else break;
  }
  return current || sorted[0];
}

function segmentEnd(segments, segment, fallback) {
  const later = segments.filter((s) => s.start > segment.start).sort((a, b) => a.start - b.start)[0];
  return later ? later.start : fallback;
}

/**
 * Where a follow camera wants to sit: centred on the actor, lifted so the
 * character sits in the lower third rather than dead centre.
 */
function followTarget(stage, pose, segment) {
  const zoom = segment.zoom || stage.camera.zoom;
  const lift = (stage.canvas.height / zoom) * (segment.lift ?? 0.18);
  return { x: pose.x + (segment.lead ?? 0), y: pose.y - lift, zoom };
}

/**
 * Resolve the camera for time t.
 *
 * @param {object} stage
 * @param {Array} segments - camera plan
 * @param {Array} poses - resolved actor poses this frame
 * @param {object} manual - camera from the manual keyframes
 * @param {number} t
 * @param {number} duration - scene length, for the last segment's end
 * @returns {{x:number,y:number,zoom:number}}
 */
export function directCamera(stage, segments, poses, manual, t, duration) {
  const segment = activeSegment(segments, t);
  if (!segment || segment.mode === "manual") return manual;
  // A directed camera is kept inside the backdrop; only manual dragging is
  // allowed to wander off the edge.
  const fit = (cam) => clampCamera(stage, cam);

  let target = manual;
  if (segment.mode === "fixed") {
    target = segment.camera || manual;
  } else if (segment.mode === "follow") {
    const pose = poses.find((p) => p.actor.id === segment.target);
    target = pose ? followTarget(stage, pose, segment) : manual;
  }

  // Ease into a segment rather than snapping, unless it is marked as a cut.
  const blend = segment.cut ? 0 : (segment.blend ?? 0.6);
  const since = t - segment.start;
  if (blend > 0 && since < blend && since >= 0) {
    const u = since / blend;
    const ease = u * u * (3 - 2 * u);
    const previous = [...segments].filter((s) => s.start < segment.start)
      .sort((a, b) => b.start - a.start)[0];
    const from = previous && previous.mode === "follow"
      ? (() => {
          const pose = poses.find((p) => p.actor.id === previous.target);
          return pose ? followTarget(stage, pose, previous) : manual;
        })()
      : manual;
    target = fit(target);
    return fit({
      x: from.x + (target.x - from.x) * ease,
      y: from.y + (target.y - from.y) * ease,
      zoom: from.zoom + (target.zoom - from.zoom) * ease,
    });
  }
  return fit(target);
}

/**
 * Characters marked as tagging along move with whoever the camera is following,
 * keeping the offset they had when the segment began. That is what makes a
 * crowd walk with the lead instead of sliding out of frame.
 */
export function applyTagAlong(stage, segments, poses, t, duration) {
  const segment = activeSegment(segments, t);
  if (!segment || segment.mode !== "follow") return;
  const lead = poses.find((p) => p.actor.id === segment.target);
  if (!lead) return;

  for (const pose of poses) {
    if (pose === lead || !pose.actor.tagAlong) continue;
    const offset = pose.actor.tagOffset || { x: 0, y: 0 };
    pose.x = lead.x + offset.x;
    pose.y = lead.y + offset.y;
  }
}

/** Record each tag-along character's offset from the lead, at the current time. */
export function captureTagOffsets(stage, segments, poses, t) {
  const segment = activeSegment(segments, t);
  if (!segment || segment.mode !== "follow") return;
  const lead = poses.find((p) => p.actor.id === segment.target);
  if (!lead) return;
  for (const pose of poses) {
    if (pose === lead || !pose.actor.tagAlong) continue;
    pose.actor.tagOffset = { x: pose.x - lead.x, y: pose.y - lead.y };
  }
}

/** Longest time anything in the scene plan reaches. */
export function planDuration(lines, segments) {
  let end = 0;
  for (const line of lines) end = Math.max(end, line.start + line.duration);
  for (const seg of segments) end = Math.max(end, seg.start);
  return end;
}
