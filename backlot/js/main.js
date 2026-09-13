// UI wiring for Backlot.

import {
  createStage, loadBackdropFromUrl, loadBackdropFromFile, addBackdropLayer,
  syncBackdropVideo, seekBackdropVideo, renderFrame,
  screenToWorld, actorAt, fitCamera, fillZoom, horizonY, bottomY,
} from "./stage.js";
import {
  loadRigFromUrl, loadRigFromFiles, mergeRigFiles, rigCoverage, availableAngles,
} from "./rig.js";
import { analyzeAudio, applyTranscript } from "./lipsync.js";
import {
  evaluateScene, evalCamera, putKey, sortKeys, sceneDuration, followActor,
  MOVE_TEMPLATES, CAMERA_TEMPLATES, applyTemplate,
} from "./animate.js";
import { recordWebM, exportPngSequence, downloadBlob } from "./record.js";
import { loadKitIndex, loadKit } from "./mouthkit.js";
import {
  FX_TYPES, fxType, makeClip, applyCameraFx, renderOverlayFx, fxAudioSources,
  fxDuration,
} from "./fx.js";
import {
  inRanges, activeLine, linesFor, CAMERA_MODES, directCamera, applyTagAlong,
  captureTagOffsets, planDuration,
} from "./scene.js";
import { createTimeline } from "./timeline.js";
import { VOICE_PRESETS, applyVoice } from "./voice.js";

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
  fx: [],
  selectedFx: null,
  sfxBank: [],
  lines: [],
  selectedLine: null,
  cameraSegments: [],
  audioCtx: null,
  playingSources: [],
  nextActorId: 1,
};

// ----------------------------------------------------------------- timeline

let timeline = null;

/** Describe the whole plan as lanes of clips for the timeline widget. */
function timelineModel() {
  const lanes = [];
  for (const actor of stage.actors) {
    const clips = [];
    (actor.presence || []).forEach((range, i) => {
      clips.push({
        id: `presence:${i}`, start: range.start, duration: Math.max(0.1, range.end - range.start),
        color: "#2f4a63", label: "on screen", ghost: true, ref: range, kind: "presence",
      });
    });
    for (const line of linesFor(state.lines, actor.id)) {
      clips.push({
        id: line.id, start: line.start, duration: line.duration,
        color: line.audio ? "#4f9d69" : "#6b7684",
        label: line.text || "line", ref: line, kind: "line",
      });
    }
    lanes.push({ id: `actor:${actor.id}`, label: actor.name, clips });
  }

  // Camera segments run until the next one starts, so they read as a strip.
  const segs = [...state.cameraSegments].sort((a, b) => a.start - b.start);
  lanes.push({
    id: "camera",
    label: "Camera",
    clips: segs.map((seg, i) => ({
      id: seg.id,
      start: seg.start,
      duration: Math.max(0.2, (segs[i + 1]?.start ?? state.duration) - seg.start),
      color: seg.mode === "follow" ? "#b8546b" : seg.mode === "fixed" ? "#8a6ba8" : "#4a5464",
      label: seg.mode === "follow"
        ? `follow ${stage.actors.find((a) => a.id === seg.target)?.name || "?"}`
        : seg.mode,
      fixedLength: true, ref: seg, kind: "segment",
    })),
  });

  lanes.push({
    id: "fx",
    label: "Effects",
    clips: state.fx.map((clip) => ({
      id: clip.id, start: clip.start, duration: clip.duration,
      color: fxType(clip.type)?.kind === "audio" ? "#d8a12a" : "#5ad1ff",
      label: clip.params.text || fxType(clip.type)?.name || clip.type,
      ref: clip, kind: "fx",
    })),
  });

  return { duration: state.duration, time: state.time, lanes };
}

function setupTimeline() {
  timeline = createTimeline($("timeline"), {
    onScrub: (t) => {
      pause();
      renderAt(t);
    },
    onSelect: (lane, clip) => {
      if (clip.kind === "line") selectLine(clip.ref);
      else if (clip.kind === "fx") {
        selectFx(clip.ref);
        showTab("shot");
      } else if (clip.kind === "segment") {
        $("segMode").value = clip.ref.mode;
        if (clip.ref.target) $("segTarget").value = clip.ref.target;
        state.selectedSegment = clip.ref;
      } else if (clip.kind === "presence") {
        const actor = stage.actors.find((a) => `actor:${a.id}` === lane.id);
        if (actor) select(actor);
      }
    },
    onClipChange: (lane, clip, next) => {
      const ref = clip.ref;
      if (clip.kind === "presence") {
        ref.end = next.start + next.duration;
        ref.start = next.start;
      } else {
        ref.start = next.start;
        if (!clip.fixedLength) ref.duration = next.duration;
      }
      render();
    },
    onClipCommit: () => {
      refreshLineList();
      refreshFxList();
      refreshDuration();
      render();
    },
  });
}

