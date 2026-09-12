// The stage: backdrop, camera, ground plane and the renderer.
//
// World coordinates are the backdrop's own pixels. The camera maps world to
// screen with a single translate+scale, so "walking forward" is nothing more
// than animating camera zoom, and "panning" is animating camera x/y.
//
// Depth is handled by a flat ground plane. For a camera at a fixed height
// looking at flat ground, apparent size falls off linearly with distance below
// the horizon line - so a character standing at world y gets
//
//     groundScale(y) = (y - horizonY) / (bottomY - horizonY)
//
// which is 1 at the front of the shot and 0 at the horizon. That single formula
// is what keeps characters photographed at different distances consistent: the
// rig says how many art pixels make one metre, the ground plane says how many
// world pixels one metre is worth at that spot, and the sprite scale is just the
// ratio.

import { mouthImage } from "./rig.js";

export const DEFAULT_HORIZON = 0.62;

export function createStage(canvas) {
  return {
    canvas,
    ctx: canvas.getContext("2d"),
    backdrop: null,
    camera: { x: 0, y: 0, zoom: 1 },
    /** World pixels per world unit (metre) at the very front of the shot. */
    unitPxAtGround: 300,
    actors: [],
    showGuides: false,
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load image: ${src}`));
    img.src = src;
  });
}

/** Load a multi-layer backdrop described by a backdrop.json. */
export async function loadBackdropFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`backdrop fetch failed: ${url}`);
  const spec = await res.json();
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  const layers = [];
  for (const layer of spec.layers) {
    layers.push({ img: await loadImage(base + layer.src), parallax: layer.parallax ?? 1 });
  }
  return {
    name: spec.name || "Backdrop",
    width: spec.width || layers[0].img.naturalWidth,
    height: spec.height || layers[0].img.naturalHeight,
    horizon: spec.horizon ?? DEFAULT_HORIZON,
    layers,
  };
}

function loadVideo(src) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error("could not load video backdrop"));
    video.src = src;
  });
}

/** Load a backdrop from one uploaded image or video - the common case. */
export async function loadBackdropFromFile(file) {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("video/")) {
    const video = await loadVideo(url);
    return {
      name: file.name,
      width: video.videoWidth,
      height: video.videoHeight,
      horizon: DEFAULT_HORIZON,
      layers: [{ video, parallax: 1 }],
    };
  }
  const img = await loadImage(url);
  return {
    name: file.name,
    width: img.naturalWidth,
    height: img.naturalHeight,
    horizon: DEFAULT_HORIZON,
    layers: [{ img, parallax: 1 }],
  };
}

/** Add an uploaded image or video as an extra parallax layer on the backdrop. */
export async function addBackdropLayer(stage, file, parallax = 1) {
  const url = URL.createObjectURL(file);
  const layer = file.type.startsWith("video/")
    ? { video: await loadVideo(url), parallax }
    : { img: await loadImage(url), parallax };
  stage.backdrop.layers.push(layer);
  return layer;
}

function videoLayers(stage) {
  return (stage.backdrop?.layers || []).filter((l) => l.video);
}

/** Keep video layers in step with the timeline. */
export function syncBackdropVideo(stage, time, playing) {
  for (const layer of videoLayers(stage)) {
    const { video } = layer;
    if (!video.duration) continue;
    const target = time % video.duration;
    if (playing) {
      // Only correct the video when it has drifted; constant seeking stutters.
      if (Math.abs(video.currentTime - target) > 0.25) video.currentTime = target;
      if (video.paused) video.play().catch(() => {});
    } else {
      if (!video.paused) video.pause();
      video.currentTime = target;
    }
  }
}

/** Seek video layers and wait for the frame - used by frame-exact export. */
export async function seekBackdropVideo(stage, time) {
  await Promise.all(videoLayers(stage).map((layer) => new Promise((resolve) => {
    const { video } = layer;
    if (!video.duration) return resolve();
    video.pause();
    const target = time % video.duration;
    if (Math.abs(video.currentTime - target) < 1e-3) return resolve();
    video.onseeked = () => {
      video.onseeked = null;
      resolve();
    };
    video.currentTime = target;
  })));
}

export function horizonY(stage) {
  if (!stage.backdrop) return stage.canvas.height * DEFAULT_HORIZON;
  return stage.backdrop.height * stage.backdrop.horizon;
}

export function bottomY(stage) {
  return stage.backdrop ? stage.backdrop.height : stage.canvas.height;
}

/** Depth factor for a character whose feet are at world y. */
export function groundScale(stage, y) {
  const hy = horizonY(stage);
  const by = bottomY(stage);
  const span = Math.max(1, by - hy);
  return Math.max(0.04, (y - hy) / span);
}

/** World pixels per world unit at world y. */
export function unitPxAt(stage, y) {
  return stage.unitPxAtGround * groundScale(stage, y);
}

/** Sprite scale that draws `rig` at the correct size for world y. */
export function spriteScale(stage, rig, y, scaleMul = 1) {
  return (unitPxAt(stage, y) / rig.pixelsPerUnit) * scaleMul;
}

export function worldToScreen(stage, x, y) {
  const { camera, canvas } = stage;
  return {
    x: (x - camera.x) * camera.zoom + canvas.width / 2,
    y: (y - camera.y) * camera.zoom + canvas.height / 2,
  };
}

export function screenToWorld(stage, x, y) {
  const { camera, canvas } = stage;
  return {
    x: (x - canvas.width / 2) / camera.zoom + camera.x,
    y: (y - canvas.height / 2) / camera.zoom + camera.y,
  };
}

/** Frame the camera so the whole backdrop is visible - a useful "reset". */
export function fitCamera(stage) {
  const b = stage.backdrop;
  const { canvas, camera } = stage;
  if (!b) return;
  camera.zoom = Math.min(canvas.width / b.width, canvas.height / b.height);
  camera.x = b.width / 2;
  camera.y = b.height / 2;
}

/** Zoom level at which the backdrop exactly fills the frame height. */
export function fillZoom(stage) {
  const b = stage.backdrop;
  if (!b) return 1;
  return Math.max(stage.canvas.width / b.width, stage.canvas.height / b.height);
}

/**
 * Keep a camera inside the backdrop: never zoomed out past the point where the
 * backdrop fills the frame, and never panned off its edges. Applied to
 * generated moves so a template cannot produce black bars; manual dragging is
 * left unclamped so the user can still go wherever they want.
 */
export function clampCamera(stage, cam) {
  const b = stage.backdrop;
  if (!b) return { ...cam };
  const zoom = Math.max(cam.zoom, fillZoom(stage));
  const halfW = stage.canvas.width / zoom / 2;
  const halfH = stage.canvas.height / zoom / 2;
  return {
    zoom,
    x: Math.min(b.width - halfW, Math.max(halfW, cam.x)),
    y: Math.min(b.height - halfH, Math.max(halfH, cam.y)),
  };
}

// --- rendering ---------------------------------------------------------------

function drawBackdrop(stage, ctx) {
  const b = stage.backdrop;
  const { camera, canvas } = stage;
  if (!b) {
    ctx.fillStyle = "#15171c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const layers = [...b.layers].sort((p, q) => p.parallax - q.parallax);
  // Parallax is measured from the middle of the backdrop, not the world origin:
  // every layer lines up when the camera is centred, and distant layers lag
  // behind only as the camera travels away from that point. Measuring from the
  // origin instead would slide the sky out of frame the moment you panned.
  const refX = b.width / 2;
  const refY = b.height / 2;
  for (const layer of layers) {
    const px = refX + (camera.x - refX) * layer.parallax;
    const py = refY + (camera.y - refY) * layer.parallax;
    ctx.save();
    ctx.translate(canvas.width / 2 - px * camera.zoom, canvas.height / 2 - py * camera.zoom);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.drawImage(layer.video || layer.img, 0, 0, b.width, b.height);
    ctx.restore();
  }
}

function drawGuides(stage, ctx) {
  const { canvas } = stage;
  const hy = worldToScreen(stage, 0, horizonY(stage)).y;
  ctx.save();
  ctx.strokeStyle = "#5ad1ff";
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, hy);
  ctx.lineTo(canvas.width, hy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#5ad1ff";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("horizon", 10, hy - 6);
  ctx.restore();
}

/**
 * Draw one frame.
 * @param {object} stage
 * @param {Array} poses - resolved poses from animate.js, one per visible actor.
 */
export function renderFrame(stage, poses) {
  const { ctx, canvas } = stage;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackdrop(stage, ctx);

  // Painter's order: characters further from camera (higher up the frame) first.
  const ordered = [...poses].sort((a, b) => a.y - b.y);

  ctx.save();
  ctx.translate(canvas.width / 2 - stage.camera.x * stage.camera.zoom,
                canvas.height / 2 - stage.camera.y * stage.camera.zoom);
  ctx.scale(stage.camera.zoom, stage.camera.zoom);

  for (const pose of ordered) {
    const rig = pose.actor.rig;
    const angle = rig.angles[pose.angle] || rig.angles[Object.keys(rig.angles)[0]];
    if (!angle) continue;
    const s = spriteScale(stage, rig, pose.y, pose.actor.scaleMul);

    ctx.save();
    ctx.translate(pose.x, pose.y);

    // Contact shadow, squashed with depth so it reads as sitting on the ground.
    const shadowW = rig.anchor[0] * s * 0.9;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, 0, shadowW, shadowW * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.translate(0, pose.bob || 0);
    if (pose.lean) ctx.rotate(pose.lean);
    if (pose.flip) ctx.scale(-1, 1);
    ctx.scale(s, s);
    ctx.translate(-rig.anchor[0], -rig.anchor[1]);

    ctx.drawImage(angle.body, 0, 0, angle.body.naturalWidth, angle.body.naturalHeight);

    const mouth = mouthImage(angle, pose.viseme, pose.actor.mouthKit, pose.angle);
    if (mouth) {
      // Width comes from the rig's fitting; height follows the drawing's own
      // aspect, so kits with different canvas shapes swap in without distortion.
      const w = angle.mouthSize[0] * angle.mouthScale;
      const h = w * (mouth.naturalHeight / mouth.naturalWidth);
      ctx.drawImage(mouth, angle.mouth[0] - w / 2, angle.mouth[1] - h / 2, w, h);
    }
    ctx.restore();
  }
  ctx.restore();

  if (stage.showGuides) drawGuides(stage, ctx);
  ctx.restore();
}

/** Hit-test actors for click-to-select, nearest (largest) first. */
export function actorAt(stage, poses, screenX, screenY) {
  const w = screenToWorld(stage, screenX, screenY);
  const ordered = [...poses].sort((a, b) => b.y - a.y);
  for (const pose of ordered) {
    const rig = pose.actor.rig;
    const s = spriteScale(stage, rig, pose.y, pose.actor.scaleMul);
    const left = pose.x - rig.anchor[0] * s;
    const right = pose.x + (rig.anchor[0] ? rig.anchor[0] : 0) * s;
    const top = pose.y - rig.anchor[1] * s;
    if (w.x >= left && w.x <= right && w.y >= top && w.y <= pose.y + 10 * s) return pose.actor;
  }
  return null;
}
