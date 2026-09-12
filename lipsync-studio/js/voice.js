// Voice filters.
//
// Everything here runs in the browser with no model and no network: resampling
// plus biquads plus a little waveshaping. That is enough to turn one recorded
// voice into a cast of distinct ones, which is how cartoons did it for decades.
//
// What this is NOT is voice conversion - it cannot make your voice sound like a
// specific other person. It shifts pitch and timbre, which is what a stylised
// series actually needs, and it is cheap enough to run on a phone.

/** Linear resample. Changes pitch, formants and duration together. */
function resample(samples, ratio) {
  const out = new Float32Array(Math.max(1, Math.round(samples.length / ratio)));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = samples[i0] ?? 0;
    const b = samples[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/**
 * Granular time stretch: overlap-add windowed grains at a different spacing.
 * Changes duration without touching pitch, so pairing it with a resample gives
 * a pitch shift that keeps the original length.
 */
function timeStretch(samples, ratio, sampleRate) {
  if (Math.abs(ratio - 1) < 1e-4) return samples;
  const grain = Math.max(256, Math.round(sampleRate * 0.045));
  const half = Math.floor(grain / 2);
  const out = new Float32Array(Math.max(1, Math.round(samples.length * ratio)));
  const window = new Float32Array(grain);
  for (let i = 0; i < grain; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (grain - 1));

  let outPos = 0;
  let inPos = 0;
  while (outPos < out.length) {
    for (let i = 0; i < grain; i++) {
      const src = Math.round(inPos) + i;
      const dst = outPos + i;
      if (dst >= out.length || src >= samples.length) break;
      out[dst] += samples[src] * window[i];
    }
    outPos += half;
    inPos += half / ratio;
  }
  return out;
}

/** Shift pitch by `semitones`, keeping the clip the same length. */
function pitchShift(samples, semitones, sampleRate) {
  if (!semitones) return samples;
  const ratio = 2 ** (semitones / 12);
  // Resampling by `ratio` raises pitch and shortens the clip by the same
  // factor; stretching by `ratio` puts the length back without undoing the
  // pitch. Formants ride along, which is exactly the cartoon-voice effect.
  return timeStretch(resample(samples, ratio), ratio, sampleRate);
}

/** Ring modulation - the classic robot tone. */
function ringMod(samples, hz, mix, sampleRate) {
  if (!hz || !mix) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const carrier = Math.sin((2 * Math.PI * hz * i) / sampleRate);
    out[i] = samples[i] * (1 - mix) + samples[i] * carrier * mix;
  }
  return out;
}

/** Slow amplitude and pitch wobble - reads as age or strain. */
function wobble(samples, hz, depth, sampleRate) {
  if (!depth) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const lfo = Math.sin((2 * Math.PI * hz * i) / sampleRate);
    out[i] = samples[i] * (1 - depth * 0.5 + depth * 0.5 * lfo);
  }
  return out;
}

function distortionCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount * 60;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

/** A short synthetic impulse response - enough for a room or a cavern. */
function makeImpulse(ctx, seconds, decay) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const impulse = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = impulse.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
  }
  return impulse;
}

/**
 * Voice presets. `pitch` is in semitones; the rest shape the timbre.
 * Deliberately few and strongly differentiated - a dozen subtle variants would
 * all read the same once a character is talking over a scene.
 */