// --------------------------------------------------------------------- tabs

function showTab(name) {
  for (const el of document.querySelectorAll("[data-tab]")) {
    if (el.classList.contains("tab")) el.classList.toggle("active", el.dataset.tab === name);
    else el.hidden = el.dataset.tab !== name;
  }
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) showTab(tab.dataset.tab);
});

// ---------------------------------------------------------------- rendering

function currentCamera() {
  return evalCamera(state.cameraKeys, state.time, stage.camera);
}

let lastPoses = [];

function renderAt(t, options = {}) {
  state.time = Math.min(state.duration, Math.max(0, t));
  const now = state.time;
  syncBackdropVideo(stage, now, options.videoPlaying ?? state.playing);

  // The script decides who is on screen and who is talking, before any
  // animation is evaluated.
  for (const actor of stage.actors) {
    actor.visible = inRanges(actor.presence, now);
    const line = activeLine(state.lines, actor.id, now);
    actor.track = line?.track || null;
    actor.audioOffset = line?.start || 0;
  }

  // Poses are camera-independent, so they can be resolved first and then used
  // to aim the camera at whoever it is following.
  lastPoses = evaluateScene(stage, now, { holdFps: state.holdFps });

  const manual = evalCamera(state.cameraKeys, now, stage.camera);
  if (state.cameraKeys.length) Object.assign(stage.camera, manual);
  const directed = directCamera(stage, state.cameraSegments, lastPoses,
                                { ...stage.camera }, now, state.duration);
  Object.assign(stage.camera, directed);
  applyTagAlong(stage, state.cameraSegments, lastPoses, now, state.duration);

  // Shakes and punches ride on top of whatever the camera was already doing.
  applyCameraFx(stage, state.fx, now);

  renderFrame(stage, lastPoses);
  renderOverlayFx(stage, state.fx, now);
  $("timeNow").textContent = now.toFixed(2);
  $("scrub").value = String(now);
  if (timeline) timeline.setModel(timelineModel());
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
  for (const line of state.lines) {
    if (!line.audio) continue;
    if (line.start + line.audio.buffer.duration <= fromTime) continue;
    const src = ctx.createBufferSource();
    src.buffer = line.audio.buffer;
    src.connect(ctx.destination);
    src.start(ctx.currentTime + Math.max(0, line.start - fromTime),
              Math.max(0, fromTime - line.start));
    state.playingSources.push(src);
  }
  for (const clip of fxAudioSources(state.fx)) {
    if (clip.offset + clip.buffer.duration <= fromTime) continue;
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    const gain = ctx.createGain();
    gain.gain.value = clip.gain;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(ctx.currentTime + Math.max(0, clip.offset - fromTime),
              Math.max(0, fromTime - clip.offset));
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
  // Stagger arrivals so a second character does not land inside the first.
  const step = (canvas.width / stage.camera.zoom) * 0.16;
  const x = (stage.backdrop ? stage.camera.x : canvas.width / 2)
    + (stage.actors.length - 1) * step * 0.5 * (stage.actors.length % 2 ? 1 : -1);
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
    mouthKit: null,
    mouthKitId: null,
    audio: null,
    audioOffset: 0,
    track: null,
    // Empty presence means "always on screen" until the script says otherwise.
    presence: [],
    tagAlong: false,
    visible: true,
  };
}

async function addActor(rig) {
  const actor = makeActor(rig);
  // A rig may name the kit it was drawn for; otherwise take the session default.
  actor.mouthKitId = rig.mouthKit ?? state.defaultKitId;
  actor.mouthKit = await kitById(actor.mouthKitId);
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
  refreshPresence();
}

