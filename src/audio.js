import { hashSeed, mulberry32 } from "./engine.js";

export const CLIP_SECONDS = 4.8;
export const SAMPLE_RATE = 44100;
const CUE_AT = 0.48;
const EVENT_AT = 1.52;
const ORDER_AT = 2.86;

const DIRECTION_AUDIO = {
  左前: { pan: -0.82, front: true },
  右前: { pan: 0.82, front: true },
  左后: { pan: -0.62, front: false },
  右后: { pan: 0.62, front: false },
};

const DISTANCE_AUDIO = {
  近: { dry: 0.92, wet: 0.035, echoGap: 0.085, echoGain: 0.11, tone: 0.26 },
  中: { dry: 0.58, wet: 0.18, echoGap: 0.18, echoGain: 0.18, tone: 0.2 },
  远: { dry: 0.31, wet: 0.42, echoGap: 0.34, echoGain: 0.26, tone: 0.14 },
};

function offlineContextClass() {
  const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Context) {
    throw new Error("当前浏览器不支持 Web Audio 离线渲染。");
  }
  return Context;
}

function noiseBuffer(context, seconds, random, stereo = false) {
  const buffer = context.createBuffer(
    stereo ? 2 : 1,
    Math.ceil(seconds * context.sampleRate),
    context.sampleRate,
  );
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = random() * 2 - 1;
      smooth = smooth * 0.72 + white * 0.28;
      data[index] = smooth;
    }
  }
  return buffer;
}

function impulseBuffer(context, random) {
  const seconds = 1.35;
  const length = Math.floor(seconds * context.sampleRate);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const progress = index / length;
      const decay = Math.pow(1 - progress, 2.8);
      data[index] = (random() * 2 - 1) * decay * 0.55;
    }
  }
  return buffer;
}

function gainEnvelope(context, start, peak, attack, hold, release) {
  const gain = context.createGain();
  const floor = 0.0001;
  gain.gain.setValueAtTime(floor, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, floor), start + attack);
  gain.gain.setValueAtTime(Math.max(peak, floor), start + attack + hold);
  gain.gain.exponentialRampToValueAtTime(
    floor,
    start + attack + hold + release,
  );
  return gain;
}

function addSpace(context, source, bus, options, random) {
  const direction = DIRECTION_AUDIO[options.direction];
  const distance = DISTANCE_AUDIO[options.distance];
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = direction.front ? 7600 : 1900;
  filter.Q.value = 0.45;

  const tone = context.createBiquadFilter();
  tone.type = "highpass";
  tone.frequency.value = 70;

  const panner = context.createStereoPanner();
  panner.pan.value = direction.pan;

  const dry = context.createGain();
  dry.gain.value = distance.dry;

  const wet = context.createGain();
  wet.gain.value = distance.wet;

  source.connect(tone);
  tone.connect(filter);
  filter.connect(panner);
  panner.connect(dry);
  dry.connect(bus);
  panner.connect(wet);
  wet.connect(bus.reverb);

  const echoDelay = context.createDelay(0.7);
  echoDelay.delayTime.value = distance.echoGap;
  const echoGain = context.createGain();
  echoGain.gain.value = distance.echoGain;
  const echoPan = context.createStereoPanner();
  echoPan.pan.value = direction.pan * 0.8;
  panner.connect(echoDelay);
  echoDelay.connect(echoGain);
  echoGain.connect(echoPan);
  echoPan.connect(bus);

  return { direction, distance, panner, filter };
}

function synthDirectionVoice(context, bus, event, random) {
  const spatial = addSpace(context, context.createGain(), bus, event, random);
  const voiceBus = context.createGain();
  voiceBus.connect(spatial.panner);

  const basePitch = spatial.direction.front ? 128 : 82;
  const carrier = context.createOscillator();
  carrier.type = "sawtooth";
  carrier.frequency.setValueAtTime(basePitch, CUE_AT);
  carrier.frequency.linearRampToValueAtTime(basePitch * 1.14, CUE_AT + 0.42);

  const voiceEnvelope = gainEnvelope(context, CUE_AT, 0.11, 0.035, 0.2, 0.22);
  const formants = [
    { frequency: spatial.direction.front ? 760 : 520, gain: 0.9, q: 7 },
    { frequency: spatial.direction.front ? 1280 : 860, gain: 0.62, q: 8 },
    { frequency: spatial.direction.front ? 2480 : 1540, gain: 0.3, q: 9 },
  ];
  carrier.connect(voiceEnvelope);
  for (const formant of formants) {
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = formant.frequency;
    filter.Q.value = formant.q;
    const gain = context.createGain();
    gain.gain.value = formant.gain;
    voiceEnvelope.connect(filter);
    filter.connect(gain);
    gain.connect(voiceBus);
  }
  carrier.start(CUE_AT);
  carrier.stop(CUE_AT + 0.56);

  const ping = context.createOscillator();
  ping.type = "sine";
  ping.frequency.value = spatial.direction.front ? 880 : 392;
  const pingGain = gainEnvelope(context, CUE_AT + 0.7, 0.16, 0.012, 0.07, 0.12);
  ping.connect(pingGain);
  pingGain.connect(spatial.panner);
  ping.start(CUE_AT + 0.7);
  ping.stop(CUE_AT + 1.02);

  const echo = context.createOscillator();
  echo.type = "sine";
  echo.frequency.value = spatial.direction.front ? 660 : 294;
  const echoGain = gainEnvelope(
    context,
    CUE_AT + 0.78 + spatial.distance.echoGap,
    spatial.distance.tone,
    0.01,
    0.05,
    0.16,
  );
  echo.connect(echoGain);
  echoGain.connect(spatial.panner);
  echo.start(CUE_AT + 0.78 + spatial.distance.echoGap);
  echo.stop(CUE_AT + 1.35);
}

