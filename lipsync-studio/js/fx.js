// Shot effects: the second half of the studio.
//
// Everything here is a timed clip laid on a track - {type, start, duration,
// params} - and every clip is a pure function of time, so scrubbing, playback
// and frame-exact export all produce identical frames. Nothing here touches the
// characters; it operates on the camera before the scene is drawn, or on the
// picture after.
//
// Three kinds:
//   camera  - nudges the camera before the frame is rendered (shake, punch-in)
//   overlay - drawn on top of the finished frame (light, weather, callouts)
//   audio   - schedules a sound; no picture at all

const TAU = Math.PI * 2;

/** Deterministic noise, so an exported frame matches what the scrub showed. */
function noise(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeInOut = (u) => u * u * (3 - 2 * u);

/** Progress through a clip, 0..1, plus a soft edge for sustained effects. */
function progress(clip, t) {
  const u = clip.duration > 0 ? (t - clip.start) / clip.duration : 1;
  return clamp01(u);
}

/** 0 at the clip's edges, 1 through the middle - for effects that sustain. */
function sustain(clip, t, edge = 0.25) {
  const u = progress(clip, t);
  const ramp = Math.min(0.49, edge / Math.max(0.001, clip.duration) * clip.duration / clip.duration + edge);
  if (u <= 0 || u >= 1) return 0;
  if (u < ramp) return easeInOut(u / ramp);
  if (u > 1 - ramp) return easeInOut((1 - u) / ramp);
  return 1;
}

export function isActive(clip, t) {
  return t >= clip.start && t <= clip.start + clip.duration;
}

// --- lighting ---------------------------------------------------------------

const LIGHTING = {
  day: { tint: "#fff6e0", tintAlpha: 0.06, shade: "#ffffff", shadeAlpha: 0 },
  golden: { tint: "#ff9c3d", tintAlpha: 0.30, shade: "#3b1f0a", shadeAlpha: 0.10 },
  night: { tint: "#2a3f78", tintAlpha: 0.52, shade: "#060b1c", shadeAlpha: 0.30 },
  moonlight: { tint: "#8fb8ff", tintAlpha: 0.34, shade: "#0a1024", shadeAlpha: 0.34 },
  interior: { tint: "#ffca7a", tintAlpha: 0.22, shade: "#2a1c0c", shadeAlpha: 0.12 },
  storm: { tint: "#6e7f92", tintAlpha: 0.34, shade: "#101820", shadeAlpha: 0.24 },
  sickly: { tint: "#9dff7a", tintAlpha: 0.22, shade: "#0d1a0a", shadeAlpha: 0.18 },
};

function drawLighting(ctx, w, h, clip, amount) {
  const preset = LIGHTING[clip.params.preset] || LIGHTING.night;
  const strength = (clip.params.strength ?? 1) * amount;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = preset.tintAlpha * strength;
  ctx.fillStyle = preset.tint;
  ctx.fillRect(0, 0, w, h);
  if (preset.shadeAlpha) {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = preset.shadeAlpha * strength;
    ctx.fillStyle = preset.shade;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function drawVignette(ctx, w, h, strength) {
  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28,
                                        w / 2, h / 2, Math.max(w, h) * 0.72);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, `rgba(0,0,0,${0.85 * strength})`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// --- transitions ------------------------------------------------------------

function drawFade(ctx, w, h, clip, t) {
  const u = progress(clip, t);
  const alpha = clip.params.direction === "in" ? 1 - easeInOut(u) : easeInOut(u);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = clip.params.color || "#000000";
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawFlash(ctx, w, h, clip, t) {
  const u = progress(clip, t);
  // Snap on, fall away - a flash that eases in reads as a fade.
  ctx.save();
  ctx.globalAlpha = (1 - u) ** 2;
  ctx.fillStyle = clip.params.color || "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawWipe(ctx, w, h, clip, t) {
  const u = easeInOut(progress(clip, t));
  const dir = clip.params.direction || "right";
  ctx.save();
  ctx.fillStyle = clip.params.color || "#000000";
  if (dir === "right") ctx.fillRect(0, 0, w * u, h);
  else if (dir === "left") ctx.fillRect(w * (1 - u), 0, w * u, h);
  else if (dir === "down") ctx.fillRect(0, 0, w, h * u);
  else ctx.fillRect(0, h * (1 - u), w, h * u);
  ctx.restore();
}

function drawIris(ctx, w, h, clip, t) {
  const u = easeInOut(progress(clip, t));
  const max = Math.hypot(w, h) / 2;
  const r = clip.params.direction === "in" ? max * u : max * (1 - u);
  ctx.save();
  ctx.fillStyle = clip.params.color || "#000000";
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(w / 2, h / 2, Math.max(0, r), 0, TAU, true);
  ctx.fill("evenodd");
  ctx.restore();
}

// --- screen effects ---------------------------------------------------------

function drawSpeedLines(ctx, w, h, clip, t, amount) {
  const count = Math.round((clip.params.density ?? 0.5) * 90);
  const frame = Math.floor(t * 24);
  ctx.save();
  ctx.globalAlpha = 0.75 * amount;
  ctx.strokeStyle = clip.params.color || "#ffffff";
  ctx.lineCap = "round";
  for (let i = 0; i < count; i++) {
    const a = noise(i * 3.7 + frame * 0.13) * TAU;
    const spread = 0.22 + Math.abs(noise(i * 9.1)) * 0.7;
    const cx = w / 2;
    const cy = h / 2;
    const r0 = Math.min(w, h) * spread;
    const r1 = r0 + Math.min(w, h) * (0.18 + Math.abs(noise(i * 5.3)) * 0.4);
    ctx.lineWidth = 1 + Math.abs(noise(i * 2.1)) * 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.75);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.75);
    ctx.stroke();
  }
  ctx.restore();
}

// Grain is built once per frame into a small tile and scaled up - painting it
// pixel by pixel onto the full frame is far too slow to scrub.
let grainTile = null;

function grainCanvas(frame) {
  if (!grainTile) {
    grainTile = document.createElement("canvas");
    grainTile.width = 160;
    grainTile.height = 90;
  }
  const g = grainTile.getContext("2d");
  const image = g.createImageData(grainTile.width, grainTile.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = noise(i * 0.013 + frame * 7.7);
    const level = 128 + v * 255;
    data[i] = data[i + 1] = data[i + 2] = level;
    data[i + 3] = Math.abs(v) > 0.28 ? 190 : 0;
  }
  g.putImageData(image, 0, 0);
  return grainTile;
}

function drawGrain(ctx, w, h, clip, t, amount) {
  const strength = (clip.params.amount ?? 0.35) * amount;
  const tile = grainCanvas(Math.floor(t * 24));
  ctx.save();
  ctx.globalAlpha = 0.42 * strength;
  ctx.globalCompositeOperation = "overlay";
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tile, 0, 0, w, h);
  ctx.restore();
}

function drawWeather(ctx, w, h, clip, t, amount) {
  const kind = clip.params.kind || "rain";
  const count = Math.round((clip.params.density ?? 0.5) * (kind === "rain" ? 260 : 170));
  ctx.save();
  ctx.globalAlpha = amount * (kind === "rain" ? 0.5 : 0.85);
  for (let i = 0; i < count; i++) {
    const speed = kind === "rain" ? 1.5 : 0.22;
    const drift = kind === "snow" ? Math.sin(t * 1.4 + i) * 0.03 : 0.06;
    const x = ((noise(i * 1.7) + 0.5) + drift * t + t * 0.02 * (i % 3)) % 1;
    const y = ((noise(i * 4.3) + 0.5) + t * speed * (0.6 + Math.abs(noise(i * 8.9)))) % 1;
    const px = x * w;
    const py = y * h;
    if (kind === "rain") {
      ctx.strokeStyle = "#cfe4ff";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - w * 0.008, py + h * 0.045);
      ctx.stroke();
    } else {
      ctx.fillStyle = kind === "ash" ? "#c9c4bd" : "#ffffff";
      ctx.beginPath();
      ctx.arc(px, py, 1.5 + Math.abs(noise(i * 6.1)) * 3, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

// --- overlays: callouts, bubbles, captions ----------------------------------

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

function burstPath(ctx, cx, cy, rx, ry, points, jag) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * TAU - Math.PI / 2;
    const wobble = 1 + noise(i * 1.9) * 0.14;
    const r = (i % 2 ? jag : 1) * wobble;
    const x = cx + Math.cos(a) * rx * r;
    const y = cy + Math.sin(a) * ry * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawCallout(ctx, w, h, clip, t) {
  const u = progress(clip, t);
  const p = clip.params;
  // Punch in fast, hold, snap away - comic hits do not linger.
  const scale = u < 0.18 ? easeInOut(u / 0.18) * 1.12
    : u > 0.82 ? 1.12 * easeInOut((1 - u) / 0.18)
    : 1.12 - 0.12 * easeInOut((u - 0.18) / 0.64);
  if (scale <= 0.01) return;

  const cx = (p.x ?? 0.5) * w;
  const cy = (p.y ?? 0.34) * h;
  const size = (p.size ?? 0.16) * h * scale;
  const text = (p.text || "POW!").toUpperCase();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((p.tilt ?? -0.12));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${size}px "Arial Black", Impact, system-ui, sans-serif`;
  const textW = ctx.measureText(text).width;

  const style = p.style || "burst";
  if (style !== "plain") {
    const rx = textW * 0.78 + size * 0.5;
    const ry = size * 1.15;
    ctx.lineJoin = "round";
    if (style === "burst") burstPath(ctx, 0, 0, rx, ry, 12, 0.66);
    else if (style === "impact") burstPath(ctx, 0, 0, rx, ry, 8, 0.44);
    else {
      ctx.beginPath();
      ctx.moveTo(-rx, -ry * 0.62);
      ctx.lineTo(rx, -ry);
      ctx.lineTo(rx, ry * 0.62);
      ctx.lineTo(-rx, ry);
      ctx.closePath();
    }
    ctx.fillStyle = p.fill || "#ffd233";
    ctx.strokeStyle = p.ink || "#101014";
    ctx.lineWidth = Math.max(3, size * 0.09);
    ctx.fill();
    ctx.stroke();
  }

  ctx.lineWidth = Math.max(3, size * 0.12);
  ctx.strokeStyle = p.ink || "#101014";
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = p.color || "#e8322a";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawBubble(ctx, w, h, clip, t) {
  const p = clip.params;
  const amount = sustain(clip, t, 0.12);
  if (amount <= 0.01) return;
  const size = (p.size ?? 0.045) * h;
  const cx = (p.x ?? 0.5) * w;
  const cy = (p.y ?? 0.22) * h;
  const maxW = w * 0.36;

  ctx.save();
  ctx.globalAlpha = amount;
  ctx.font = `600 ${size}px system-ui, "Segoe UI", sans-serif`;
  const lines = wrapText(ctx, p.text || "...", maxW);
  const lineH = size * 1.28;
  const boxW = Math.max(size * 3, Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)))) + size * 1.4;
  const boxH = lines.length * lineH + size * 1.1;
  const left = cx - boxW / 2;
  const top = cy - boxH / 2;
  const tailDir = p.tail === "left" ? -1 : 1;
  const kind = p.kind || "speech";

  ctx.fillStyle = p.fill || "#ffffff";
  ctx.strokeStyle = p.ink || "#101014";
  ctx.lineWidth = Math.max(2, size * 0.12);

  if (kind === "shout") {
    burstPath(ctx, cx, cy, boxW * 0.62, boxH * 0.78, 14, 0.78);
    ctx.fill();
    ctx.stroke();
  } else {
    const r = kind === "thought" ? boxH / 2 : size * 0.7;
    ctx.beginPath();
    ctx.roundRect(left, top, boxW, boxH, r);
    ctx.fill();
    ctx.stroke();
  }

  // tail
  if (kind === "thought") {
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx + tailDir * (boxW * 0.28 + i * size * 0.62),
              top + boxH + i * size * 0.6, size * (0.30 - i * 0.06), 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(cx + tailDir * boxW * 0.16, top + boxH - ctx.lineWidth / 2);
    ctx.lineTo(cx + tailDir * boxW * 0.30, top + boxH + size * 1.25);
    ctx.lineTo(cx + tailDir * boxW * 0.36, top + boxH - ctx.lineWidth / 2);
    ctx.closePath();
    ctx.fillStyle = p.fill || "#ffffff";
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = p.color || "#14161c";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, top + size * 0.55 + lineH * (i + 0.5));
  });
  ctx.restore();
}

function drawCaption(ctx, w, h, clip, t) {
  const amount = sustain(clip, t, 0.18);
  if (amount <= 0.01) return;
  const p = clip.params;
  const size = (p.size ?? 0.045) * h;
  ctx.save();
  ctx.globalAlpha = amount;
  ctx.font = `600 ${size}px system-ui, "Segoe UI", sans-serif`;
  const lines = wrapText(ctx, p.text || "", w * 0.82);
  const lineH = size * 1.3;
  const boxH = lines.length * lineH + size * 0.7;
  const top = h - boxH - h * 0.06;
  ctx.fillStyle = "rgba(10,12,16,0.66)";
  ctx.fillRect(0, top, w, boxH);
  ctx.fillStyle = p.color || "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillText(line, w / 2, top + size * 0.35 + lineH * (i + 0.5));
  });
  ctx.restore();
}

function drawTitle(ctx, w, h, clip, t) {
  const amount = sustain(clip, t, 0.22);
  if (amount <= 0.01) return;
  const p = clip.params;
  const size = (p.size ?? 0.11) * h;
  ctx.save();
  ctx.globalAlpha = amount;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${size}px "Arial Black", Impact, system-ui, sans-serif`;
  ctx.lineWidth = Math.max(3, size * 0.1);
  ctx.strokeStyle = p.ink || "#101014";
  ctx.strokeText(p.text || "TITLE", w / 2, h * 0.44);
  ctx.fillStyle = p.color || "#ffffff";
  ctx.fillText(p.text || "TITLE", w / 2, h * 0.44);
  if (p.sub) {
    ctx.font = `600 ${size * 0.34}px system-ui, sans-serif`;
    ctx.lineWidth = Math.max(2, size * 0.04);
    ctx.strokeText(p.sub, w / 2, h * 0.44 + size * 0.78);
    ctx.fillText(p.sub, w / 2, h * 0.44 + size * 0.78);
  }
  ctx.restore();
}

// --- registry ---------------------------------------------------------------

const range = (key, label, min, max, step, value) =>
  ({ key, label, type: "range", min, max, step, value });
const choice = (key, label, options, value) => ({ key, label, type: "select", options, value });
const text = (key, label, value) => ({ key, label, type: "text", value });
const colour = (key, label, value) => ({ key, label, type: "color", value });

export const FX_TYPES = [
  // camera
  { id: "shake", name: "Camera shake", kind: "camera", duration: 0.5,
    fields: [range("amount", "Strength", 2, 60, 1, 16), range("hz", "Speed", 4, 30, 1, 16)] },
  { id: "handheld", name: "Handheld drift", kind: "camera", duration: 6,
    fields: [range("amount", "Strength", 1, 24, 1, 6), range("hz", "Speed", 0.2, 4, 0.1, 0.9)] },
  { id: "punch_zoom", name: "Punch zoom", kind: "camera", duration: 0.45,
    fields: [range("amount", "Zoom", 1.02, 1.8, 0.01, 1.25)] },

  // light
  { id: "lighting", name: "Lighting", kind: "overlay", duration: 6,
    fields: [choice("preset", "Look", ["day", "golden", "night", "moonlight", "interior", "storm", "sickly"], "night"),
             range("strength", "Strength", 0, 1.4, 0.05, 1)] },
  { id: "vignette", name: "Vignette", kind: "overlay", duration: 6,
    fields: [range("strength", "Strength", 0, 1, 0.05, 0.5)] },

  // transitions
  { id: "fade", name: "Fade", kind: "overlay", duration: 1,
    fields: [choice("direction", "Direction", ["out", "in"], "in"), colour("color", "Colour", "#000000")] },
  { id: "flash", name: "Flash", kind: "overlay", duration: 0.3,
    fields: [colour("color", "Colour", "#ffffff")] },
  { id: "wipe", name: "Wipe", kind: "overlay", duration: 0.8,
    fields: [choice("direction", "Direction", ["right", "left", "down", "up"], "right"),
             colour("color", "Colour", "#000000")] },
  { id: "iris", name: "Iris", kind: "overlay", duration: 1.2,
    fields: [choice("direction", "Direction", ["in", "out"], "in"), colour("color", "Colour", "#000000")] },

  // screen
  { id: "speed_lines", name: "Speed lines", kind: "overlay", duration: 0.6,
    fields: [range("density", "Density", 0.1, 1, 0.05, 0.5), colour("color", "Colour", "#ffffff")] },
  { id: "grain", name: "Film grain", kind: "overlay", duration: 6,
    fields: [range("amount", "Amount", 0.05, 1, 0.05, 0.35)] },
  { id: "weather", name: "Weather", kind: "overlay", duration: 6,
    fields: [choice("kind", "Kind", ["rain", "snow", "ash"], "rain"),
             range("density", "Density", 0.1, 1, 0.05, 0.5)] },

  // overlays
  { id: "callout", name: "Comic callout", kind: "overlay", duration: 0.9,
    fields: [text("text", "Word", "POW!"),
             choice("style", "Shape", ["burst", "impact", "slice", "plain"], "burst"),
             range("x", "X", 0, 1, 0.01, 0.5), range("y", "Y", 0, 1, 0.01, 0.34),
             range("size", "Size", 0.04, 0.4, 0.01, 0.16),
             range("tilt", "Tilt", -0.6, 0.6, 0.02, -0.12),
             colour("color", "Text", "#e8322a"), colour("fill", "Burst", "#ffd233")] },
  { id: "bubble", name: "Speech bubble", kind: "overlay", duration: 2.5,
    fields: [text("text", "Text", "Hey!"),
             choice("kind", "Kind", ["speech", "thought", "shout"], "speech"),
             choice("tail", "Tail", ["right", "left"], "right"),
             range("x", "X", 0, 1, 0.01, 0.5), range("y", "Y", 0, 1, 0.01, 0.22),
             range("size", "Size", 0.02, 0.1, 0.005, 0.045)] },
  { id: "caption", name: "Caption", kind: "overlay", duration: 3,
    fields: [text("text", "Text", ""), range("size", "Size", 0.02, 0.09, 0.005, 0.045)] },
  { id: "title", name: "Title card", kind: "overlay", duration: 3,
    fields: [text("text", "Title", "EPISODE ONE"), text("sub", "Subtitle", ""),
             range("size", "Size", 0.05, 0.25, 0.01, 0.11)] },

  // audio
  // The sound list is filled in at runtime from the bundled bank plus uploads.
  { id: "sfx", name: "Sound effect", kind: "audio", duration: 0.5,
    fields: [{ key: "sound", label: "Sound", type: "sound", value: "slap" },
             range("gain", "Volume", 0.1, 2, 0.05, 1)] },
];

export function fxType(id) {
  return FX_TYPES.find((t) => t.id === id) || null;
}

/** A new clip of `typeId` at time `start`, with its default parameters. */
export function makeClip(typeId, start) {
  const type = fxType(typeId);
  if (!type) return null;
  const params = {};
  for (const field of type.fields) params[field.key] = field.value;
  return {
    id: `fx_${Math.random().toString(36).slice(2, 9)}`,
    type: typeId,
    start: Math.max(0, start),
    duration: type.duration,
    params,
  };
}

/**
 * Nudge the camera for any active camera clips. Called after the camera
 * keyframes have been evaluated and before the scene is drawn, so shakes ride
 * on top of whatever move is already happening.
 */
export function applyCameraFx(stage, clips, t) {
  for (const clip of clips) {
    if (!isActive(clip, t)) continue;
    const type = fxType(clip.type);
    if (!type || type.kind !== "camera") continue;
    const local = t - clip.start;

    if (clip.type === "shake") {
      // Decay over the clip so a hit settles instead of rattling on.
      const decay = 1 - progress(clip, t);
      const amount = (clip.params.amount ?? 16) * decay * decay;
      const hz = clip.params.hz ?? 16;
      stage.camera.x += noise(Math.floor(local * hz) * 1.3) * 2 * amount / stage.camera.zoom;
      stage.camera.y += noise(Math.floor(local * hz) * 7.7) * 2 * amount / stage.camera.zoom;
    } else if (clip.type === "handheld") {
      const amount = (clip.params.amount ?? 6) * sustain(clip, t, 0.4);
      const hz = clip.params.hz ?? 0.9;
      stage.camera.x += Math.sin(local * TAU * hz) * amount / stage.camera.zoom;
      stage.camera.y += Math.sin(local * TAU * hz * 0.73 + 1.1) * amount * 0.7 / stage.camera.zoom;
    } else if (clip.type === "punch_zoom") {
      const u = progress(clip, t);
      // Slam to the target, then ease back to normal.
      const shape = u < 0.25 ? easeInOut(u / 0.25) : easeInOut((1 - u) / 0.75);
      stage.camera.zoom *= 1 + ((clip.params.amount ?? 1.25) - 1) * shape;
    }
  }
}

/** Draw every active overlay clip on top of the finished frame. */
export function renderOverlayFx(stage, clips, t) {
  const ctx = stage.ctx;
  const w = stage.canvas.width;
  const h = stage.canvas.height;
  // Sort so light and weather sit under text and callouts.
  const order = ["lighting", "vignette", "weather", "grain", "speed_lines",
                 "wipe", "iris", "fade", "flash", "bubble", "caption", "title", "callout"];
  const active = clips
    .filter((c) => isActive(c, t) && fxType(c.type)?.kind === "overlay")
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

  for (const clip of active) {
    const amount = sustain(clip, t, 0.2);
    switch (clip.type) {
      case "lighting": drawLighting(ctx, w, h, clip, amount); break;
      case "vignette": drawVignette(ctx, w, h, (clip.params.strength ?? 0.5) * amount); break;
      case "fade": drawFade(ctx, w, h, clip, t); break;
      case "flash": drawFlash(ctx, w, h, clip, t); break;
      case "wipe": drawWipe(ctx, w, h, clip, t); break;
      case "iris": drawIris(ctx, w, h, clip, t); break;
      case "speed_lines": drawSpeedLines(ctx, w, h, clip, t, amount); break;
      case "grain": drawGrain(ctx, w, h, clip, t, amount); break;
      case "weather": drawWeather(ctx, w, h, clip, t, amount); break;
      case "callout": drawCallout(ctx, w, h, clip, t); break;
      case "bubble": drawBubble(ctx, w, h, clip, t); break;
      case "caption": drawCaption(ctx, w, h, clip, t); break;
      case "title": drawTitle(ctx, w, h, clip, t); break;
      default: break;
    }
  }
}

/** Audio clips on the FX track, as {buffer, offset, gain} for playback/export. */
export function fxAudioSources(clips) {
  return clips
    .filter((c) => fxType(c.type)?.kind === "audio" && c.buffer)
    .map((c) => ({ buffer: c.buffer, offset: c.start, gain: c.params.gain ?? 1 }));
}

/** Latest time any clip runs to. */
export function fxDuration(clips) {
  return clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0);
}
