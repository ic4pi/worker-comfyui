// UI wiring for Lip Sync Studio.

import {
  createStage, loadBackdropFromUrl, loadBackdropFromFile, renderFrame,
  screenToWorld, actorAt, fitCamera, fillZoom, horizonY, bottomY,
} from "./stage.js";
import {
  loadRigFromUrl, loadRigFromFiles, mergeRigFiles, rigCoverage, availableAngles,
} from "./rig.js";
import { analyzeAudio, applyTranscript } from "./lipsync.js";
import {
  evaluateScene, evalCamera, putKey, sortKeys, sceneDuration, followActor,
} from "./animate.js";
import { recordWebM, exportPngSequence, downloadBlob } from "./record.js";
import { loadKitIndex, loadKit } from "./mouthkit.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stage = createStage(canvas);

const state = {
  cameraKeys: [],
  time: 0,
  duration: 10,
  holdFps: 12,
  playing: false,
  selected: null,
  library: [],
  kits: [],
  defaultKitId: null,
  audioCtx: null,
  playingSources: [],
  nextActorId: 1,
};

// ---------------------------------------------------------------- rendering

function currentCamera() {
  return evalCamera(state.cameraKeys, state.time, stage.camera);
}

let lastPoses = [];

function renderAt(t) {
  state.time = Math.min(state.duration, Math.max(0, t));
  const cam = evalCamera(state.cameraKeys, state.time, stage.camera);
  if (state.cameraKeys.length) Object.assign(stage.camera, cam);
  lastPoses = evaluateScene(stage, state.time, { holdFps: state.holdFps });
  renderFrame(stage, lastPoses);
  $("timeNow").textContent = state.time.toFixed(2);
  $("scrub").value = String(state.time);
}

function render() {
  renderAt(state.time);
}

// ----------------------------------------------------------------- playback

function audioContext() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return state.audioCtx;
}

function stopAudio() {
  state.playingSources.forEach((s) => {
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
  });
  state.playingSources = [];
}

function startAudio(fromTime) {
  const ctx = audioContext();
  ctx.resume();
  for (const actor of stage.actors) {
    if (!actor.audio) continue;
    const offset = actor.audioOffset || 0;
    const end = offset + actor.audio.buffer.duration;
    if (end <= fromTime) continue;
    const src = ctx.createBufferSource();
    src.buffer = actor.audio.buffer;
    src.connect(ctx.destination);
    src.start(ctx.currentTime + Math.max(0, offset - fromTime), Math.max(0, fromTime - offset));
    state.playingSources.push(src);
  }
}

let rafId = 0;