function synthBrake(context, output, start, random) {
  const duration = 0.95;
  const oscillator = context.createOscillator();
  oscillator.type = "sawtooth";
  oscillator.frequency.setValueAtTime(2380, start);
  oscillator.frequency.exponentialRampToValueAtTime(910, start + duration);
  const sweepGain = gainEnvelope(context, start, 0.075, 0.03, 0.22, 0.65);
  oscillator.connect(sweepGain);
  sweepGain.connect(output);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);

  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer(context, 1.4, random);
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 1600;
  const noiseGain = gainEnvelope(context, start, 0.16, 0.015, 0.25, 0.74);
  noise.connect(highpass);
  highpass.connect(noiseGain);
  noiseGain.connect(output);
  noise.start(start);
}

function synthHorn(context, output, start) {
  for (const [frequency, detune] of [
    [332, -4],
    [417, 5],
  ]) {
    const oscillator = context.createOscillator();
    oscillator.type = "sawtooth";
    oscillator.frequency.value = frequency;
    oscillator.detune.value = detune;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1250;
    const gain = gainEnvelope(context, start, 0.11, 0.045, 0.62, 0.18);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    oscillator.start(start);
    oscillator.stop(start + 0.9);
  }
}

function synthImpact(context, output, start, random, light = false) {
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(light ? 92 : 72, start);
  oscillator.frequency.exponentialRampToValueAtTime(38, start + 0.32);
  const thump = gainEnvelope(
    context,
    start,
    light ? 0.23 : 0.46,
    0.008,
    0.05,
    0.34,
  );
  oscillator.connect(thump);
  thump.connect(output);
  oscillator.start(start);
  oscillator.stop(start + 0.42);

  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer(context, 1.1, random);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(light ? 760 : 1250, start);
  filter.frequency.exponentialRampToValueAtTime(180, start + 0.45);
  const burst = gainEnvelope(
    context,
    start,
    light ? 0.13 : 0.25,
    0.005,
    0.025,
    0.36,
  );
  noise.connect(filter);
  filter.connect(burst);
  burst.connect(output);
  noise.start(start);
}

function synthGlass(context, output, start, random) {
  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer(context, 1.2, random, true);
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 2600;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  const grains = [0, 0.045, 0.095, 0.16, 0.24, 0.36, 0.51];
  for (const [index, offset] of grains.entries()) {
    const level = 0.28 - index * 0.028;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(level, start + offset + 0.006);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      start + offset + 0.038 + index * 0.006,
    );
  }
  noise.connect(highpass);
  highpass.connect(gain);
  gain.connect(output);
  noise.start(start);

  for (let grain = 0; grain < 4; grain += 1) {
    const ping = context.createOscillator();
    ping.type = "sine";
    ping.frequency.value = 3600 + grain * 760 + random() * 480;
    const grainGain = gainEnvelope(
      context,
      start + 0.04 + grain * 0.075,
      0.055,
      0.003,
      0.025,
      0.15,
    );
    ping.connect(grainGain);
    grainGain.connect(output);
    ping.start(start + 0.04 + grain * 0.075);
    ping.stop(start + 0.28 + grain * 0.075);
  }
}

function synthAirbag(context, output, start, random) {
  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer(context, 1.0, random);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(3600, start);
  filter.frequency.exponentialRampToValueAtTime(340, start + 0.55);
  const gain = gainEnvelope(context, start, 0.32, 0.006, 0.1, 0.52);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(output);
  noise.start(start);

  const thump = context.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(118, start);
  thump.frequency.exponentialRampToValueAtTime(52, start + 0.22);
  const thumpGain = gainEnvelope(context, start, 0.17, 0.006, 0.03, 0.24);
  thump.connect(thumpGain);
  thumpGain.connect(output);
  thump.start(start);
  thump.stop(start + 0.3);
}

