// Audio -> viseme track.
//
// There is no phoneme recogniser here. Instead each analysis frame is reduced to
// three perceptual numbers - how loud it is, where the energy sits between the
// first and second formant regions, and how much fricative hiss it carries - and
// those land the frame on a small mouth-shape grid. That is enough to read as
// speech at 12-24fps, which is all a limited-animation webisode needs.

export const VISEMES = ["rest", "MBP", "FV", "TH", "L", "WQ", "E", "AI", "O", "U"];

// --- small radix-2 FFT -------------------------------------------------------

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function mixToMono(buffer) {
  const n = buffer.length;
  const out = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  const inv = 1 / buffer.numberOfChannels;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

// --- feature extraction ------------------------------------------------------

const FFT_SIZE = 1024;

function extractFeatures(samples, sampleRate, fps) {
  const hop = Math.max(1, Math.round(sampleRate / fps));
  const frameCount = Math.max(1, Math.floor(samples.length / hop));
  const window = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  }
  const binHz = sampleRate / FFT_SIZE;
  const band = (lo, hi) => [Math.floor(lo / binHz), Math.min(FFT_SIZE / 2, Math.ceil(hi / binHz))];
  const [loA, loB] = band(200, 900);    // F1 region - jaw opening
  const [midA, midB] = band(900, 2600); // F2 region - front vs back vowels
  const [hiA, hiB] = band(2600, 6500);  // fricative hiss

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const frames = [];

  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    let rms = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = start + i < samples.length ? samples[start + i] : 0;
      rms += s * s;
      re[i] = s * window[i];
      im[i] = 0;
    }
    rms = Math.sqrt(rms / FFT_SIZE);
    fft(re, im);

    let low = 0;
    let mid = 0;
    let high = 0;
    for (let b = loA; b < loB; b++) low += re[b] * re[b] + im[b] * im[b];
    for (let b = midA; b < midB; b++) mid += re[b] * re[b] + im[b] * im[b];
    for (let b = hiA; b < hiB; b++) high += re[b] * re[b] + im[b] * im[b];

    const total = low + mid + high + 1e-12;
    frames.push({
      t: start / sampleRate,
      rms,
      frontness: mid / (low + mid + 1e-12),
      fricative: high / total,
    });
  }
  return frames;
}

// --- classification ----------------------------------------------------------

function classify(openness, frontness, fricative, opts) {
  if (openness < opts.silence) return "rest";
  if (openness < opts.silence * 1.9) return "MBP";
  if (fricative > 0.42 && openness < 0.42) return frontness > 0.62 ? "FV" : "TH";
  const front = frontness > 0.5;
  if (openness > 0.66) return front ? "E" : "AI";
  if (openness > 0.4) return front ? "E" : "O";
  if (openness > 0.22) return front ? "L" : "U";
  return front ? "L" : "WQ";
}

/** Median-filter the viseme sequence and enforce a minimum hold, so mouths do
 *  not strobe on single noisy frames. */
function stabilise(track, minHold) {
  const out = track.map((f) => ({ ...f }));
  for (let i = 1; i < out.length - 1; i++) {
    if (out[i].viseme !== out[i - 1].viseme && out[i - 1].viseme === out[i + 1].viseme) {
      out[i].viseme = out[i - 1].viseme;
    }
  }
  let runStart = 0;
  for (let i = 1; i <= out.length; i++) {
    if (i === out.length || out[i].viseme !== out[runStart].viseme) {
      if (i - runStart < minHold && runStart > 0) {
        const fill = out[runStart - 1].viseme;
        for (let k = runStart; k < i; k++) out[k].viseme = fill;
      }
      runStart = i;
    }
  }
  return out;
}

/**
 * Build a viseme track from a decoded AudioBuffer.
 * @param {AudioBuffer} buffer
 * @param {{fps?:number, sensitivity?:number, minHold?:number}} [options]
 */