function play() {
  if (state.playing) return;
  if (state.time >= state.duration - 0.01) state.time = 0;
  state.playing = true;
  $("playBtn").textContent = "Pause";
  startAudio(state.time);
  const base = performance.now() / 1000 - state.time;
  const tick = () => {
    if (!state.playing) return;
    const t = performance.now() / 1000 - base;
    if (t >= state.duration) {
      renderAt(state.duration);
      pause();
      return;
    }
    renderAt(t);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function pause() {
  state.playing = false;
  $("playBtn").textContent = "Play";
  cancelAnimationFrame(rafId);
  stopAudio();
}

// --------------------------------------------------------------------- cast

function makeActor(rig) {
  const y = stage.backdrop ? bottomY(stage) - stage.backdrop.height * 0.06 : canvas.height * 0.85;
  const x = stage.backdrop ? stage.camera.x : canvas.width / 2;
  return {
    id: `actor${state.nextActorId++}`,
    name: rig.name,
    rig,
    keys: [{ t: 0, x, y }],
    walk: { enabled: true, stepHz: 2.2, bobUnits: 0.055 },
    scaleMul: 1,
    flip: false,
    autoAngle: true,
    restAngle: availableAngles(rig)[0],
    mouthKit: state.defaultKit || null,
    mouthKitId: state.defaultKitId,
    audio: null,
    audioOffset: 0,
    track: null,
    visible: true,
  };
}

function addActor(rig) {
  const actor = makeActor(rig);
  stage.actors.push(actor);
  select(actor);
  refreshCast();
  refreshDuration();
  render();
  return actor;
}

function select(actor) {
  state.selected = actor;
  refreshCast();
  refreshInspector();
}

function refreshCast() {
  const list = $("castList");
  list.innerHTML = "";
  for (const actor of stage.actors) {
    const li = document.createElement("li");
    li.className = actor === state.selected ? "selected" : "";
    li.innerHTML = `<span class="name"></span><span class="tag"></span>`;
    li.querySelector(".name").textContent = actor.name;
    li.querySelector(".tag").textContent = actor.audio ? "audio" : "silent";
    li.addEventListener("click", () => select(actor));
    list.appendChild(li);
  }
}

function refreshInspector() {
  const actor = state.selected;
  $("inspector").hidden = !actor;
  $("noSelection").hidden = Boolean(actor);
  if (!actor) return;

  $("actorName").value = actor.name;
  $("actorHeight").value = actor.rig.heightUnits.toFixed(2);
  $("actorScale").value = String(actor.scaleMul);
  $("actorScaleOut").textContent = actor.scaleMul.toFixed(2);
  $("autoAngle").checked = actor.autoAngle !== false;
  $("flip").checked = Boolean(actor.flip);
  fillKitSelect($("actorKit"), actor.mouthKitId ?? "");
  $("walkOn").checked = Boolean(actor.walk?.enabled);
  $("stepHz").value = String(actor.walk?.stepHz ?? 2.2);
  $("stepHzOut").textContent = (actor.walk?.stepHz ?? 2.2).toFixed(2);
  $("bobUnits").value = String(actor.walk?.bobUnits ?? 0.055);
  $("bobUnitsOut").textContent = (actor.walk?.bobUnits ?? 0.055).toFixed(3);
  $("audioOffset").value = String(actor.audioOffset || 0);
  $("keyInfo").textContent = `${actor.keys.length} position key${actor.keys.length === 1 ? "" : "s"}`;

  const angles = availableAngles(actor.rig);
  fillSelect($("restAngle"), angles, actor.restAngle);
  fillSelect($("tuneAngle"), angles, $("tuneAngle").value && angles.includes($("tuneAngle").value) ? $("tuneAngle").value : angles[0]);
  refreshMouthFit();

  const cover = rigCoverage(actor.rig);
  const label = { draft: "Draft", quick: "Quick", standard: "Standard", full: "Full" }[cover.tier];
  $("coverage").textContent = cover.next.length
    ? `${label} rig — ${cover.angles} angle(s), ${cover.fewestMouths} mouth shapes. Next: ${cover.next[0]}`
    : `${label} rig — ${cover.angles} angles, ${cover.fewestMouths} mouth shapes. Nothing missing.`;

  $("audioInfo").textContent = actor.audio
    ? `${actor.audio.name} — ${actor.audio.buffer.duration.toFixed(2)}s, ${actor.track.frames.length} viseme frames`
    : "No audio on this character.";
  $("transcript").value = actor.transcript || "";
}

function fillSelect(select, values, chosen) {
  select.innerHTML = "";
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v.replace(/_/g, " ");
    select.appendChild(opt);
  }
  if (chosen) select.value = chosen;
}

function tunedAngle() {
  const actor = state.selected;
  if (!actor) return null;
  return actor.rig.angles[$("tuneAngle").value] || null;
}

function refreshMouthFit() {
  const angle = tunedAngle();
  if (!angle) return;
  const w = angle.body.naturalWidth;
  const h = angle.body.naturalHeight;
  $("mouthX").value = String(angle.mouth[0] / w);
  $("mouthY").value = String(angle.mouth[1] / h);
  $("mouthScale").value = String(angle.mouthScale);
  $("mouthScaleOut").textContent = angle.mouthScale.toFixed(2);
}

function refreshDuration() {
  const needed = Math.max(sceneDuration(stage, state.cameraKeys), Number($("duration").value) || 1);
  state.duration = needed;
  $("duration").value = needed.toFixed(1);
  $("scrub").max = String(needed);
  $("timeEnd").textContent = needed.toFixed(2);
}

function fillKitSelect(select, chosen) {
  select.innerHTML = "";
  const own = document.createElement("option");
  own.value = "";
  own.textContent = "own art only";
  select.appendChild(own);
  for (const entry of state.kits) {
    const opt = document.createElement("option");
    opt.value = entry.id;
    opt.textContent = entry.name;
    select.appendChild(opt);
  }
  select.value = chosen ?? "";
}

/** Resolve a kit id to loaded images, or null for "own art only". */
async function kitById(id) {
  if (!id) return null;
  const entry = state.kits.find((k) => k.id === id);
  return entry ? loadKit(entry) : null;
}

// ------------------------------------------------------------------ library

async function loadLibrary() {
  try {
    const res = await fetch("assets/characters/index.json");
    if (!res.ok) throw new Error("no library");
    state.library = await res.json();
    fillSelect($("libraryPick"), state.library.map((c) => c.name));
    $("libraryPick").innerHTML = "";
    state.library.forEach((c, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = c.name;
      $("libraryPick").appendChild(opt);
    });
  } catch {
    $("libraryPick").innerHTML = '<option>— no bundled characters —</option>';
  }
}

async function loadKits() {
  try {
    state.kits = await loadKitIndex();
  } catch {
    state.kits = [];
  }
  // Default to the first human kit so a fresh character can talk immediately.
  const human = state.kits.find((k) => k.kind === "human");
  state.defaultKitId = human ? human.id : (state.kits[0]?.id ?? null);
  state.defaultKit = await kitById(state.defaultKitId);
  fillKitSelect($("defaultKit"), state.defaultKitId ?? "");
}

$("defaultKit").addEventListener("change", async (e) => {
  state.defaultKitId = e.target.value || null;
  state.defaultKit = await kitById(state.defaultKitId);
  status(state.defaultKitId
    ? `New characters will use the ${state.defaultKitId} mouth kit.`
    : "New characters will use their own mouth art only.");
});

$("actorKit").addEventListener("change", async (e) => {
  const actor = state.selected;
  if (!actor) return;
  actor.mouthKitId = e.target.value || null;
  actor.mouthKit = await kitById(actor.mouthKitId);
  render();
  status(`${actor.name}: ${actor.mouthKitId || "own art only"}.`);
});

// ------------------------------------------------------------- interactions

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

let drag = null;

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = canvasPoint(e);
  const hit = actorAt(stage, lastPoses, p.x, p.y);
  if (hit) {
    select(hit);
    const w = screenToWorld(stage, p.x, p.y);
    const pose = lastPoses.find((q) => q.actor === hit);
    drag = { kind: "actor", actor: hit, dx: pose.x - w.x, dy: pose.y - w.y };
  } else {
    drag = { kind: "camera", start: p, camX: stage.camera.x, camY: stage.camera.y };
    canvas.classList.add("dragging");
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const p = canvasPoint(e);
  if (drag.kind === "actor") {
    const w = screenToWorld(stage, p.x, p.y);
    const key = { t: state.time, x: w.x + drag.dx, y: w.y + drag.dy };
    // A character with a single key is being placed, not animated - move it
    // wholesale instead of dropping a second key at the playhead.
    if (drag.actor.keys.length === 1) Object.assign(drag.actor.keys[0], { x: key.x, y: key.y });
    else putKey(drag.actor.keys, key);
  } else {
    stage.camera.x = drag.camX - (p.x - drag.start.x) / stage.camera.zoom;
    stage.camera.y = drag.camY - (p.y - drag.start.y) / stage.camera.zoom;
    state.cameraKeys = state.cameraKeys.length ? state.cameraKeys : [];
  }
  render();
});

