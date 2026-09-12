// The timeline strip: one lane per character, plus camera and effects.
//
// Everything in the studio is already time-based data, so this widget does not
// own anything - it draws whatever lanes it is handed and reports drags back.
// Clips can be moved by their middle and resized by their edges.

const HEADER = 124;
const RULER = 22;
const LANE_H = 28;
const EDGE = 7;
const SNAP = 0.05;

export function createTimeline(canvas, handlers = {}) {
  const timeline = {
    canvas,
    ctx: canvas.getContext("2d"),
    model: { duration: 10, time: 0, lanes: [] },
    selected: null,
    drag: null,
    handlers,
  };

  const width = () => canvas.width / (window.devicePixelRatio || 1);
  const trackWidth = () => Math.max(40, width() - HEADER - 10);
  const timeToX = (t) => HEADER + (t / Math.max(0.001, timeline.model.duration)) * trackWidth();
  const xToTime = (x) => ((x - HEADER) / trackWidth()) * timeline.model.duration;
  const snap = (t) => Math.max(0, Math.round(t / SNAP) * SNAP);

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 900;
    const rows = Math.max(1, timeline.model.lanes.length);
    const cssHeight = RULER + rows * LANE_H + 8;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.height = `${cssHeight}px`;
    timeline.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function laneAt(y) {
    const index = Math.floor((y - RULER) / LANE_H);
    return timeline.model.lanes[index] || null;
  }

  function clipAt(lane, x) {
    for (const clip of lane.clips) {
      const left = timeToX(clip.start);
      const right = timeToX(clip.start + clip.duration);
      if (x >= left - 2 && x <= right + 2) return clip;
    }
    return null;
  }

  function pointer(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // --- drawing ---------------------------------------------------------------

  function draw() {
    const { ctx, model } = timeline;
    const w = width();
    const h = RULER + model.lanes.length * LANE_H + 8;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#14161d";
    ctx.fillRect(0, 0, w, h);

    // ruler
    ctx.fillStyle = "#1b1f29";
    ctx.fillRect(0, 0, w, RULER);
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const stepChoices = [0.5, 1, 2, 5, 10, 30, 60];
    const step = stepChoices.find((s) => (s / model.duration) * trackWidth() > 46) || 60;
    for (let t = 0; t <= model.duration + 1e-6; t += step) {
      const x = timeToX(t);
      ctx.strokeStyle = "#2b3040";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillStyle = "#97a1b5";
      ctx.textAlign = "left";
      ctx.fillText(`${t.toFixed(step < 1 ? 1 : 0)}s`, x + 3, RULER / 2);
    }

    // lanes
    model.lanes.forEach((lane, i) => {
      const top = RULER + i * LANE_H;
      ctx.fillStyle = i % 2 ? "#171a22" : "#151821";
      ctx.fillRect(0, top, w, LANE_H);
      ctx.fillStyle = "#1b1f29";
      ctx.fillRect(0, top, HEADER, LANE_H);
      ctx.fillStyle = lane.muted ? "#5c6578" : "#cdd5e4";
      ctx.textAlign = "left";
      ctx.font = "11px system-ui, sans-serif";
      const label = lane.label.length > 18 ? `${lane.label.slice(0, 17)}…` : lane.label;
      ctx.fillText(label, 8, top + LANE_H / 2);

      for (const clip of lane.clips) {
        const left = timeToX(clip.start);
        const right = timeToX(clip.start + clip.duration);
        const cw = Math.max(4, right - left);
        const selected = timeline.selected
          && timeline.selected.laneId === lane.id && timeline.selected.clipId === clip.id;
        ctx.fillStyle = clip.color || "#3f6ea8";
        ctx.globalAlpha = clip.ghost ? 0.38 : 1;
        ctx.beginPath();
        ctx.roundRect(left, top + 4, cw, LANE_H - 8, 5);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (selected) {
          ctx.strokeStyle = "#5ad1ff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (clip.label && cw > 26) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(left + 4, top, cw - 8, LANE_H);
          ctx.clip();
          ctx.fillStyle = "#0d1016";
          ctx.font = "600 10px system-ui, sans-serif";
          ctx.fillText(clip.label, left + 6, top + LANE_H / 2);
          ctx.restore();
        }
      }
    });

    // playhead
    const px = timeToX(model.time);
    ctx.strokeStyle = "#ff6b6b";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.fillStyle = "#ff6b6b";
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.closePath();
    ctx.fill();
  }

  // --- interaction -----------------------------------------------------------

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    const { x, y } = pointer(event);

    if (y < RULER || x < HEADER) {
      if (x >= HEADER) {
        timeline.drag = { kind: "scrub" };
        handlers.onScrub?.(snap(xToTime(x)));
      }
      return;
    }

    const lane = laneAt(y);
    if (!lane) return;
    const clip = clipAt(lane, x);
    if (!clip) {
      timeline.drag = { kind: "scrub" };
      handlers.onScrub?.(snap(xToTime(x)));
      return;
    }

    timeline.selected = { laneId: lane.id, clipId: clip.id };
    handlers.onSelect?.(lane, clip);

    const left = timeToX(clip.start);
    const right = timeToX(clip.start + clip.duration);
    const mode = clip.fixedLength ? "move"
      : x - left < EDGE ? "start"
      : right - x < EDGE ? "end"
      : "move";
    timeline.drag = { kind: "clip", lane, clip, mode, grabTime: xToTime(x), start: clip.start, duration: clip.duration };
    draw();
  });

  canvas.addEventListener("pointermove", (event) => {
    const { x, y } = pointer(event);
    const drag = timeline.drag;

    if (!drag) {
      // Hover cursor hints at what a drag would do.
      const lane = y > RULER ? laneAt(y) : null;
      const clip = lane && x > HEADER ? clipAt(lane, x) : null;
      let cursor = "default";
      if (y < RULER || (!clip && x > HEADER)) cursor = "col-resize";
      else if (clip) {
        const left = timeToX(clip.start);
        const right = timeToX(clip.start + clip.duration);
        cursor = clip.fixedLength ? "grab"
          : (x - left < EDGE || right - x < EDGE) ? "ew-resize" : "grab";
      }
      canvas.style.cursor = cursor;
      return;
    }

    if (drag.kind === "scrub") {
      handlers.onScrub?.(snap(xToTime(x)));
      return;
    }

    const delta = xToTime(x) - drag.grabTime;
    let next;
    if (drag.mode === "move") {
      next = { start: snap(Math.max(0, drag.start + delta)), duration: drag.duration };
    } else if (drag.mode === "start") {
      const start = snap(Math.max(0, Math.min(drag.start + drag.duration - SNAP * 2, drag.start + delta)));
      next = { start, duration: snap(drag.start + drag.duration - start) };
    } else {
      next = { start: drag.start, duration: Math.max(SNAP * 2, snap(drag.duration + delta)) };
    }
    Object.assign(drag.clip, next);
    handlers.onClipChange?.(drag.lane, drag.clip, next);
    draw();
  });

  function endDrag() {
    if (timeline.drag?.kind === "clip") handlers.onClipCommit?.(timeline.drag.lane, timeline.drag.clip);
    timeline.drag = null;
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  timeline.setModel = (model) => {
    const laneCountChanged = model.lanes.length !== timeline.model.lanes.length;
    timeline.model = model;
    if (laneCountChanged) resize();
    draw();
  };
  timeline.select = (laneId, clipId) => {
    timeline.selected = laneId ? { laneId, clipId } : null;
    draw();
  };
  timeline.draw = draw;
  timeline.resize = () => {
    resize();
    draw();
  };

  window.addEventListener("resize", timeline.resize);
  resize();
  draw();
  return timeline;
}