function refreshCast() {
  for (const id of ["castList", "castList2"]) {
    const list = $(id);
    if (!list) continue;
    list.innerHTML = "";
    for (const actor of stage.actors) {
      const spoken = linesFor(state.lines, actor.id).length;
      const li = document.createElement("li");
      li.className = actor === state.selected ? "selected" : "";
      li.innerHTML = '<span class="name"></span><span class="tag"></span>';
      li.querySelector(".name").textContent = actor.name;
      li.querySelector(".tag").textContent = spoken ? `${spoken} line${spoken === 1 ? "" : "s"}` : "silent";
      li.addEventListener("click", () => select(actor));
      list.appendChild(li);
    }
  }
  refreshSegmentPickers();
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
  const siblings = state.library.filter((c) => c.role === actor.rig.role);
  const outfits = [];
  for (const c of siblings) {
    if (!outfits.some(([v]) => v === c.outfit)) outfits.push([c.outfit, c.outfitName || c.outfit]);
  }
  fillOptions($("actorOutfit"), outfits.length ? outfits : [["", "custom art"]], actor.rig.outfit || "");
  $("walkOn").checked = Boolean(actor.walk?.enabled);
  $("stepHz").value = String(actor.walk?.stepHz ?? 2.2);
  $("stepHzOut").textContent = (actor.walk?.stepHz ?? 2.2).toFixed(2);
  $("bobUnits").value = String(actor.walk?.bobUnits ?? 0.055);
  $("bobUnitsOut").textContent = (actor.walk?.bobUnits ?? 0.055).toFixed(3);
  $("keyInfo").textContent = `${actor.keys.length} position key${actor.keys.length === 1 ? "" : "s"}`;

  const angles = availableAngles(actor.rig);
  fillSelect($("restAngle"), angles, actor.restAngle);
  fillSelect($("tuneAngle"), angles, $("tuneAngle").value && angles.includes($("tuneAngle").value) ? $("tuneAngle").value : angles[0]);
  refreshMouthFit();

  const cover = rigCoverage(actor.rig, actor.mouthKit);
  const label = { draft: "Draft", quick: "Quick", standard: "Standard", full: "Full" }[cover.tier];
  $("coverage").textContent = cover.next.length
    ? `${label} rig — ${cover.angles} angle(s), ${cover.fewestMouths} mouth shapes. Next: ${cover.next[0]}`
    : `${label} rig — ${cover.angles} angles, ${cover.fewestMouths} mouth shapes. Nothing missing.`;

}

/** Fill a <select> from [value, label] pairs. */
function fillOptions(select, pairs, chosen) {
  const previous = chosen ?? select.value;
  select.innerHTML = "";
  for (const [value, label] of pairs) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
  if (pairs.some(([v]) => v === previous)) select.value = previous;
}

/** Fill a <select> from items carrying an optional `group`, using optgroups. */
function fillGroupedOptions(select, items, chosen) {
  select.innerHTML = "";
  const groups = new Map();
  for (const item of items) {
    const key = item.group || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const [label, members] of groups) {
    const host = label ? document.createElement("optgroup") : select;
    if (label) {
      host.label = label;
      select.appendChild(host);
    }
    for (const item of members) {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.name;
      host.appendChild(opt);
    }
  }
  if (chosen) select.value = chosen;
}

/** Narrow the outfit and tone lists to what the chosen role offers. */
function refreshPickers() {
  const role = $("pickRole").value;
  const forRole = state.library.filter((c) => c.role === role);
  const outfits = [];
  for (const c of forRole) {
    if (!outfits.some(([v]) => v === c.outfit)) outfits.push([c.outfit, c.outfitName || c.outfit]);
  }
  fillOptions($("pickOutfit"), outfits);
  const outfit = $("pickOutfit").value;
  const tones = forRole.filter((c) => c.outfit === outfit).map((c) => [c.tone, c.tone]);
  fillOptions($("pickTone"), tones);
}

