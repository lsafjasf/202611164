import {
  BEATS_PER_BAR,
  TRACK_DEFS,
  buildNotePlan,
    exportDurationSeconds,
  normalizeProject,
} from "./project.js";

const LOOKAHEAD_VOICE_SECONDS = 0.12;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function makeNoiseBuffer(context, seed, seconds = 2) {
  const length = Math.ceil(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let state = (seed || 778) >>> 0;
  for (let index = 0; index < length; index += 1) {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    data[index] = (((value ^ (value >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return buffer;
}

function buildMixer(context, project, destination = context.destination) {
  const master = context.createGain();
  master.gain.value = project.masterGain;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;
  const masterAnalyser = context.createAnalyser();
  masterAnalyser.fftSize = 512;
  masterAnalyser.smoothingTimeConstant = 0.7;
  master.connect(compressor);
  compressor.connect(masterAnalyser);
  masterAnalyser.connect(destination);

  const tracks = project.tracks.map((track) => {
    const gain = context.createGain();
    gain.gain.value = track.gain;
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    gain.connect(analyser);
    analyser.connect(master);
    return { gain, analyser, byteData: new Uint8Array(analyser.fftSize) };
  });

  return {
    context,
    master,
    compressor,
    masterAnalyser,
    masterBytes: new Uint8Array(masterAnalyser.fftSize),
    tracks,
    noiseBuffer: makeNoiseBuffer(context, project.seed),
  };
}

function holdAndFade(gainNode, time, fadeSeconds) {
  if (!gainNode) {
    return;
  }
  try {
    if (typeof gainNode.cancelAndHoldAtTime === "function") {
      gainNode.cancelAndHoldAtTime(time);
    } else {
      gainNode.cancelScheduledValues(time);
      gainNode.setValueAtTime(0.0001, time);
    }
  } catch {
    gainNode.cancelScheduledValues(time);
    gainNode.setValueAtTime(0.0001, time);
  }
  if (fadeSeconds > 0) {
    gainNode.linearRampToValueAtTime(0, time + fadeSeconds);
  } else {
    gainNode.setValueAtTime(0, time);
  }
}

function createVoiceNodes(context, mixer, trackIndex, project, step, absoluteStep, when) {
  const track = project.tracks[trackIndex];
  const definition = TRACK_DEFS[trackIndex];
  const output = context.createGain();
  const panner = context.createStereoPanner();
  const velocity = clamp(step.velocity / 127, 0.02, 1);
  output.gain.value = velocity;
  panner.pan.value = clamp(step.pan / 100, -1, 1);
  output.connect(panner);
  panner.connect(mixer.tracks[trackIndex].gain);

  const nodes = [output, panner];
  const sources = [];
  const envelopes = [];
  const midi = definition.midi + track.tune + project.transpose;
  const baseHz = Math.max(20, midiToHz(midi));
  const decay = clamp(track.decay, 0.05, 1.2);
  const tone = clamp(track.tone, 0, 1);

  const addNode = (node) => {
    nodes.push(node);
    return node;
  };

  const addSource = (source, stopAt) => {
    sources.push(source);
    try {
      source.start(when);
    } catch {
      // The source can only be started once.
    }
    try {
      source.stop(stopAt);
    } catch {
      source.stop(when + decay + 0.1);
    }
    return source;
  };

  const connectEnvelope = (source, target, peak, attack, release) => {
    const envelope = addNode(context.createGain());
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(peak, when + Math.max(0.0005, attack));
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(attack + 0.01, release));
    source.connect(envelope);
    envelope.connect(target ?? output);
    envelopes.push(envelope);
    return envelope;
  };

  const scheduleNoiseBurst = (options) => {
    const source = context.createBufferSource();
    source.buffer = mixer.noiseBuffer;
    source.loop = false;
    source.playbackRate.value = options.rate ?? 1;
    let tail = output;
    if (options.filterType) {
      const filter = addNode(context.createBiquadFilter());
      filter.type = options.filterType;
      filter.frequency.value = options.frequency;
      filter.Q.value = options.q ?? 0.8;
      filter.connect(output);
      tail = filter;
    }
    connectEnvelope(source, tail, options.peak, options.attack ?? 0.002, options.release);
    addSource(source, when + options.release + 0.035);
    return source;
  };

  if (definition.id === "kick") {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    const startHz = clamp(baseHz * 4.6, 45, 480);
    oscillator.frequency.setValueAtTime(startHz, when);
    oscillator.frequency.exponentialRampToValueAtTime(baseHz * 1.05, when + 0.075);
    oscillator.frequency.exponentialRampToValueAtTime(baseHz * 0.88, when + decay * 0.7);
    connectEnvelope(oscillator, output, 0.88, 0.002, decay);
    addSource(oscillator, when + decay + 0.04);

    scheduleNoiseBurst({
      filterType: "lowpass",
      frequency: 900 + tone * 1500,
      q: 0.5,
      peak: 0.09 + tone * 0.05,
      attack: 0.001,
      release: 0.026,
      rate: 0.8,
    });
  }

  if (definition.id === "snare") {
    scheduleNoiseBurst({
      filterType: "bandpass",
      frequency: 1350 + tone * 2300,
      q: 0.62,
      peak: 0.62,
      attack: 0.002,
      release: decay,
      rate: 1,
    });
    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(baseHz * 2.1, when);
    oscillator.frequency.exponentialRampToValueAtTime(baseHz * 1.45, when + decay * 0.45);
    connectEnvelope(oscillator, output, 0.24, 0.003, decay * 0.72);
    addSource(oscillator, when + decay + 0.04);
  }

  if (definition.id === "hat") {
    scheduleNoiseBurst({
      filterType: "highpass",
      frequency: 5400 + tone * 4400,
      q: 0.7,
      peak: 0.55,
      attack: 0.001,
      release: Math.max(0.045, decay),
      rate: 1.2,
    });
    const oscillator = context.createOscillator();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(clamp(baseHz * 36 + tone * 900, 2400, 12000), when);
    connectEnvelope(oscillator, output, 0.065, 0.0008, Math.max(0.03, decay * 0.72));
    addSource(oscillator, when + decay + 0.03);
  }

  if (definition.id === "perc") {
    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(baseHz * 1.45, when);
    oscillator.frequency.exponentialRampToValueAtTime(baseHz * 0.88, when + decay * 0.38);
    connectEnvelope(oscillator, output, 0.5, 0.003, decay);
    addSource(oscillator, when + decay + 0.04);
    scheduleNoiseBurst({
      filterType: "bandpass",
      frequency: 3400 + tone * 2300,
      q: 1.2,
      peak: 0.18,
      attack: 0.001,
      release: Math.min(0.12, decay),
      rate: 1.4,
    });
  }

  return {
    when,
    output,
    panner,
    nodes,
    sources,
    envelopes,
    released: false,
    finalized: false,
  };
}

function analyserRms(analyser, byteData) {
  analyser.getByteTimeDomainData(byteData);
  let sum = 0;
  for (let index = 0; index < byteData.length; index += 1) {
    const sample = (byteData[index] - 128) / 128;
    sum += sample * sample;
  }
  return clamp(Math.sqrt(sum / byteData.length) * 2.8, 0, 1);
}

export class DrumAudioEngine {
  constructor() {
    this.context = null;
    this.mixer = null;
    this.voices = new Set();
    this.seed = null;
  }

  async ensureStarted(project) {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("此浏览器不支持 Web Audio");
      }
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.mixer = buildMixer(this.context, normalizeProject(project));
      this.seed = project.seed;
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.syncProject(project);
    return this.context;
  }

  syncProject(project) {
    if (!this.context || !this.mixer) {
      return;
    }
    const now = this.context.currentTime;
    this.mixer.master.gain.setTargetAtTime(
      clamp(project.masterGain, 0, 1.2),
      now,
      0.018,
    );
    project.tracks.forEach((track, index) => {
      const analyser = this.mixer.tracks[index];
      if (analyser) {
        analyser.gain.gain.setTargetAtTime(clamp(track.gain, 0, 1.5), now, 0.018);
      }
    });
    if (project.seed !== this.seed) {
      this.seed = project.seed;
      this.mixer.noiseBuffer = makeNoiseBuffer(this.context, project.seed);
    }
  }

  scheduleVoice(project, trackIndex, step, absoluteStep, when) {
    if (!this.context || !this.mixer) {
      return null;
    }
    const safeWhen = Math.max(when, this.context.currentTime + 0.004);
    const voice = createVoiceNodes(
      this.context,
      this.mixer,
      trackIndex,
      project,
      step,
      absoluteStep,
      safeWhen,
    );
    this.voices.add(voice);
    let endedSources = 0;
    const finalize = () => {
      if (voice.finalized) {
        return;
      }
      voice.finalized = true;
      for (const node of voice.nodes) {
        try {
          node.disconnect();
        } catch {
          // Node may already be disconnected.
        }
      }
      this.voices.delete(voice);
    };
    for (const source of voice.sources) {
      source.addEventListener(
        "ended",
        () => {
          endedSources += 1;
          if (endedSources >= voice.sources.length) {
            finalize();
          }
        },
        { once: true },
      );
    }
    if (voice.sources.length === 0) {
      finalize();
    }
    return voice;
  }

  cancelScheduledAfter(time) {
    if (!this.context) {
      return;
    }
    for (const voice of [...this.voices]) {
      if (voice.when >= time) {
        releaseVoice(voice, 0, this.context.currentTime);
      }
    }
  }

  releaseAll(fadeSeconds = 0.012) {
    if (!this.context) {
      return;
    }
    const now = this.context.currentTime;
    for (const voice of [...this.voices]) {
      releaseVoice(voice, fadeSeconds, now);
    }
  }

  readLevels() {
    if (!this.mixer) {
      return { tracks: [0, 0, 0, 0], master: 0 };
    }
    return {
      tracks: this.mixer.tracks.map((track) => analyserRms(track.analyser, track.byteData)),
      master: analyserRms(this.mixer.masterAnalyser, this.mixer.masterBytes),
    };
  }

  async dispose() {
    this.releaseAll(0.004);
    if (this.context) {
      const context = this.context;
      this.context = null;
      this.mixer = null;
      try {
        await context.close();
      } catch {
        // Context may already be closed by the browser.
      }
    }
    this.voices.clear();
  }
}

function releaseVoice(voice, fadeSeconds, now) {
  if (!voice || voice.released) {
    return;
  }
  voice.released = true;
  const time = Math.max(now, voice.when, 0);
  holdAndFade(voice.output.gain, time, fadeSeconds);
  const stopAt = time + Math.max(0.002, fadeSeconds) + 0.01;
  for (const source of voice.sources) {
    try {
      source.stop(stopAt);
    } catch {
      // An AudioScheduledSourceNode can only be stopped once.
    }
  }
}

export async function renderProjectToWav(project, options = {}) {
  const normalized = normalizeProject(project);
  const sampleRate = clamp(Math.round(options.sampleRate || 44100), 22050, 96000);
  const duration = exportDurationSeconds(normalized);
  const frameCount = Math.max(1, Math.ceil(duration * sampleRate));
  const OfflineContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineContextClass) {
    throw new Error("此浏览器不支持离线音频渲染");
  }
  const context = new OfflineContextClass(2, frameCount, sampleRate);
  const mixer = buildMixer(context, normalized);
  const notes = buildNotePlan(normalized, normalized.exportBars);
  const secondsPerBeat = 60 / normalized.bpm;
  const startOffset = 0.02;

  for (const note of notes) {
    const step = normalized.tracks[note.trackIndex].steps[note.step];
    const voice = createVoiceNodes(
      context,
      mixer,
      note.trackIndex,
      normalized,
      step,
      note.absoluteStep,
      startOffset + note.beat * secondsPerBeat,
    );
  }

  const buffer = await context.startRendering();
  return {
    buffer,
    wav: encodeWav(buffer),
    duration: buffer.duration,
    sampleRate,
    frames: buffer.length,
    noteCount: notes.length,
    beatPositions: notes.map((note) => note.beat),
    loopDuration: (normalized.exportBars * BEATS_PER_BAR * 60) / normalized.bpm,
    tail: duration - (normalized.exportBars * BEATS_PER_BAR * 60) / normalized.bpm,
  };
}

export function encodeWav(buffer) {
  const channelCount = Math.min(2, buffer.numberOfChannels);
  const frameCount = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frameCount * channelCount * bytesPerSample;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: channelCount }, (_, index) => buffer.getChannelData(index));
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = clamp(channels[channel][frame], -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return output;
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

export function audioSupportInfo() {
  return {
    audioContext: Boolean(window.AudioContext || window.webkitAudioContext),
    offlineAudio: Boolean(window.OfflineAudioContext || window.webkitOfflineAudioContext),
    sampleRate: 44100,
    lookahead: LOOKAHEAD_VOICE_SECONDS,
  };
}
