import {
  TOTAL_BEATS,
  countNotes,
  getExportDuration,
  getPlaybackRange,
  noteEvents,
  pitchRatio,
  sanitizeProject,
  secondsPerBeat,
  wrapBeat,
} from "./model.js";
import { createDrumKit } from "./drums.js";

const START_DELAY = 0.035;
const CUT_FADE = 0.002;

export function createMasterChain(context, amount) {
  const input = context.createGain();
  const compressor = context.createDynamicsCompressor();
  input.gain.value = amount;
  compressor.threshold.value = -15;
  compressor.knee.value = 18;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.14;
  input.connect(compressor);
  return { input, compressor, analyser: null };
}

export function createVoice(context, destination, track, buffer, startTime, hardStopTime) {
  if (!buffer || track.muted || track.gain <= 0) return null;
  const offset = track.start * buffer.duration;
  const sourceDuration = Math.max(0.002, (track.end - track.start) * buffer.duration);
  const rate = pitchRatio(track.pitch);
  const naturalDuration = sourceDuration / rate;
  const boundary = Number.isFinite(hardStopTime) ? hardStopTime : startTime + naturalDuration;
  const duration = Math.min(naturalDuration, boundary - startTime);
  if (duration <= 0.003) return null;

  const source = context.createBufferSource();
  const envelope = context.createGain();
  const gate = context.createGain();
  source.buffer = buffer;
  source.playbackRate.setValueAtTime(rate, startTime);

  const fadeIn = Math.min(track.fadeIn, duration * 0.45);
  const fadeOut = Math.min(track.fadeOut, duration * 0.45);
  const endTime = startTime + duration;
  const holdUntil = Math.max(startTime + fadeIn, endTime - fadeOut);
  envelope.gain.setValueAtTime(0, startTime);
  if (fadeIn > 0.0005) {
    envelope.gain.linearRampToValueAtTime(track.gain, startTime + fadeIn);
  } else {
    envelope.gain.setValueAtTime(track.gain, startTime);
  }
  envelope.gain.setValueAtTime(track.gain, holdUntil);
  envelope.gain.linearRampToValueAtTime(0, endTime);

  const clippedAtBoundary = boundary < startTime + naturalDuration - 0.0005;
  gate.gain.setValueAtTime(1, startTime);
  if (clippedAtBoundary) {
    const fadeStart = Math.max(startTime, boundary - CUT_FADE);
    gate.gain.setValueAtTime(1, fadeStart);
    gate.gain.linearRampToValueAtTime(0, boundary);
  }

  source.connect(envelope);
  envelope.connect(gate);
  gate.connect(destination);
  source.start(startTime, offset, sourceDuration);
  source.stop(endTime);

  return {
    source,
    envelope,
    gate,
    startTime,
    endTime,
    naturalEndTime: startTime + naturalDuration,
    released: false,
  };
}

export function cutVoice(context, voice, atTime) {
  if (!voice || voice.released || atTime >= voice.endTime - 0.0005) return voice;
  const now = context.currentTime;
  const cutAt = Math.max(now, atTime);
  const fadeStart = Math.max(now, voice.startTime, cutAt - CUT_FADE);
  try {
    voice.gate.gain.cancelScheduledValues(fadeStart);
    voice.gate.gain.setValueAtTime(1, fadeStart);
    voice.gate.gain.linearRampToValueAtTime(0, cutAt);
    voice.source.stop(cutAt);
  } catch {
    return voice;
  }
  voice.endTime = cutAt;
  return voice;
}

export function releaseVoice(voice) {
  if (!voice || voice.released) return;
  voice.released = true;
  try {
    voice.source.disconnect();
    voice.envelope.disconnect();
    voice.gate.disconnect();
  } catch {
    void 0;
  }
}

export function encodeWav(audioBuffer) {
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const frames = audioBuffer.length;
  const bytes = new ArrayBuffer(44 + frames * channels * 2);
  const view = new DataView(bytes);
  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + frames * channels * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, frames * channels * 2, true);

  const data = Array.from({ length: channels }, (_, channel) =>
    audioBuffer.getChannelData(channel),
  );
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, data[channel][frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([bytes], { type: "audio/wav" });
}

export function audioBufferFingerprint(buffer) {
  let sum = 0;
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 97) {
      const value = data[index];
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
  }
  return Number((sum / Math.max(1, buffer.length)).toFixed(8));
}