function synthSiren(context, output, start) {
  const oscillator = context.createOscillator();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(710, start);
  for (let step = 0; step < 5; step += 1) {
    oscillator.frequency.exponentialRampToValueAtTime(
      step % 2 === 0 ? 1160 : 730,
      start + 0.2 + step * 0.24,
    );
  }
  const gain = gainEnvelope(context, start, 0.12, 0.08, 0.72, 0.28);
  oscillator.connect(gain);
  gain.connect(output);
  oscillator.start(start);
  oscillator.stop(start + 1.15);
}

function synthValve(context, output, start, random) {
  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer(context, 1.5, random);
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 1750;
  const gain = gainEnvelope(context, start, 0.17, 0.02, 0.12, 0.92);
  noise.connect(highpass);
  highpass.connect(gain);
  gain.connect(output);
  noise.start(start);

  const flutter = context.createOscillator();
  flutter.type = "square";
  flutter.frequency.value = 26;
  const flutterGain = context.createGain();
  flutterGain.gain.value = 0.018;
  flutter.connect(flutterGain);
  flutterGain.connect(output);
  flutter.start(start + 0.1);
  flutter.stop(start + 1.2);
}

function synthEvent(context, output, event, start, random) {
  switch (event.key) {
    case "brake":
      synthBrake(context, output, start, random);
      break;
    case "horn":
      synthHorn(context, output, start);
      break;
    case "impact":
      synthImpact(context, output, start, random);
      break;
    case "glass":
      synthGlass(context, output, start, random);
      break;
    case "airbag":
      synthAirbag(context, output, start, random);
      break;
    case "siren":
      synthSiren(context, output, start);
      break;
    case "secondary":
      synthImpact(context, output, start, random, true);
      synthImpact(context, output, start + 0.24, random, true);
      break;
    case "valve":
      synthValve(context, output, start, random);
      break;
    default:
      synthImpact(context, output, start, random, true);
  }
}

function synthBackground(context, bus, random) {
  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer(context, CLIP_SECONDS, random, true);
  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 210;
  const gain = context.createGain();
  gain.gain.value = 0.038;
  noise.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(bus);
  noise.start(0);

  const hum = context.createOscillator();
  hum.type = "sine";
  hum.frequency.value = 54;
  const humGain = context.createGain();
  humGain.gain.value = 0.012;
  hum.connect(humGain);
  humGain.connect(bus);
  hum.start(0);
  hum.stop(CLIP_SECONDS);
}

function synthOrderPips(context, bus, order) {
  for (let index = 0; index < order; index += 1) {
    const at = ORDER_AT + index * 0.115;
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = 1550 + index * 24;
    const gain = gainEnvelope(context, at, 0.105, 0.006, 0.035, 0.06);
    oscillator.connect(gain);
    gain.connect(bus);
    oscillator.start(at);
    oscillator.stop(at + 0.12);
  }
}

export async function renderClueAudio(caseData, clue, sampleRate = SAMPLE_RATE) {
  const caseRandom = mulberry32(hashSeed(`${caseData.seed}:${clue.id}`));
  const event = caseData.eventsById.get(clue.eventId);
  const Context = offlineContextClass();
  const context = new Context(
    2,
    Math.ceil(CLIP_SECONDS * sampleRate),
    sampleRate,
  );
  const master = context.createGain();
  master.gain.value = 0.86;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 16;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;
  master.connect(compressor);
  compressor.connect(context.destination);

  const reverb = context.createConvolver();
  reverb.buffer = impulseBuffer(context, caseRandom);
  const reverbReturn = context.createGain();
  reverbReturn.gain.value = 0.32;
  reverb.connect(reverbReturn);
  reverbReturn.connect(master);
  master.reverb = reverb;

  synthBackground(context, master, caseRandom);
  synthDirectionVoice(context, master, event, caseRandom);
  const eventBus = context.createGain();
  addSpace(context, eventBus, master, event, caseRandom);
  synthEvent(context, eventBus, event, EVENT_AT, caseRandom);
  synthOrderPips(context, master, event.trueOrder);

  return context.startRendering();
}

export async function renderAllClues(caseData, onProgress = () => {}) {
  const buffers = new Map();
  for (let index = 0; index < caseData.clues.length; index += 1) {
    const clue = caseData.clues[index];
    onProgress(index, caseData.clues.length, clue);
    const buffer = await renderClueAudio(caseData, clue);
    buffers.set(clue.id, buffer);
  }
  onProgress(caseData.clues.length, caseData.clues.length);
  return buffers;
}

export function createPlaybackContext() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) {
    throw new Error("当前浏览器不支持 Web Audio 播放。");
  }
  return new Context();
}