function findEntry(role, outfit, tone) {
  return state.library.find((c) => c.role === role && c.outfit === outfit && c.tone === tone);
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
  const needed = Math.max(sceneDuration(stage, state.cameraKeys), fxDuration(state.fx),
                          planDuration(state.lines, state.cameraSegments),
                          Number($("duration").value) || 1);
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
    // Three axes beat one list of ninety: pick who, then what they wear, then
    // skin tone. Outfits and tones are filtered to what the role actually has.
    const roles = [];
    for (const c of state.library) {
      if (!roles.some((r) => r.role === c.role)) roles.push({ role: c.role, name: c.roleName || c.name });
    }
    fillOptions($("pickRole"), roles.map((r) => [r.role, r.name]));
    refreshPickers();
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

// --------------------------------------------------------------------- script

$("sceneTitle").addEventListener("input", (e) => {
  state.sceneTitle = e.target.value;
});

function presenceText(actor) {
  if (!actor) return "";
  if (!actor.presence?.length) return "Always on screen.";
  return actor.presence
    .map((r) => `${r.start.toFixed(1)}–${r.end.toFixed(1)}s`)
    .join(", ");
}

$("presenceEnter").addEventListener("click", () => {
  const actor = state.selected;
  if (!actor) return;
  actor.presence = actor.presence || [];
  // An open range runs to the end of the scene until an exit closes it.
  actor.presence.push({ start: state.time, end: state.duration });
  refreshPresence();
  render();
});

$("presenceExit").addEventListener("click", () => {
  const actor = state.selected;
  if (!actor?.presence?.length) return;
  const open = [...actor.presence].reverse().find((r) => r.start <= state.time);
  if (open) open.end = Math.max(open.start + 0.1, state.time);
  refreshPresence();
  render();
});

$("presenceAlways").addEventListener("click", () => {
  if (!state.selected) return;
  state.selected.presence = [];
  refreshPresence();
  render();
});

function refreshPresence() {
  $("presenceInfo").textContent = presenceText(state.selected);
}

// --- dialogue lines ----------------------------------------------------------

function newLine(actorId) {
  return {
    id: `line_${Math.random().toString(36).slice(2, 9)}`,
    actorId,
    text: "",
    start: state.time,
    duration: 2,
    voice: "none",
    pitch: 0,
    formant: 1,
    audio: null,
    rawBuffer: null,
    track: null,
  };
}

$("addLine").addEventListener("click", () => {
  const actor = state.selected || stage.actors[0];
  if (!actor) {
    status("Add a character first.", true);
    return;
  }
  const line = newLine(actor.id);
  state.lines.push(line);
  selectLine(line);
  refreshLineList();
  refreshDuration();
  render();
});

function selectLine(line) {
  state.selectedLine = line;
  refreshLineList();
  refreshLineInspector();
}

function refreshLineList() {
  const list = $("lineList");
  list.innerHTML = "";
  for (const line of [...state.lines].sort((a, b) => a.start - b.start)) {
    const actor = stage.actors.find((a) => a.id === line.actorId);
    const li = document.createElement("li");
    li.className = line === state.selectedLine ? "selected" : "";
    li.innerHTML = '<span class="name"></span><span class="when"></span>';
    li.querySelector(".name").textContent =
      `${actor ? actor.name.split(" —")[0] : "?"}: ${line.text || "(no text)"}`;
    li.querySelector(".when").textContent = line.audio ? `${line.start.toFixed(1)}s` : `${line.start.toFixed(1)}s ·`;
    li.addEventListener("click", () => {
      selectLine(line);
      renderAt(line.start);
    });
    list.appendChild(li);
  }
  $("lineInfo").textContent = state.lines.length
    ? `${state.lines.length} line${state.lines.length === 1 ? "" : "s"}.`
    : "No dialogue yet.";
}

function refreshLineInspector() {
  const line = state.selectedLine;
  $("lineInspector").hidden = !line;
  $("noLineSelection").hidden = Boolean(line);
  if (!line) return;
  fillOptions($("lineActor"), stage.actors.map((a) => [a.id, a.name]), line.actorId);
  $("lineText").value = line.text;
  $("lineStart").value = line.start.toFixed(2);
  $("lineLength").value = line.duration.toFixed(2);
  $("linePitch").value = String(line.pitch || 0);
  $("linePitchOut").textContent = String(line.pitch || 0);
  $("lineFormant").value = String(line.formant || 1);
  $("lineFormantOut").textContent = (line.formant || 1).toFixed(2);
  fillGroupedOptions($("lineVoice"), VOICE_PRESETS, line.voice);
  $("audioInfo").textContent = line.audio
    ? `${line.audio.name} — ${line.audio.buffer.duration.toFixed(2)}s, ${line.track?.frames.length ?? 0} viseme frames`
    : "No audio on this line. It will still hold the character's place in the script.";
}

function bindLine(id, apply) {
  $(id).addEventListener("input", (e) => {
    if (!state.selectedLine) return;
    apply(state.selectedLine, e.target);
    refreshLineList();
    refreshDuration();
    render();
  });
}
bindLine("lineText", (l, el) => { l.text = el.value; });
bindLine("lineStart", (l, el) => { l.start = Math.max(0, Number(el.value) || 0); });
bindLine("lineLength", (l, el) => { l.duration = Math.max(0.1, Number(el.value) || 0.1); });
bindLine("lineActor", (l, el) => { l.actorId = el.value; });

$("deleteLine").addEventListener("click", () => {
  if (!state.selectedLine) return;
  state.lines = state.lines.filter((l) => l !== state.selectedLine);
  selectLine(null);
  refreshLineList();
  render();
});

// --- camera plan -------------------------------------------------------------

function refreshSegmentPickers() {
  fillOptions($("segMode"), CAMERA_MODES.map((m) => [m.id, m.name]), $("segMode").value || "follow");
  fillOptions($("segTarget"), stage.actors.map((a) => [a.id, a.name]), $("segTarget").value);
}

$("addSegment").addEventListener("click", () => {
  const mode = $("segMode").value;
  const segment = {
    id: `cam_${Math.random().toString(36).slice(2, 9)}`,
    start: state.time,
    mode,
    target: mode === "follow" ? $("segTarget").value : null,
    zoom: stage.camera.zoom,
    camera: mode === "fixed" ? { ...stage.camera } : null,
    blend: 0.6,
  };
  state.cameraSegments.push(segment);
  captureTagOffsets(stage, state.cameraSegments, lastPoses, state.time);
  refreshSegmentInfo();
  render();
  status(`Camera ${mode === "follow" ? `follows ${$("segTarget").selectedOptions[0]?.textContent}` : mode} from ${state.time.toFixed(1)}s.`);
});

$("clearSegments").addEventListener("click", () => {
  state.cameraSegments = [];
  refreshSegmentInfo();
  render();
});

function refreshSegmentInfo() {
  $("segInfo").textContent = state.cameraSegments.length
    ? `${state.cameraSegments.length} camera change${state.cameraSegments.length === 1 ? "" : "s"} — drag them on the timeline.`
    : "No camera plan — manual keyframes are in charge.";
}

// ------------------------------------------------------------------- effects

// Grouping mirrors how a shot actually gets built: move the camera, set the
// light, cut, dress the screen, then letter it.
const FX_GROUPS = [
  ["Camera", ["shake", "handheld", "punch_zoom"]],
  ["Light", ["lighting", "vignette"]],
  ["Transitions", ["fade", "flash", "wipe", "iris"]],
  ["Screen", ["speed_lines", "grain", "weather"]],
  ["Overlays", ["callout", "bubble", "caption", "title"]],
  ["Sound", ["sfx"]],
];

function buildFxButtons() {
  const host = $("fxButtons");
  host.innerHTML = "";
  for (const [label, ids] of FX_GROUPS) {
    const group = document.createElement("div");
    group.className = "fxgroup";
    const heading = document.createElement("h4");
    heading.textContent = label;
    group.appendChild(heading);
    const row = document.createElement("div");
    row.className = "row";
    for (const id of ids) {
      const type = fxType(id);
      if (!type) continue;
      const button = document.createElement("button");
      button.textContent = type.name;
      button.addEventListener("click", () => addFx(id));
      row.appendChild(button);
    }
    group.appendChild(row);
    host.appendChild(group);
  }
}

async function addFx(typeId) {
  const clip = makeClip(typeId, state.time);
  if (!clip) return;
  if (fxType(typeId).kind === "audio") await ensureSfxBuffer(clip);
  state.fx.push(clip);
  selectFx(clip);
  refreshFxList();
  refreshDuration();
  render();
  status(`Added ${fxType(typeId).name} at ${clip.start.toFixed(2)}s.`);
}

function selectFx(clip) {
  state.selectedFx = clip;
  refreshFxList();
  refreshFxInspector();
}

function refreshFxList() {
  const list = $("fxList");
  list.innerHTML = "";
  const ordered = [...state.fx].sort((a, b) => a.start - b.start);
  for (const clip of ordered) {
    const type = fxType(clip.type);
    const li = document.createElement("li");
    li.className = clip === state.selectedFx ? "selected" : "";
    li.innerHTML = '<span class="name"></span><span class="when"></span>';
    const label = clip.params.text ? `${type.name}: ${clip.params.text}` : type.name;
    li.querySelector(".name").textContent = label;
    li.querySelector(".when").textContent =
      `${clip.start.toFixed(1)}–${(clip.start + clip.duration).toFixed(1)}s`;
    li.addEventListener("click", () => {
      selectFx(clip);
      renderAt(clip.start);
    });
    list.appendChild(li);
  }
  $("fxInfo").textContent = state.fx.length
    ? `${state.fx.length} effect${state.fx.length === 1 ? "" : "s"} on the track.`
    : "No effects yet.";
}

/** Build the parameter form for the selected clip from its type's field list. */
function refreshFxInspector() {
  const clip = state.selectedFx;
  $("fxInspector").hidden = !clip;
  $("noFxSelection").hidden = Boolean(clip);
  if (!clip) return;
  const type = fxType(clip.type);
  $("fxTitle").textContent = type.name;
  $("fxStart").value = clip.start.toFixed(2);
  $("fxDuration").value = clip.duration.toFixed(2);

  const host = $("fxParams");
  host.innerHTML = "";
  for (const field of type.fields) {
    const label = document.createElement("label");
    label.className = "field";
    label.append(field.label);
    let input;
    if (field.type === "select" || field.type === "sound") {
      input = document.createElement("select");
      const options = field.type === "sound"
        ? state.sfxBank.map((sound) => [sound.id, sound.name])
        : field.options.map((o) => [o, o.replace(/_/g, " ")]);
      for (const [value, text] of options) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = text;
        input.appendChild(opt);
      }
      input.value = clip.params[field.key] ?? options[0]?.[0] ?? "";
    } else {
      input = document.createElement("input");
      input.type = field.type;
      if (field.type === "range") {
        input.min = field.min;
        input.max = field.max;
        input.step = field.step;
      }
      input.value = clip.params[field.key] ?? field.value ?? "";
    }
    const readout = document.createElement("output");
    if (field.type === "range") readout.textContent = Number(input.value).toFixed(2);

    input.addEventListener("input", async () => {
      clip.params[field.key] = field.type === "range" ? Number(input.value) : input.value;
      if (field.type === "range") readout.textContent = Number(input.value).toFixed(2);
      if (field.key === "sound") await ensureSfxBuffer(clip);
      if (field.key === "text") refreshFxList();
      render();
    });
    label.appendChild(input);
    if (field.type === "range") label.appendChild(readout);
    host.appendChild(label);
  }
}

