// Export paths: a real-time WebM capture (video + the original audio) and an
// offline PNG sequence for people taking the shot into a real NLE.

import { buildZip } from "./zip.js";

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";
}

/**
 * Capture the canvas in real time while playing every dialogue clip at its own
 * offset, muxing picture and sound into one WebM. Real time is a hard constraint
 * of MediaRecorder - a 30s shot takes 30s to export.
 *
 * @param {{canvas:HTMLCanvasElement,
 *          audioSources?:Array<{buffer:AudioBuffer, offset:number, gain?:number}>,
 *          duration:number, fps?:number, renderAt:(t:number)=>void,
 *          onProgress?:(p:number)=>void}} opts
 */
export async function recordWebM(opts) {
  const { canvas, duration, renderAt, onProgress } = opts;
  const audioSources = opts.audioSources || [];
  const fps = opts.fps || 30;
  if (!window.MediaRecorder) throw new Error("This browser cannot record video (no MediaRecorder).");

  const stream = canvas.captureStream(fps);
  let audioCtx = null;
  const sources = [];
  if (audioSources.length) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();
    for (const clip of audioSources) {
      const source = audioCtx.createBufferSource();
      source.buffer = clip.buffer;
      const gain = audioCtx.createGain();
      gain.gain.value = clip.gain ?? 1;
      source.connect(gain);
      gain.connect(dest);
      gain.connect(audioCtx.destination);
      sources.push({ source, offset: clip.offset || 0 });
    }
    dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  const done = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
  });

  recorder.start(100);
  if (audioCtx) {
    const base = audioCtx.currentTime + 0.06; // small lead-in so nothing clips
    sources.forEach(({ source, offset }) => source.start(base + Math.max(0, offset)));
  }
  const startedAt = performance.now();

  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - startedAt) / 1000;
      if (t >= duration) {
        renderAt(duration);
        resolve();
        return;
      }
      renderAt(t);
      onProgress?.(t / duration);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  recorder.stop();
  sources.forEach(({ source }) => {
    try {
      source.stop();
    } catch {
      /* already ended */
    }
  });
  const blob = await done;
  audioCtx?.close();
  return blob;
}

/**
 * Render frames offline (as fast as the machine allows) and pack them into a
 * ZIP of numbered PNGs. Slower to produce than WebM but frame-exact.
 *
 * @param {{canvas:HTMLCanvasElement, duration:number, fps?:number,
 *          renderAt:(t:number)=>void, onProgress?:(p:number)=>void}} opts
 */
export async function exportPngSequence(opts) {
  const { canvas, duration, renderAt, onProgress } = opts;
  const fps = opts.fps || 24;
  const total = Math.max(1, Math.round(duration * fps));
  const entries = [];

  for (let i = 0; i < total; i++) {
    await renderAt(i / fps);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    entries.push({
      name: `frame_${String(i).padStart(5, "0")}.png`,
      data: new Uint8Array(await blob.arrayBuffer()),
    });
    onProgress?.((i + 1) / total);
    // Yield so the progress bar can paint.
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  return buildZip(entries);
}