function endDrag() {
  if (drag?.kind === "actor") {
    $("keyInfo").textContent = `${drag.actor.keys.length} position key${drag.actor.keys.length === 1 ? "" : "s"}`;
  }
  drag = null;
  canvas.classList.remove("dragging");
  refreshDuration();
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const p = canvasPoint(e);
  const before = screenToWorld(stage, p.x, p.y);
  const factor = Math.exp(-e.deltaY * 0.0014);
  stage.camera.zoom = Math.min(12, Math.max(0.02, stage.camera.zoom * factor));
  const after = screenToWorld(stage, p.x, p.y);
  stage.camera.x += before.x - after.x;
  stage.camera.y += before.y - after.y;
  render();
}, { passive: false });

// ------------------------------------------------------------------ controls

$("addFromLibrary").addEventListener("click", async () => {
  const idx = Number($("libraryPick").value);
  const entry = state.library[idx];
  if (!entry) return;
  status("Loading character…");
  try {
    const rig = await loadRigFromUrl(`assets/characters/${entry.rig}`);
    addActor(rig);
    status(`Added ${rig.name}.`);
  } catch (err) {
    status(err.message, true);
  }
});

$("importRig").addEventListener("change", async (e) => {
  const files = e.target.files;
  if (!files?.length) return;
  status("Importing character…");
  try {
    const folder = (files[0].webkitRelativePath || "").split("/")[0];
    const { rig, skipped } = await loadRigFromFiles(files, { name: folder || "Imported", id: folder || "imported" });
    rig.imported = true;
    addActor(rig);
    status(skipped.length ? `Added ${rig.name}. Skipped: ${skipped.join("; ")}` : `Added ${rig.name}.`);
  } catch (err) {
    status(err.message, true);
  }
  e.target.value = "";
});