function bindFxTime(id, apply) {
  $(id).addEventListener("input", (e) => {
    if (!state.selectedFx) return;
    apply(state.selectedFx, Number(e.target.value) || 0);
    refreshFxList();
    refreshDuration();
    render();
  });
}
bindFxTime("fxStart", (clip, v) => { clip.start = Math.max(0, v); });
bindFxTime("fxDuration", (clip, v) => { clip.duration = Math.max(0.05, v); });

$("fxDelete").addEventListener("click", () => {
  if (!state.selectedFx) return;
  state.fx = state.fx.filter((c) => c !== state.selectedFx);
  selectFx(null);
  refreshFxList();
  render();
});

$("fxDuplicate").addEventListener("click", () => {
  const clip = state.selectedFx;
  if (!clip) return;
  const copy = { ...clip, id: `fx_${Math.random().toString(36).slice(2, 9)}`,
                 start: clip.start + clip.duration, params: { ...clip.params } };
  state.fx.push(copy);
  selectFx(copy);
  refreshFxList();
  refreshDuration();
  render();
});

// --- sound effects ------------------------------------------------------------

async function loadSfxBank() {
  try {
    const res = await fetch("assets/sfx/index.json");
    state.sfxBank = res.ok ? await res.json() : [];
  } catch {
    state.sfxBank = [];
  }
}