function copySlice(context, slice) {
  const buffer = context.createBuffer(1, slice.data.length, slice.sampleRate);
  buffer.copyToChannel(slice.data, 0);
  return buffer;
}

export class AudioEngine {
  constructor({ onState, onPreview } = {}) {
    this.onState = onState ?? (() => {});
    this.onPreview = onPreview ?? (() => {});
    this.project = null;
    this.context = null;
    this.master = null;
    this.pcmKit = null;
    this.buffers = new Map();
    this.playing = false;
    this.positionBeat = 0;
    this.anchorBeat = 0;
    this.anchorTime = 0;
    this.nextCycleStart = 0;
    this.loopCycleIndex = 0;
    this.voices = [];
    this.voiceSequence = 0;
    this.cycleTimer = null;
    this.endTimer = null;
    this.frameHandle = null;
    this.lastStatus = "等待音频手势";
    this.meterData = null;
  }

  async init() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
    this.context = new AudioContextClass({ latencyHint: "interactive" });
    await this.context.resume();
    this.pcmKit = createDrumKit(this.context.sampleRate);
    this.buffers = new Map(
      this.pcmKit.slices.map((slice) => [slice.id, copySlice(this.context, slice)]),
    );
    this.master = createMasterChain(this.context, this.project?.masterGain ?? 0.86);
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    this.master.compressor.connect(analyser);
    analyser.connect(this.context.destination);
    this.master.analyser = analyser;
    this.lastStatus = "音频引擎就绪";
    this.emit();
  }

  setProject(project) {
    this.project = sanitizeProject(project);
    if (this.master && this.context) {
      this.master.input.gain.setTargetAtTime(
        this.project.masterGain,
        this.context.currentTime,
        0.015,
      );
    }
    if (!this.playing) {
      const range = getPlaybackRange(this.project);
      if (this.project.loop && !isInside(this.positionBeat, range.start, range.end)) {
        this.positionBeat = range.start;
      }
    }
    this.emit();
  }

  applyProject(project, { reboot = true } = {}) {
    const next = sanitizeProject(project);
    if (!this.playing || !reboot) {
      this.setProject(next);
      return;
    }
    const beat = this.currentPosition();
    this.playing = false;
    this.clearTimers();
    this.stopAllVoices();
    this.setProject(next);
    this.startFrom(beat);
  }

  async play() {
    await this.init();
    if (this.playing) return;
    this.playing = true;
    const range = getPlaybackRange(this.project);
    if (this.project.loop) {
      this.positionBeat = wrapBeat(this.positionBeat, range.start, range.end);
    } else if (this.positionBeat >= TOTAL_BEATS - 0.001) {
      this.positionBeat = 0;
    }
    this.startFrom(this.positionBeat);
  }

  pause() {
    if (!this.playing) return;
    this.positionBeat = this.currentPosition();
    this.playing = false;
    this.clearTimers();
    this.stopAllVoices();
    this.cancelFrame();
    this.lastStatus = "已暂停 · 声部已释放";
    this.emit();
  }

  stop() {
    this.playing = false;
    this.positionBeat = 0;
    this.clearTimers();
    this.stopAllVoices();
    this.cancelFrame();
    this.lastStatus = "已停止 · 0 个活动声部";
    this.emit();
  }

  toggle() {
    return this.playing ? this.pause() : this.play();
  }

  startFrom(beat) {
    this.clearTimers();
    this.stopAllVoices();
    const range = getPlaybackRange(this.project);
    const bps = 1 / secondsPerBeat(this.project);
    this.anchorBeat = this.project.loop
      ? wrapBeat(beat, range.start, range.end)
      : Math.min(TOTAL_BEATS, Math.max(0, beat));
    this.anchorTime = this.context.currentTime + START_DELAY;
    this.positionBeat = this.anchorBeat;
    this.playing = true;
    this.lastStatus = "播放中 · Web Audio 时钟锁定";

    if (this.project.loop) {
      const period = (range.end - range.start) / bps;
      const cycleStart = this.anchorTime - (this.anchorBeat - range.start) / bps;
      this.nextCycleStart = cycleStart;
      this.loopCycleIndex = 0;
      this.scheduleLoopCycle(cycleStart, this.anchorTime);
      this.scheduleLoopCycle(cycleStart + period, this.anchorTime);
      this.nextCycleStart = cycleStart + period * 2;
      this.cycleTimer = setInterval(() => {
        if (!this.playing || !this.project.loop) return;
        const horizon = this.context.currentTime + period * 1.4;
        while (this.nextCycleStart < horizon) {
          this.scheduleLoopCycle(this.nextCycleStart, this.anchorTime);
          this.nextCycleStart += period;
          this.loopCycleIndex += 1;
        }
      }, 250);
    } else {
      this.scheduleOnce(this.anchorTime, this.anchorBeat);
      const remaining = TOTAL_BEATS - this.anchorBeat;
      const endDelay = (remaining / bps + START_DELAY + 0.04) * 1000;
      this.endTimer = setTimeout(() => this.finishPlayback(), endDelay);
    }
    this.emit();
    this.startFrame();
  }

  scheduleLoopCycle(cycleStart, earliestTime) {
    const project = this.project;
    const range = getPlaybackRange(project);
    const spb = secondsPerBeat(project);
    const hardStop = cycleStart + (range.end - range.start) * spb;
    const events = noteEvents(project, range.start, range.end);
    for (const event of events) {
      const when = cycleStart + (event.beat - range.start) * spb;
      if (when < earliestTime - 0.001 || when >= hardStop - 0.002) continue;
      const track = project.tracks.find((item) => item.id === event.trackId);
      this.createRealtimeVoice(track, when, hardStop);
    }
    this.emit();
  }

  scheduleOnce(anchorTime, anchorBeat) {
    const project = this.project;
    const spb = secondsPerBeat(project);
    const endTime = anchorTime + (TOTAL_BEATS - anchorBeat) * spb;
    const events = noteEvents(project, anchorBeat, TOTAL_BEATS);
    for (const event of events) {
      const when = anchorTime + (event.beat - anchorBeat) * spb;
      if (when < anchorTime - 0.001 || when >= endTime - 0.002) continue;
      const track = project.tracks.find((item) => item.id === event.trackId);
      this.createRealtimeVoice(track, when, endTime);
    }
    this.emit();
  }

  createRealtimeVoice(track, when, hardStop) {
    if (!track || track.muted || !this.buffers.has(track.id)) return null;
    for (const voice of this.voices) {
      if (
        voice.trackId === track.id &&
        voice.startTime < when - 0.0005 &&
        voice.endTime > when
      ) {
        cutVoice(this.context, voice, when);
      }
    }
    const voice = createVoice(
      this.context,
      this.master.input,
      track,
      this.buffers.get(track.id),
      when,
      hardStop,
    );
    if (voice) {
      voice.trackId = track.id;
      this.registerVoice(voice);
    }
    return voice;
  }

  async previewTrack(trackId) {
    await this.init();
    const track = this.project?.tracks.find((item) => item.id === trackId);
    if (!track || track.muted) return;
    const now = this.context.currentTime + 0.004;
    const futureStarts = [];
    for (const voice of this.voices) {
      if (voice.trackId !== trackId) continue;
      if (voice.startTime < now && voice.endTime > now) {
        cutVoice(this.context, voice, now);
      } else if (voice.startTime > now) {
        futureStarts.push(voice.startTime);
      }
    }
    const nextSequenceNote = futureStarts.length ? Math.min(...futureStarts) : Infinity;
    const voice = createVoice(
      this.context,
      this.master.input,
      track,
      this.buffers.get(trackId),
      now,
      nextSequenceNote,
    );
    if (voice) {
      voice.trackId = trackId;
      this.registerVoice(voice);
      this.onPreview({ trackId, pitch: track.pitch, when: now });
      this.lastStatus = `触发 ${track.name} · ${track.pitch >= 0 ? "+" : ""}${track.pitch} st`;
      this.emit();
    }
  }

  currentPosition(now = this.context?.currentTime ?? 0) {
    if (!this.playing || !this.project) return this.positionBeat;
    const elapsed = Math.max(0, now - this.anchorTime);
    const beat = this.anchorBeat + elapsed / secondsPerBeat(this.project);
    if (this.project.loop) {
      const range = getPlaybackRange(this.project);
      return wrapBeat(beat, range.start, range.end);
    }
    return Math.min(TOTAL_BEATS, beat);
  }

  finishPlayback() {
    if (!this.playing) return;
    this.playing = false;
    this.positionBeat = TOTAL_BEATS;
    this.clearTimers();
    this.stopAllVoices();
    this.cancelFrame();
    this.lastStatus = "播放完成 · 声部已释放";
    this.emit();
  }

  registerVoice(voice) {
    voice.voiceId = ++this.voiceSequence;
    this.voices.push(voice);
    voice.source.addEventListener(
      "ended",
      () => {
        releaseVoice(voice);
        this.voices = this.voices.filter((item) => item !== voice);
        this.emit();
      },
      { once: true },
    );
  }

  stopAllVoices() {
    for (const voice of this.voices) {
      try {
        voice.source.stop(this.context.currentTime);
      } catch {
        void 0;
      }
      releaseVoice(voice);
    }
    this.voices = [];
  }

  clearTimers() {
    if (this.cycleTimer) clearInterval(this.cycleTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.cycleTimer = null;
    this.endTimer = null;
  }

  startFrame() {
    this.cancelFrame();
    const frame = () => {
      if (!this.playing) return;
      this.emit();
      this.frameHandle = requestAnimationFrame(frame);
    };
    this.frameHandle = requestAnimationFrame(frame);
  }

  cancelFrame() {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  getLevel() {
    const analyser = this.master?.analyser;
    if (!analyser) return 0;
    if (!this.meterData || this.meterData.length !== analyser.fftSize) {
      this.meterData = new Uint8Array(analyser.fftSize);
    }
    analyser.getByteTimeDomainData(this.meterData);
    let sum = 0;
    for (const value of this.meterData) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    return Math.min(1, Math.sqrt(sum / this.meterData.length) * 3.2);
  }

  getState() {
    const positionBeat = this.playing
      ? this.currentPosition()
      : this.positionBeat;
    return {
      audioReady: Boolean(this.context),
      playing: this.playing,
      positionBeat,
      currentStep: Math.floor(positionBeat * 4) % 32,
      activeVoices: this.voices.length,
      maxVoices: this.voiceSequence,
      status: this.lastStatus,
      sampleRate: this.context?.sampleRate ?? 0,
      noteCount: this.project ? countNotes(this.project) : 0,
    };
  }

  emit() {
    this.onState(this.getState());
  }

  async renderProject(project, options = {}) {
    const normalized = sanitizeProject(project);
    const OfflineContext =
      globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
    if (!OfflineContext) throw new Error("当前浏览器不支持 OfflineAudioContext");
    const sourceKit = this.pcmKit ?? createDrumKit(options.sampleRate ?? 48_000);
    const sampleRate = sourceKit.sampleRate;
    const range = options.range ?? getPlaybackRange(normalized);
    const spb = secondsPerBeat(normalized);
    const duration = Math.max(0.02, (range.end - range.start) * spb);
    const frames = Math.max(1, Math.ceil(duration * sampleRate));
    const offline = new OfflineContext(2, frames, sampleRate);
    const master = createMasterChain(offline, normalized.masterGain);
    master.compressor.connect(offline.destination);
    const buffers = new Map(
      sourceKit.slices.map((slice) => [slice.id, copySlice(offline, slice)]),
    );
    const scheduled = [];
    const events = noteEvents(normalized, range.start, range.end);
    const hardStop = frames / sampleRate;

    for (const event of events) {
      const track = normalized.tracks.find((item) => item.id === event.trackId);
      if (!track || track.muted) continue;
      const when = (event.beat - range.start) * spb;
      if (when >= hardStop - 0.002) continue;
      for (const previous of scheduled) {
        if (
          previous.trackId === track.id &&
          previous.startTime < when - 0.0005 &&
          previous.endTime > when
        ) {
          cutVoice(offline, previous, when);
        }
      }
      const voice = createVoice(
        offline,
        master.input,
        track,
        buffers.get(track.id),
        when,
        hardStop,
      );
      if (voice) {
        voice.trackId = track.id;
        scheduled.push(voice);
      }
    }

    const rendered = await offline.startRendering();
    for (const voice of scheduled) releaseVoice(voice);
    try {
      master.compressor.disconnect();
      master.input.disconnect();
    } catch {
      void 0;
    }
    return rendered;
  }

  async exportWav(project) {
    const buffer = await this.renderProject(project);
    return {
      blob: encodeWav(buffer),
      buffer,
      duration: buffer.duration,
      fingerprint: audioBufferFingerprint(buffer),
    };
  }

  dispose() {
    this.clearTimers();
    this.stopAllVoices();
    this.cancelFrame();
    if (this.context) this.context.close();
    this.context = null;
  }
}

function isInside(value, start, end) {
  return value >= start - 1e-9 && value < end - 1e-9;
}