$("upgradeRig").addEventListener("change", async (e) => {
  const files = e.target.files;
  const actor = state.selected;
  if (!files?.length) return;
  if (!actor) {
    status("Select the character to upgrade first.", true);
    e.target.value = "";
    return;
  }
  status("Merging new art…");
  try {
    const { added, skipped } = await mergeRigFiles(actor.rig, files);
    refreshInspector();
    render();
    status(added.length
      ? `Upgraded ${actor.name}: added ${added.length} image(s).${skipped.length ? ` Skipped: ${skipped.join("; ")}` : ""}`
      : `Nothing to add. ${skipped.join("; ")}`);
  } catch (err) {
    status(err.message, true);
  }
  e.target.value = "";
});

$("loadSampleBackdrop").addEventListener("click", async () => {
  status("Loading backdrop…");
  try {
    stage.backdrop = await loadBackdropFromUrl("assets/backgrounds/boulevard/backdrop.json");
    onBackdropLoaded();
    status(`Backdrop: ${stage.backdrop.name}.`);
  } catch (err) {
    status(err.message, true);
  }
});

$("backdropFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  stage.backdrop = await loadBackdropFromFile(file);
  onBackdropLoaded();
  status(`Backdrop: ${file.name}.`);
  e.target.value = "";
});

function onBackdropLoaded() {
  $("horizon").value = String(stage.backdrop.horizon);
  $("horizonOut").textContent = stage.backdrop.horizon.toFixed(2);
  // Default to a tight framing that clips the edges - pulling out from here is
  // what sells forward movement.
  fitCamera(stage);
  stage.camera.zoom = fillZoom(stage) * 2.2;
  stage.camera.y = bottomY(stage) - canvas.height / stage.camera.zoom / 2;
  // A person at the front of the shot should stand about this tall.
  stage.unitPxAtGround = ((bottomY(stage) - horizonY(stage)) * 0.9) / 1.7;
  $("unitPx").value = String(Math.round(stage.unitPxAtGround));
  $("unitPxOut").textContent = String(Math.round(stage.unitPxAtGround));
  render();
}

$("horizon").addEventListener("input", (e) => {
  if (!stage.backdrop) return;
  stage.backdrop.horizon = Number(e.target.value);
  $("horizonOut").textContent = stage.backdrop.horizon.toFixed(2);
  render();
});

$("unitPx").addEventListener("input", (e) => {
  stage.unitPxAtGround = Number(e.target.value);
  $("unitPxOut").textContent = e.target.value;
  render();
});

$("guides").addEventListener("change", (e) => {
  stage.showGuides = e.target.checked;
  render();
});

