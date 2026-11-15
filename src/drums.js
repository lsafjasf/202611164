import { TRACK_DEFS } from "./model.js";

const SLICE_SECONDS = 1.2;

export function createDrumKit(sampleRate = 48_000) {
  const sliceLength = Math.round(SLICE_SECONDS * sampleRate);
  const source = new Float32Array(sliceLength * TRACK_DEFS.length);
  const slices = TRACK_DEFS.map((definition, index) => {
    const slice = synthesizeSlice(definition.id, sampleRate, sliceLength);
    source.set(slice, index * sliceLength);
    return {
      id: definition.id,
      index,
      name: definition.name,
      color: definition.color,
      data: slice,
      sampleRate,
      duration: slice.length / sampleRate,
      sourceStart: index * sliceLength / sampleRate,
      sourceEnd: (index + 1) * sliceLength / sampleRate,
    };
  });
  return { source, slices, sampleRate, duration: source.length / sampleRate };
}

function synthesizeSlice(id, sampleRate, length) {
  const data = new Float32Array(length);
  const noise = seededNoise(hashString(id));
  let phase = 0;
  let overtone = 0;
  let noiseLow = 0;
  let noisePrevious = 0;

  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    const white = noise();
    noiseLow += (white - noiseLow) * 0.18;
    const highNoise = white - noisePrevious;
    noisePrevious = white;

    let sample = 0;
    if (id === "kick") {
      const frequency = 45 + 118 * Math.exp(-time * 30);
      phase += (Math.PI * 2 * frequency) / sampleRate;
      const click = highNoise * Math.exp(-time * 95) * 0.19;
      sample = Math.sin(phase) * Math.exp(-time * 8.5) + click;
      sample = Math.tanh(sample * 1.45);
    } else if (id === "snare") {
      phase += (Math.PI * 2 * 184) / sampleRate;
      const body = Math.sin(phase) * Math.exp(-time * 24) * 0.34;
      const rattle = (highNoise * 0.58 + noiseLow * 0.32) * Math.exp(-time * 11.5);
      sample = Math.tanh((body + rattle) * 1.2);
    } else if (id === "hat") {
      phase += (Math.PI * 2 * 7_640) / sampleRate;
      overtone += (Math.PI * 2 * 11_280) / sampleRate;
      const metal = (Math.sin(phase) + Math.sin(overtone) * 0.48) * 0.11;
      sample = (highNoise * 0.72 + metal) * Math.exp(-time * 58);
    } else {
      const frequency = 82 + 112 * Math.exp(-time * 17);
      phase += (Math.PI * 2 * frequency) / sampleRate;
      overtone += (Math.PI * 2 * frequency * 1.52) / sampleRate;
      sample =
        (Math.sin(phase) + Math.sin(overtone) * 0.22 + noiseLow * 0.05) *
        Math.exp(-time * 7.6);
      sample = Math.tanh(sample * 1.12);
    }

    const edgeFade = Math.min(1, time / 0.0015, (length / sampleRate - time) / 0.018);
    data[index] = sample * Math.max(0, edgeFade);
  }

  normalize(data, 0.88);
  return data;
}

function normalize(data, peak) {
  let maximum = 0;
  for (const sample of data) maximum = Math.max(maximum, Math.abs(sample));
  if (maximum === 0) return;
  const scale = peak / maximum;
  for (let index = 0; index < data.length; index += 1) data[index] *= scale;
}

function seededNoise(seed) {
  let state = seed || 1;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return (state / 4_294_967_296) * 2 - 1;
  };
}

function hashString(value) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function waveformPeaks(data, buckets = 320) {
  const peaks = new Float32Array(buckets);
  const bucketSize = Math.max(1, Math.floor(data.length / buckets));
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = bucket * bucketSize;
    const to = Math.min(data.length, from + bucketSize);
    let peak = 0;
    for (let index = from; index < to; index += 1) {
      peak = Math.max(peak, Math.abs(data[index]));
    }
    peaks[bucket] = peak;
  }
  return peaks;
}