export function analyzeAudio(buffer, options = {}) {
  const fps = options.fps ?? 24;
  const sensitivity = options.sensitivity ?? 1;
  const minHold = options.minHold ?? 2;

  const samples = mixToMono(buffer);
  const raw = extractFeatures(samples, buffer.sampleRate, fps);

  const sortedRms = Array.from(raw, (f) => f.rms).sort((a, b) => a - b);
  const floor = percentile(sortedRms, 0.2);
  const loud = Math.max(percentile(sortedRms, 0.95), floor + 1e-5);

  const frames = raw.map((f) => {
    const openness = Math.min(1, Math.max(0, ((f.rms - floor) / (loud - floor)) * sensitivity));
    return {
      t: f.t,
      openness,
      frontness: f.frontness,
      fricative: f.fricative,
      viseme: classify(openness, f.frontness, f.fricative, { silence: 0.08 }),
    };
  });

  return { fps, duration: buffer.duration, frames: stabilise(frames, minHold) };
}

// --- transcript assist -------------------------------------------------------

// Crude grapheme -> viseme table. Digraphs are checked first.
const DIGRAPHS = { th: "TH", sh: "E", ch: "E", ph: "FV", wh: "WQ", oo: "U", ou: "O", ow: "O", ee: "E", ea: "E", ai: "AI", ay: "AI", oa: "O" };
const LETTERS = {
  a: "AI", b: "MBP", c: "E", d: "L", e: "E", f: "FV", g: "E", h: "AI", i: "E",
  j: "E", k: "E", l: "L", m: "MBP", n: "L", o: "O", p: "MBP", q: "WQ", r: "O",
  s: "E", t: "L", u: "U", v: "FV", w: "WQ", x: "E", y: "E", z: "E",
};

function wordToVisemes(word) {
  const out = [];
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  for (let i = 0; i < w.length; ) {
    const two = w.slice(i, i + 2);
    if (DIGRAPHS[two]) {
      out.push(DIGRAPHS[two]);
      i += 2;
    } else {
      const v = LETTERS[w[i]];
      // Collapse doubled letters and silent trailing "e".
      if (v && out[out.length - 1] !== v) out.push(v);
      i += 1;
    }
  }
  return out.length ? out : ["AI"];
}

/** Contiguous runs of non-silent frames. */
function speechSegments(track) {
  const segs = [];
  let start = -1;
  track.frames.forEach((f, i) => {
    const voiced = f.viseme !== "rest";
    if (voiced && start < 0) start = i;
    if (!voiced && start >= 0) {
      segs.push([start, i]);
      start = -1;
    }
  });
  if (start >= 0) segs.push([start, track.frames.length]);
  return segs.filter(([a, b]) => b - a >= 2);
}

/**
 * Re-label an energy-derived track using a transcript. Timing still comes from
 * the audio; only the choice of mouth shape comes from the words. Words are
 * distributed across detected speech runs proportionally to their length.
 */
export function applyTranscript(track, transcript) {
  const words = transcript.split(/\s+/).filter(Boolean);
  if (!words.length) return track;
  const segs = speechSegments(track);
  if (!segs.length) return track;

  const seqs = words.map(wordToVisemes);
  const weights = seqs.map((s) => s.length);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const totalFrames = segs.reduce((a, [s, e]) => a + (e - s), 0);

  const frames = track.frames.map((f) => ({ ...f }));
  // Flatten the segment frame indices, then walk words across them.
  const slots = [];
  segs.forEach(([s, e]) => {
    for (let i = s; i < e; i++) slots.push(i);
  });

  let cursor = 0;
  seqs.forEach((seq, wi) => {
    const span = Math.max(seq.length, Math.round((weights[wi] / totalWeight) * totalFrames));
    for (let k = 0; k < span && cursor < slots.length; k++, cursor++) {
      const v = seq[Math.min(seq.length - 1, Math.floor((k / span) * seq.length))];
      const idx = slots[cursor];
      // Keep the energy envelope's closed frames closed - it beats the speller.
      if (frames[idx].openness > 0.12) frames[idx].viseme = v;
    }
  });

  return { ...track, frames: stabilise(frames, 2) };
}

/** Viseme active at time t. */
export function visemeAt(track, t) {
  if (!track || !track.frames.length) return "rest";
  const i = Math.round(t * track.fps);
  if (i < 0 || i >= track.frames.length) return "rest";
  return track.frames[i].viseme;
}