// --- dialogue ---------------------------------------------------------------

async function analyzeForSelected(file) {
  const actor = state.selected;
  if (!actor) {
    status("Select a character first.", true);
    return;
  }
  const ctx = audioContext();
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  actor.audio = { buffer, name: file.name };
  runAnalysis(actor);
}

function runAnalysis(actor) {
  if (!actor?.audio) return;
  const sensitivity = Number($("sensitivity").value);
  let track = analyzeAudio(actor.audio.buffer, { fps: 24, sensitivity });
  actor.transcript = $("transcript").value.trim();
  if (actor.transcript) track = applyTranscript(track, actor.transcript);
  actor.track = track;
  refreshCast();
  refreshInspector();
  refreshDuration();
  render();
  status(`Analyzed ${actor.audio.name}: ${track.frames.length} frames.`);
}

$("audioFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  status("Decoding audio…");
  try {
    await analyzeForSelected(file);
  } catch (err) {
    status(err.message, true);
  }
  e.target.value = "";
});

$("reanalyze").addEventListener("click", () => runAnalysis(state.selected));
$("sensitivity").addEventListener("input", (e) => {
  $("sensitivityOut").textContent = Number(e.target.value).toFixed(2);
});
$("audioOffset").addEventListener("input", (e) => {
  if (state.selected) state.selected.audioOffset = Number(e.target.value) || 0;
  refreshDuration();
  render();
});

// --- inspector --------------------------------------------------------------

function bindActor(id, apply, format) {
  $(id).addEventListener("input", (e) => {
    if (!state.selected) return;
    apply(state.selected, e.target);
    if (format) format(e.target);
    render();
  });
}

bindActor("actorName", (a, el) => {
  a.name = el.value;
  refreshCast();
});
bindActor("actorHeight", (a, el) => {
  const h = Number(el.value);
  if (h > 0) {
    a.rig.heightUnits = h;
    a.rig.pixelsPerUnit = a.rig.anchor[1] / h;
  }
});
bindActor("actorScale", (a, el) => {
  a.scaleMul = Number(el.value);
}, (el) => {
  $("actorScaleOut").textContent = Number(el.value).toFixed(2);
});
bindActor("autoAngle", (a, el) => {
  a.autoAngle = el.checked;
});
bindActor("restAngle", (a, el) => {
  a.restAngle = el.value;
});
bindActor("flip", (a, el) => {
  a.flip = el.checked;
});
bindActor("walkOn", (a, el) => {
  a.walk = { ...(a.walk || {}), enabled: el.checked };
});
bindActor("stepHz", (a, el) => {
  a.walk = { ...(a.walk || {}), stepHz: Number(el.value) };
}, (el) => {
  $("stepHzOut").textContent = Number(el.value).toFixed(2);
});
bindActor("bobUnits", (a, el) => {
  a.walk = { ...(a.walk || {}), bobUnits: Number(el.value) };
}, (el) => {
  $("bobUnitsOut").textContent = Number(el.value).toFixed(3);
});

$("tuneAngle").addEventListener("change", refreshMouthFit);
["mouthX", "mouthY", "mouthScale"].forEach((id) => {
  $(id).addEventListener("input", () => {
    const angle = tunedAngle();
    if (!angle) return;
    angle.mouth[0] = Number($("mouthX").value) * angle.body.naturalWidth;
    angle.mouth[1] = Number($("mouthY").value) * angle.body.naturalHeight;
    angle.mouthScale = Number($("mouthScale").value);
    $("mouthScaleOut").textContent = angle.mouthScale.toFixed(2);
    render();
  });
});

$("keyHere").addEventListener("click", () => {
  const actor = state.selected;
  if (!actor) return;
  const pose = lastPoses.find((p) => p.actor === actor);
  if (!pose) return;
  putKey(actor.keys, { t: state.time, x: pose.x, y: pose.y });
  refreshDuration();
  $("keyInfo").textContent = `${actor.keys.length} position keys`;
  render();
});