export const VOICE_PRESETS = [
  { id: "none", name: "As recorded", params: {} },
  { id: "deep", name: "Deep", params: { pitch: -5, lowpass: 3200, peak: [180, 5] } },
  { id: "giant", name: "Giant", params: { pitch: -9, lowpass: 2200, peak: [110, 7], reverb: 1.4, reverbMix: 0.32 } },
  { id: "monster", name: "Monster", params: { pitch: -7, drive: 0.45, ring: [42, 0.35], lowpass: 2600 } },
  { id: "high", name: "Bright", params: { pitch: 3, highpass: 180, peak: [2600, 4] } },
  { id: "child", name: "Child", params: { pitch: 6, highpass: 260, peak: [3000, 3] } },
  { id: "chipmunk", name: "Chipmunk", params: { pitch: 10, highpass: 300 } },
  { id: "old", name: "Elderly", params: { pitch: -2, wobble: [5.5, 0.28], bandpass: [900, 1.1] } },
  { id: "robot", name: "Robot", params: { ring: [70, 0.75], bandpass: [1400, 2.4], drive: 0.25 } },
  { id: "radio", name: "Radio / phone", params: { bandpass: [1700, 1.6], drive: 0.18, highpass: 420, lowpass: 3200 } },
  { id: "whisper", name: "Whisper", params: { pitch: 1, highpass: 900, drive: 0.1, gain: 0.7 } },
  { id: "cavern", name: "Cavernous", params: { pitch: -3, reverb: 2.6, reverbMix: 0.5, lowpass: 4000 } },
];

export function voicePreset(id) {
  return VOICE_PRESETS.find((p) => p.id === id) || VOICE_PRESETS[0];
}

/**
 * Apply a voice preset to an AudioBuffer, returning a new one.
 *
 * @param {AudioBuffer} buffer
 * @param {string} presetId
 * @param {{pitch?:number}} [overrides] - extra semitones on top of the preset
 * @returns {Promise<AudioBuffer>}
 */
export async function applyVoice(buffer, presetId, overrides = {}) {
  const preset = voicePreset(presetId);
  const p = { ...preset.params };
  if (overrides.pitch) p.pitch = (p.pitch || 0) + overrides.pitch;
  if (!Object.keys(p).length) return buffer;

  const rate = buffer.sampleRate;

  // Sample-domain work first: pitch, ring modulation and wobble.
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    let data = buffer.getChannelData(c).slice();
    if (p.pitch) data = pitchShift(data, p.pitch, rate);
    if (p.ring) data = ringMod(data, p.ring[0], p.ring[1], rate);
    if (p.wobble) data = wobble(data, p.wobble[0], p.wobble[1], rate);
    channels.push(data);
  }

  const length = Math.max(...channels.map((d) => d.length));
  const tail = p.reverb ? Math.ceil(rate * p.reverb) : 0;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Offline(buffer.numberOfChannels, length + tail, rate);

  const staged = ctx.createBuffer(buffer.numberOfChannels, length, rate);
  channels.forEach((data, c) => staged.copyToChannel(data, c, 0));
  const source = ctx.createBufferSource();
  source.buffer = staged;

  // Then the filter chain, where the browser's own biquads do the work.
  let node = source;
  const link = (next) => {
    node.connect(next);
    node = next;
  };
  if (p.highpass) {
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = p.highpass;
    link(f);
  }
  if (p.lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = p.lowpass;
    link(f);
  }
  if (p.bandpass) {
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = p.bandpass[0];
    f.Q.value = p.bandpass[1];
    link(f);
  }
  if (p.peak) {
    const f = ctx.createBiquadFilter();
    f.type = "peaking";
    f.frequency.value = p.peak[0];
    f.Q.value = 1;
    f.gain.value = p.peak[1];
    link(f);
  }
  if (p.drive) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(p.drive);
    shaper.oversample = "2x";
    link(shaper);
  }

  const out = ctx.createGain();
  out.gain.value = p.gain ?? 1;

  if (p.reverb) {
    // Wet and dry in parallel, so the voice stays intelligible.
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, p.reverb, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = p.reverbMix ?? 0.3;
    const dry = ctx.createGain();
    dry.gain.value = 1 - (p.reverbMix ?? 0.3) * 0.6;
    node.connect(convolver);
    convolver.connect(wet);
    wet.connect(out);
    node.connect(dry);
    dry.connect(out);
  } else {
    node.connect(out);
  }

  out.connect(ctx.destination);
  source.start();
  const rendered = await ctx.startRendering();

  // Filters and drive can push a preset past full scale; pull it back rather
  // than shipping a clipped line into the mix.
  let peak = 0;
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const data = rendered.getChannelData(c);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  if (peak > 0.95) {
    const trim = 0.95 / peak;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const data = rendered.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] *= trim;
    }
  }
  return rendered;
}