/** Decode (and cache) the audio for a sound-effect clip. */
async function ensureSfxBuffer(clip) {
  const sound = state.sfxBank.find((s) => s.id === clip.params.sound) || state.sfxBank[0];
  if (!sound) return;
  clip.params.sound = sound.id;
  if (!sound.buffer) {
    const data = sound.file
      ? await sound.file.arrayBuffer()
      : await (await fetch(`assets/sfx/${sound.src}`)).arrayBuffer();
    sound.buffer = await audioContext().decodeAudioData(data);
  }
  clip.buffer = sound.buffer;
  clip.duration = Math.max(0.05, sound.buffer.duration);
}

$("sfxFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const id = `user_${state.sfxBank.length}`;
  state.sfxBank.push({ id, name: file.name, file });
  status(`Added sound ${file.name}. Pick it on a Sound effect clip.`);
  refreshFxInspector();
  e.target.value = "";
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

$("pickRole").addEventListener("change", refreshPickers);
$("pickOutfit").addEventListener("change", refreshPickers);

$("addFromLibrary").addEventListener("click", async () => {
  const entry = findEntry($("pickRole").value, $("pickOutfit").value, $("pickTone").value);
  if (!entry) return;
  status("Loading character…");
  try {
    const rig = await loadRigFromUrl(`assets/characters/${entry.rig}`);
    await addActor(rig);
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
    await addActor(rig);
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

$("loadSampleBackdrop2").addEventListener("click", () => $("loadSampleBackdrop").click());
$("backdropFile2").addEventListener("change", (e) => {
  // The Script tab offers the same backdrop pickers as the Shot tab.
  const input = $("backdropFile");
  input.files = e.target.files;
  input.dispatchEvent(new Event("change"));
});

$("backdropFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  stage.backdrop = await loadBackdropFromFile(file);
  onBackdropLoaded();
  status(`Backdrop: ${file.name}.`);
  e.target.value = "";
});

$("layerParallax").addEventListener("input", (e) => {
  $("layerParallaxOut").textContent = Number(e.target.value).toFixed(2);
});

$("layerFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file || !stage.backdrop) {
    if (file) status("Load a backdrop first.", true);
    e.target.value = "";
    return;
  }
  try {
    await addBackdropLayer(stage, file, Number($("layerParallax").value));
    render();
    status(`Added layer ${file.name} at depth ${$("layerParallax").value}.`);
  } catch (err) {
    status(err.message, true);
  }
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

// --- dialogue audio ---------------------------------------------------------

/**
 * Decode a file for a line, run the voice filter, analyse the result for lip
 * sync, and size the line to the clip. The unfiltered buffer is kept so the
 * filter can be changed without re-uploading.
 */
async function loadLineAudio(line, file) {
  const buffer = await audioContext().decodeAudioData(await file.arrayBuffer());
  line.rawBuffer = buffer;
  line.audioName = file.name;
  await applyLineVoice(line);
}

async function applyLineVoice(line) {
  if (!line.rawBuffer) return;
  const buffer = await applyVoice(line.rawBuffer, line.voice,
                                  { pitch: line.pitch || 0, formant: line.formant || 1 });
  line.audio = { buffer, name: line.audioName || "audio" };
  line.duration = Math.max(0.1, buffer.duration);
  analyseLine(line);
}

function analyseLine(line) {
  if (!line.audio) return;
  const sensitivity = Number($("sensitivity").value) || 1;
  let track = analyzeAudio(line.audio.buffer, { fps: 24, sensitivity });
  // The written line doubles as the transcript - no second field to fill in.
  if (line.text.trim()) track = applyTranscript(track, line.text.trim());
  line.track = track;
  refreshLineList();
  refreshLineInspector();
  refreshDuration();
  render();
}

$("lineAudio").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  const line = state.selectedLine;
  if (!file || !line) return;
  status("Decoding audio…");
  try {
    await loadLineAudio(line, file);
    status(`${file.name} loaded — ${line.duration.toFixed(2)}s.`);
  } catch (err) {
    status(err.message, true);
  }
  e.target.value = "";
});

$("lineVoice").addEventListener("change", async (e) => {
  const line = state.selectedLine;
  if (!line) return;
  line.voice = e.target.value;
  status("Applying voice filter…");
  try {
    await applyLineVoice(line);
    status(`Voice: ${e.target.selectedOptions[0].textContent}.`);
  } catch (err) {
    status(err.message, true);
  }
});

$("linePitch").addEventListener("change", async (e) => {
  const line = state.selectedLine;
  if (!line) return;
  line.pitch = Number(e.target.value) || 0;
  $("linePitchOut").textContent = String(line.pitch);
  try {
    await applyLineVoice(line);
  } catch (err) {
    status(err.message, true);
  }
});
$("linePitch").addEventListener("input", (e) => {
  $("linePitchOut").textContent = String(e.target.value);
});

$("lineFormant").addEventListener("change", async (e) => {
  const line = state.selectedLine;
  if (!line) return;
  line.formant = Number(e.target.value) || 1;
  try {
    await applyLineVoice(line);
  } catch (err) {
    status(err.message, true);
  }
});
$("lineFormant").addEventListener("input", (e) => {
  $("lineFormantOut").textContent = Number(e.target.value).toFixed(2);
});

$("reanalyze").addEventListener("click", () => analyseLine(state.selectedLine));
$("sensitivity").addEventListener("input", (e) => {
  $("sensitivityOut").textContent = Number(e.target.value).toFixed(2);
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

$("actorOutfit").addEventListener("change", async (e) => {
  const actor = state.selected;
  if (!actor?.rig.role) return;
  const entry = findEntry(actor.rig.role, e.target.value, actor.rig.tone);
  if (!entry) return;
  status("Changing outfit…");
  try {
    // Swap only the drawings; blocking, keys, audio and mouth kit stay put.
    actor.rig = await loadRigFromUrl(`assets/characters/${entry.rig}`);
    actor.name = actor.name.includes("—") ? entry.name : actor.name;
    refreshCast();
    refreshInspector();
    render();
    status(`${actor.name}: ${entry.outfitName}.`);
  } catch (err) {
    status(err.message, true);
  }
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

fillOptions($("moveTemplate"), MOVE_TEMPLATES.map((t) => [t.id, t.name]), "cross_right");
fillOptions($("moveCamera"), CAMERA_TEMPLATES.map((t) => [t.id, t.name]), "none");

$("applyTemplate").addEventListener("click", () => {
  const actor = state.selected;
  if (!actor) {
    status("Select a character first.", true);
    return;
  }
  const seconds = Math.max(0.5, Number($("moveSeconds").value) || 5);
  const cameraKeys = applyTemplate(stage, actor, $("moveTemplate").value,
                                   $("moveCamera").value, state.time, seconds);
  if (cameraKeys) {
    state.cameraKeys = cameraKeys;
    $("camInfo").textContent = `${cameraKeys.length} camera keys (from template)`;
  }
  $("walkOn").checked = Boolean(actor.walk?.enabled);
  $("keyInfo").textContent = `${actor.keys.length} position keys`;
  refreshDuration();
  render();
  status(`${actor.name}: ${$("moveTemplate").selectedOptions[0].textContent.toLowerCase()}.`);
});

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
      audioSources: [
        ...state.lines.filter((l) => l.audio)
          .map((l) => ({ buffer: l.audio.buffer, offset: l.start })),
        ...fxAudioSources(state.fx),
      ],
      renderAt: (t) => renderAt(t, { videoPlaying: true }),
      onProgress: (p) => {
        $("exportProgress").value = p;
      },
    });
    downloadBlob(blob, "backlot-shot.webm");
    status("Saved backlot-shot.webm");
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
      // Frame-exact export has to wait for each video seek to land.
      renderAt: async (t) => {
        await seekBackdropVideo(stage, t);
        renderAt(t, { videoPlaying: false });
      },
      onProgress: (p) => {
        $("exportProgress").value = p;
      },
    });
    downloadBlob(blob, "backlot-frames.zip");
    status("Saved backlot-frames.zip");
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
    // Sound buffers cannot be serialised; the bundled sound id is enough to
    // rebuild them, and an uploaded one is reported as needing re-adding.
    fx: state.fx.map(({ buffer, ...clip }) => clip),
    sceneTitle: state.sceneTitle || "",
    // Audio buffers are not serialisable; the text, timing and voice choice are.
    lines: state.lines.map(({ audio, rawBuffer, track, ...line }) => line),
    cameraSegments: state.cameraSegments,
    backdrop: stage.backdrop
      ? { name: stage.backdrop.name, horizon: stage.backdrop.horizon }
      : null,
    actors: stage.actors.map((a) => ({
      name: a.name,
      rigId: a.rig.id,
      imported: Boolean(a.rig.imported),
      id: a.id,
      keys: a.keys,
      presence: a.presence || [],
      tagAlong: Boolean(a.tagAlong),
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
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "backlot-project.json");
  status(imported.length
    ? `Saved. Imported art is not embedded — re-import folders for: ${imported.join(", ")}`
    : "Saved backlot-project.json");
});

$("loadProject").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    state.cameraKeys = data.cameraKeys || [];
    state.fx = (data.fx || []).map((clip) => ({ ...clip, params: { ...clip.params } }));
    for (const clip of state.fx) {
      if (fxType(clip.type)?.kind === "audio") await ensureSfxBuffer(clip);
    }
    selectFx(null);
    refreshFxList();
    state.sceneTitle = data.sceneTitle || "";
    $("sceneTitle").value = state.sceneTitle;
    state.lines = (data.lines || []).map((line) => ({ ...line, audio: null, rawBuffer: null, track: null }));
    state.cameraSegments = data.cameraSegments || [];
    selectLine(null);
    refreshLineList();
    refreshSegmentInfo();
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
      actor.presence = spec.presence || [];
      actor.tagAlong = Boolean(spec.tagAlong);
      if (spec.id) actor.id = spec.id;
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
  await loadSfxBank();
  setupTimeline();
  buildFxButtons();
  refreshLineList();
  refreshLineInspector();
  refreshSegmentPickers();
  refreshSegmentInfo();
  refreshPresence();
  refreshFxList();
  refreshFxInspector();
  try {
    stage.backdrop = await loadBackdropFromUrl("assets/backgrounds/boulevard/backdrop.json");
    onBackdropLoaded();
  } catch {
    render();
  }
  refreshDuration();
  refreshInspector();
  showTab("script");
  status("Add a character, write the lines, then block the movement.");
}

boot();