$("clearKeys").addEventListener("click", () => {
  const actor = state.selected;
  if (!actor) return;
  const first = actor.keys[0];
  actor.keys = [{ t: 0, x: first.x, y: first.y }];
  $("keyInfo").textContent = "1 position key";
  render();
});

$("removeActor").addEventListener("click", () => {
  const actor = state.selected;
  if (!actor) return;
  stage.actors = stage.actors.filter((a) => a !== actor);
  select(stage.actors[0] || null);
  render();
});

// --- camera moves -----------------------------------------------------------

function keyCamera(t, cam) {
  putKey(state.cameraKeys, { t, x: cam.x, y: cam.y, zoom: cam.zoom });
  sortKeys(state.cameraKeys);
  refreshDuration();
  $("camInfo").textContent = `${state.cameraKeys.length} camera key${state.cameraKeys.length === 1 ? "" : "s"}`;
}

$("camKey").addEventListener("click", () => keyCamera(state.time, stage.camera));
$("camClear").addEventListener("click", () => {
  state.cameraKeys = [];
  $("camInfo").textContent = "No camera keys — camera is static.";
  render();
});

function makeMove(mutate, seconds = 4) {
  const from = { ...stage.camera };
  const to = mutate({ ...from });
  state.cameraKeys = [];
  keyCamera(state.time, from);
  keyCamera(state.time + seconds, to);
  render();
}

$("movePushIn").addEventListener("click", () => makeMove((c) => ({ ...c, zoom: c.zoom * 1.8 })));
$("movePullOut").addEventListener("click", () => makeMove((c) => ({ ...c, zoom: c.zoom / 1.8 })));
$("movePanRight").addEventListener("click", () => makeMove((c) => ({ ...c, x: c.x + canvas.width / c.zoom * 0.9 })));
$("movePanLeft").addEventListener("click", () => makeMove((c) => ({ ...c, x: c.x - canvas.width / c.zoom * 0.9 })));
$("moveFit").addEventListener("click", () => {
  state.cameraKeys = [];
  fitCamera(stage);
  render();
});
$("moveFollow").addEventListener("click", () => {
  const actor = state.selected;
  if (!actor || actor.keys.length < 2) {
    status("Give the character at least two position keys first.", true);
    return;
  }
  state.cameraKeys = followActor(actor, stage.camera.zoom);
  $("camInfo").textContent = `${state.cameraKeys.length} camera keys (following ${actor.name})`;
  render();
});

// --- transport --------------------------------------------------------------

$("playBtn").addEventListener("click", () => (state.playing ? pause() : play()));
$("scrub").addEventListener("input", (e) => {
  pause();
  renderAt(Number(e.target.value));
});
$("holdFps").addEventListener("change", (e) => {
  state.holdFps = Number(e.target.value);
  render();
});
$("duration").addEventListener("input", (e) => {
  state.duration = Math.max(1, Number(e.target.value) || 1);
  $("scrub").max = String(state.duration);
  $("timeEnd").textContent = state.duration.toFixed(2);
});

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  if (e.code === "Space") {
    e.preventDefault();
    state.playing ? pause() : play();
  }
  if (e.key === "ArrowLeft") renderAt(state.time - 1 / 24);
  if (e.key === "ArrowRight") renderAt(state.time + 1 / 24);
});

// --- export -----------------------------------------------------------------

function status(text, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.style.color = isError ? "var(--danger)" : "var(--accent)";
}

function exportBusy(busy) {
  ["recordWebm", "recordPng", "playBtn"].forEach((id) => {
    $(id).disabled = busy;
  });
  $("exportProgress").hidden = !busy;
  $("exportProgress").value = 0;
}

$("recordWebm").addEventListener("click", async () => {
  pause();
  exportBusy(true);
  status("Recording in real time…");
  try {
    const blob = await recordWebM({
      canvas,
      duration: state.duration,
      fps: 30,
      audioSources: stage.actors
        .filter((a) => a.audio)
        .map((a) => ({ buffer: a.audio.buffer, offset: a.audioOffset || 0 })),
      renderAt,
      onProgress: (p) => {
        $("exportProgress").value = p;
      },
    });
    downloadBlob(blob, "lipsync-shot.webm");
    status("Saved lipsync-shot.webm");
  } catch (err) {
    status(err.message, true);
  }
  exportBusy(false);
});

$("recordPng").addEventListener("click", async () => {
  pause();
  exportBusy(true);
  status("Rendering frames…");
  try {
    const blob = await exportPngSequence({
      canvas,
      duration: state.duration,
      fps: 24,
      renderAt,
      onProgress: (p) => {
        $("exportProgress").value = p;
      },
    });
    downloadBlob(blob, "lipsync-frames.zip");
    status("Saved lipsync-frames.zip");
  } catch (err) {
    status(err.message, true);
  }
  exportBusy(false);
});

// --- project save / load ----------------------------------------------------

$("saveProject").addEventListener("click", () => {
  const imported = stage.actors.filter((a) => a.rig.imported).map((a) => a.name);
  const data = {
    version: 1,
    duration: state.duration,
    holdFps: state.holdFps,
    unitPxAtGround: stage.unitPxAtGround,
    camera: { ...stage.camera },
    cameraKeys: state.cameraKeys,
    backdrop: stage.backdrop
      ? { name: stage.backdrop.name, horizon: stage.backdrop.horizon }
      : null,
    actors: stage.actors.map((a) => ({
      name: a.name,
      rigId: a.rig.id,
      imported: Boolean(a.rig.imported),
      keys: a.keys,
      walk: a.walk,
      scaleMul: a.scaleMul,
      flip: a.flip,
      autoAngle: a.autoAngle,
      restAngle: a.restAngle,
      audioOffset: a.audioOffset,
      mouthKitId: a.mouthKitId || null,
      transcript: a.transcript || "",
      track: a.track,
    })),
  };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "lipsync-project.json");
  status(imported.length
    ? `Saved. Imported art is not embedded — re-import folders for: ${imported.join(", ")}`
    : "Saved lipsync-project.json");
});

$("loadProject").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    state.cameraKeys = data.cameraKeys || [];
    state.holdFps = data.holdFps ?? 12;
    $("holdFps").value = String(state.holdFps);
    stage.unitPxAtGround = data.unitPxAtGround || stage.unitPxAtGround;
    stage.actors = [];
    const missing = [];
    for (const spec of data.actors || []) {
      const entry = state.library.find((c) => c.id === spec.rigId);
      if (!entry) {
        missing.push(spec.name);
        continue;
      }
      const rig = await loadRigFromUrl(`assets/characters/${entry.rig}`);
      const actor = makeActor(rig);
      Object.assign(actor, {
        name: spec.name, keys: spec.keys, walk: spec.walk, scaleMul: spec.scaleMul,
        flip: spec.flip, autoAngle: spec.autoAngle, restAngle: spec.restAngle,
        audioOffset: spec.audioOffset, transcript: spec.transcript, track: spec.track,
      });
      actor.mouthKitId = spec.mouthKitId ?? state.defaultKitId;
      actor.mouthKit = await kitById(actor.mouthKitId);
      stage.actors.push(actor);
    }
    if (data.camera) Object.assign(stage.camera, data.camera);
    if (data.backdrop && stage.backdrop) stage.backdrop.horizon = data.backdrop.horizon;
    select(stage.actors[0] || null);
    refreshCast();
    refreshDuration();
    render();
    status(missing.length
      ? `Loaded. Re-import art and audio for: ${missing.join(", ")}`
      : "Project loaded. Audio still needs re-loading.");
  } catch (err) {
    status(`Could not load project: ${err.message}`, true);
  }
  e.target.value = "";
});

// ------------------------------------------------------------------ start up

async function boot() {
  await loadLibrary();
  await loadKits();
  try {
    stage.backdrop = await loadBackdropFromUrl("assets/backgrounds/boulevard/backdrop.json");
    onBackdropLoaded();
  } catch {
    render();
  }
  refreshDuration();
  refreshInspector();
  status("Add a character, load audio, then press Play.");
}

boot();
