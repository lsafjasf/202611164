import { collectNotes } from "./notes.js";
import { trackAudibility, trackEnvelopeAt } from "./project.js";
import { TransportClock } from "./transport.js";
import { applyPeakGuard, durationOfBuffer, peakOfBuffer } from "./wav.js";

const LOOKAHEAD_SECONDS = 0.14;
const SCHEDULER_INTERVAL_MS = 25;

function midiRatio(semitones) {
  return 2 ** (semitones / 12);
}

function hash32(value) {
  let hash = value | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export class AudioEngine {
  constructor(project) {
    this.project = project;
    this.context = null;
    this.clock = new TransportClock({ duration: project.length, speed: project.speed });
    this.masterInput = null;
    this.masterGain = null;
    this.compressor = null;
    this.activeNodes = new Set();
    this.noiseBuffers = new Map();
    this.scheduler = null;
    this.endTimer = null;
    this.scheduleCursorContextTime = 0;
    this.listeners = new Set();
    this.sequenceNotes = collectNotes(project, { audibleOnly: true });
    this.sequenceRevision = -1;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, detail = {}) {
    for (const listener of this.listeners) listener({ type, ...detail });
  }

  async ensureContext() {
    if (!this.context) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.clock.setDuration(this.project.length);
      this.emit("context", { state: this.context.state });
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  async play() {
    const context = await this.ensureContext();
    if (this.clock.playing) return this.clock.basePosition;
    this.buildMasterChain();
    const position = this.clock.basePosition >= this.project.length - 1e-4 ? 0 : this.clock.basePosition;
    this.clock.seek(position, context.currentTime);
    this.clock.setSpeed(this.project.speed, context.currentTime);
    this.clock.play(context.currentTime);
    this.scheduleCursorContextTime = context.currentTime;
    this.refreshNotes();
    this.startScheduler();
    this.emit("transport", { state: "playing", position });
    return position;
  }

  pause() {
    if (!this.context) return 0;
    const position = this.clock.pause(this.context.currentTime);
    this.stopScheduler();
    this.stopAllNodes();
    this.releaseMasterChain();
    this.emit("transport", { state: "paused", position });
    return position;
  }

  stop() {
    const previous = this.context ? this.clock.pause(this.context.currentTime) : this.clock.basePosition;
    this.stopScheduler();
    this.stopAllNodes();
    this.releaseMasterChain();
    if (this.context) this.clock.seek(0, this.context.currentTime);
    else this.clock.basePosition = 0;
    this.emit("transport", { state: "stopped", position: 0, previous });
    return 0;
  }

  seek(position) {
    const target = Math.min(this.project.length - 1e-6, Math.max(0, position));
    const wasPlaying = this.clock.playing;
    if (wasPlaying) {
      this.clock.pause(this.context.currentTime);
      this.stopScheduler();
      this.stopAllNodes();
      this.releaseMasterChain();
    }
    this.clock.seek(target, this.context?.currentTime || 0);
    if (wasPlaying) {
      this.buildMasterChain();
      this.clock.play(this.context.currentTime);
      this.scheduleCursorContextTime = this.context.currentTime;
      this.startScheduler();
      this.emit("transport", { state: "playing", position: target });
    } else {
      this.emit("transport", {
        state: this.clock.basePosition === 0 ? "stopped" : "paused",
        position: target
      });
    }
    return target;
  }

  setSpeed(speed) {
    const wasPlaying = this.clock.playing;
    const now = this.context?.currentTime || 0;
    if (wasPlaying) {
      this.clock.pause(now);
      this.stopScheduler();
      this.stopAllNodes();
      this.releaseMasterChain();
    }
    this.clock.setSpeed(speed, now);
    if (wasPlaying) {
      this.buildMasterChain();
      this.clock.play(now);
      this.scheduleCursorContextTime = now;
      this.startScheduler();
    }
    this.emit("speed", { speed });
  }

  setProject(project, { reset = false, reanchor = true } = {}) {
    const now = this.context?.currentTime || 0;
    const position = this.getPosition(now);
    const wasPlaying = this.clock.playing;
    if (wasPlaying && reanchor) {
      this.clock.pause(now);
      this.stopScheduler();
      this.stopAllNodes();
      this.releaseMasterChain();
    }
    this.project = project;
    this.clock.setDuration(project.length);
    this.clock.setSpeed(project.speed, now);
    if (reset) this.clock.seek(0, now);
    else this.clock.seek(Math.min(position, project.length - 1e-6), now);
    if (wasPlaying && reanchor) {
      this.buildMasterChain();
      this.clock.play(now);
      this.scheduleCursorContextTime = now;
      this.startScheduler();
    }
  }

  getPosition(contextTime = this.context?.currentTime || 0) {
    if (!this.clock.playing && this.clock.basePosition === 0) return 0;
    if (this.project.loop) return this.clock.positionAt(contextTime);
    return Math.min(this.project.length, this.clock.rawPositionAt(contextTime));
  }

  getAudiblePosition() {
    if (!this.context) return this.clock.basePosition;
    const latency = Number(this.context.outputLatency || this.context.baseLatency || 0);
    return this.getPosition(this.context.currentTime - latency);
  }

  get isPlaying() {
    return this.clock.playing;
  }

  get activeSourceCount() {
    return this.activeNodes.size;
  }

  refreshNotes() {
    if (this.sequenceRevision === this.project.revision) return;
    this.sequenceNotes = collectNotes(this.project, { audibleOnly: true });
    this.sequenceRevision = this.project.revision;
  }

  startScheduler() {
    this.stopScheduler();
    this.scheduleAhead();
    this.scheduler = setInterval(() => this.scheduleAhead(), SCHEDULER_INTERVAL_MS);
  }

  stopScheduler() {
    if (this.scheduler) clearInterval(this.scheduler);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.scheduler = null;
    this.endTimer = null;
  }

  scheduleAhead() {
    if (!this.clock.playing || !this.context) return;
    const context = this.context;
    const now = context.currentTime;
    if (!this.project.loop && this.clock.rawPositionAt(now) >= this.project.length - 1e-5) {
      this.finishPlayback();
      return;
    }
    if (this.scheduleCursorContextTime < now - 0.012) {
      this.scheduleCursorContextTime = now;
    }
    const horizon = now + LOOKAHEAD_SECONDS;
    let guard = 0;
    while (this.scheduleCursorContextTime < horizon && guard < 8) {
      guard += 1;
      const fromPhase = this.clock.positionAt(this.scheduleCursorContextTime);
      const remaining = this.project.length - fromPhase;
      const segmentRealDuration = remaining / Math.max(0.1, this.clock.speed);
      const segmentEnd = Math.min(horizon, this.scheduleCursorContextTime + segmentRealDuration);
      const segmentTransportLength = (segmentEnd - this.scheduleCursorContextTime) * this.clock.speed;
      const toPhase = Math.min(this.project.length, fromPhase + segmentTransportLength);
      this.scheduleRange(fromPhase, toPhase, this.scheduleCursorContextTime, now);
      this.scheduleCursorContextTime = segmentEnd;
      if (!this.project.loop && toPhase >= this.project.length - 1e-7) {
        this.scheduleNaturalEnd(segmentEnd + 0.02);
        break;
      }
      if (segmentEnd >= horizon) break;
      if (segmentEnd <= this.scheduleCursorContextTime + 1e-9) {
        this.scheduleCursorContextTime += 1e-4;
      }
    }
  }

  scheduleRange(fromPhase, toPhase, contextStart, now) {
    this.refreshNotes();
    for (const note of this.sequenceNotes) {
      if (note.time < fromPhase - 1e-7 || note.time >= toPhase - 1e-7) continue;
      const when = contextStart + (note.time - fromPhase) / Math.max(0.1, this.clock.speed);
      if (when < now - 0.008) continue;
      const track = this.project.tracks.find((candidate) => candidate.id === note.trackId);
      if (!track) continue;
      this.scheduleNote(this.context, this.masterInput, note, track, Math.max(now + 0.001, when));
    }
  }

  scheduleNaturalEnd(when) {
    if (this.endTimer) return;
    const delay = Math.max(0, (when - this.context.currentTime) * 1000);
    this.endTimer = setTimeout(() => this.finishPlayback(), delay);
  }

  finishPlayback() {
    if (!this.context) return;
    this.clock.pause(this.context.currentTime);
    this.stopScheduler();
    this.stopAllNodes();
    this.releaseMasterChain();
    this.clock.seek(0, this.context.currentTime);
    this.emit("transport", { state: "ended", position: 0 });
  }

  buildMasterChain() {
    if (this.masterInput) return;
    const context = this.context;
    this.masterInput = context.createGain();
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 16;
    this.compressor.ratio.value = 4.5;
    this.compressor.attack.value = 0.008;
    this.compressor.release.value = 0.22;
    this.masterGain = context.createGain();
    this.masterGain.gain.value = this.project.masterGain;
    this.masterInput.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(context.destination);
  }

  releaseMasterChain() {
    for (const node of [this.masterInput, this.compressor, this.masterGain]) {
      try {
        node?.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.masterInput = null;
    this.compressor = null;
    this.masterGain = null;
  }

  stopAllNodes() {
    for (const entry of [...this.activeNodes]) {
      for (const source of entry.sources) {
        try {
          source.stop();
        } catch {
          // A source can only be stopped once.
        }
      }
      for (const node of entry.nodes) {
        try {
          node.disconnect();
        } catch {
          // Already disconnected.
        }
      }
    }
    this.activeNodes.clear();
    this.emit("activity", { count: 0 });
  }

  registerNodes(context, sources, nodes) {
    if (context !== this.context) return;
    const entry = { sources, nodes, pending: sources.length };
    this.activeNodes.add(entry);
    this.emit("activity", { count: this.activeNodes.size });
    for (const source of sources) {
      source.addEventListener("ended", () => {
        entry.pending -= 1;
        if (entry.pending > 0) return;
        if (!this.activeNodes.delete(entry)) return;
        for (const node of nodes) {
          try {
            node.disconnect();
          } catch {
            // Already disconnected.
          }
        }
        this.emit("activity", { count: this.activeNodes.size });
      }, { once: true });
    }
  }

  noiseBuffer(context, type) {
    const key = `${context.sampleRate}:${type}`;
    if (this.noiseBuffers.has(key)) return this.noiseBuffers.get(key);
    const length = Math.floor(context.sampleRate * 2.4);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    const salt = [...type].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    let state = (0x9e3779b9 ^ salt) >>> 0;
    let brown = 0;
    for (let index = 0; index < length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const white = (state / 4294967296) * 2 - 1;
      brown = (brown + white * 0.035) * 0.996;
      if (type === "wind") data[index] = Math.max(-1, Math.min(1, brown * 3.4 + white * 0.08));
      else if (type === "rain") data[index] = white * 0.68 + (index ? data[index - 1] * 0.24 : 0);
      else data[index] = white;
    }
    this.noiseBuffers.set(key, buffer);
    return buffer;
  }

  scheduleNote(context, destination, note, track, when) {
    const level = Math.max(
      0,
      Math.min(1.4, note.velocity * trackAudibility(this.project, track) * trackEnvelopeAt(track, note.time))
    );
    if (level <= 1e-5) return;
    const mixLevel = Math.min(1.25, level * 3.8);
    if (note.type === "rain") this.scheduleRain(context, destination, note, track, when, mixLevel);
    else if (note.type === "wind") this.scheduleWind(context, destination, note, track, when, mixLevel);
    else if (note.type === "machine") this.scheduleMachine(context, destination, note, track, when, mixLevel);
    else this.scheduleFootsteps(context, destination, note, track, when, mixLevel);
  }

  outputFor(context, destination, track) {
    const panner = context.createStereoPanner();
    panner.pan.value = track.pan;
    const gain = context.createGain();
    panner.connect(gain);
    gain.connect(destination);
    return { panner, gain };
  }

  scheduleRain(context, destination, note, track, when, level) {
    const duration = Math.max(0.08, Math.min(note.duration, 0.3));
    const end = when + duration;
    const output = this.outputFor(context, destination, track);
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context, "rain");
    source.loop = true;
    const offset = (hash32(note.step + track.pattern * 19) / 4294967296) * 2;
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 900 * midiRatio((note.pitch + track.pitch) / 2);
    highpass.Q.value = 0.7;
    const bandpass = context.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 1700 * midiRatio((note.pitch + track.pitch) / 3);
    bandpass.Q.value = 0.55;
    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(output.panner);
    output.gain.gain.setValueAtTime(0.0001, when);
    output.gain.gain.exponentialRampToValueAtTime(Math.max(0.002, level * 0.26), when + 0.007);
    output.gain.gain.exponentialRampToValueAtTime(0.0001, end);
    source.start(when, offset, duration);
    const nodes = [source, highpass, bandpass, output.panner, output.gain];
    this.registerNodes(context, [source], nodes);
  }

  scheduleWind(context, destination, note, track, when, level) {
    const duration = Math.max(0.6, note.duration);
    const end = when + duration;
    const output = this.outputFor(context, destination, track);
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context, "wind");
    source.loop = true;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 290 * midiRatio((note.pitch + track.pitch) / 2.5);
    lowpass.Q.value = 1.4;
    const presence = context.createBiquadFilter();
    presence.type = "bandpass";
    presence.frequency.value = 760 * midiRatio((note.pitch + track.pitch) / 4);
    presence.Q.value = 0.45;
    source.connect(lowpass);
    lowpass.connect(presence);
    presence.connect(output.panner);
    const attack = Math.min(0.65, duration * 0.28);
    const release = Math.min(1.1, duration * 0.34);
    output.gain.gain.setValueAtTime(0.0001, when);
    output.gain.gain.exponentialRampToValueAtTime(Math.max(0.002, level * 0.14), when + attack);
    output.gain.gain.setValueAtTime(Math.max(0.002, level * 0.14), end - release);
    output.gain.gain.exponentialRampToValueAtTime(0.0001, end);
    source.start(when, (hash32(note.step + 71) % 2400) / 1000, duration);
    const nodes = [source, lowpass, presence, output.panner, output.gain];
    this.registerNodes(context, [source], nodes);
  }

  scheduleMachine(context, destination, note, track, when, level) {
    const duration = Math.max(0.09, Math.min(note.duration, 0.36));
    const end = when + duration;
    const frequency = 108 * midiRatio((note.pitch + track.pitch) / 2);
    const output = this.outputFor(context, destination, track);
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = Math.min(4600, frequency * 7 + 520);
    lowpass.Q.value = 2.2;
    const saw = context.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.setValueAtTime(frequency * 1.06, when);
    saw.frequency.exponentialRampToValueAtTime(Math.max(8, frequency), when + 0.045);
    const sub = context.createOscillator();
    sub.type = "square";
    sub.frequency.value = Math.max(8, frequency * 0.53);
    saw.connect(lowpass);
    sub.connect(lowpass);
    lowpass.connect(output.panner);
    output.gain.gain.setValueAtTime(0.0001, when);
    output.gain.gain.exponentialRampToValueAtTime(Math.max(0.003, level * 0.31), when + 0.006);
    output.gain.gain.exponentialRampToValueAtTime(0.0001, end);
    saw.start(when);
    sub.start(when);
    saw.stop(end + 0.01);
    sub.stop(end + 0.01);
    const sources = [saw, sub];
    this.registerNodes(context, sources, [...sources, lowpass, output.panner, output.gain]);
  }

  scheduleFootsteps(context, destination, note, track, when, level) {
    const duration = Math.max(0.1, Math.min(note.duration, 0.46));
    const end = when + duration;
    const frequency = 62 * midiRatio((note.pitch + track.pitch) / 2);
    const output = this.outputFor(context, destination, track);
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context, "footsteps");
    source.loop = true;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 1700 + frequency * 9;
    lowpass.Q.value = 0.85;
    const thump = context.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(frequency * 1.4, when);
    thump.frequency.exponentialRampToValueAtTime(Math.max(8, frequency), when + 0.11);
    source.connect(lowpass);
    lowpass.connect(output.panner);
    thump.connect(output.panner);
    output.gain.gain.setValueAtTime(0.0001, when);
    output.gain.gain.exponentialRampToValueAtTime(Math.max(0.003, level * 0.25), when + 0.009);
    output.gain.gain.exponentialRampToValueAtTime(0.0001, end);
    source.start(when, (hash32(note.step + 233) % 1800) / 1000, duration);
    thump.start(when);
    thump.stop(end + 0.01);
    const sources = [source, thump];
    this.registerNodes(context, sources, [source, thump, lowpass, output.panner, output.gain]);
  }

  async renderOffline(project = this.project, sampleRate = 44100) {
    const OfflineContextClass = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!OfflineContextClass) throw new Error("当前浏览器不支持离线音频渲染");
    const frames = Math.round(project.length * sampleRate);
    const context = new OfflineContextClass(2, frames, sampleRate);
    const input = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -19;
    compressor.knee.value = 14;
    compressor.ratio.value = 5.5;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.2;
    const gain = context.createGain();
    gain.gain.value = project.masterGain;
    input.connect(compressor);
    compressor.connect(gain);
    gain.connect(context.destination);

    const notes = collectNotes(project, { audibleOnly: true });
    for (const note of notes) {
      const track = project.tracks.find((candidate) => candidate.id === note.trackId);
      if (track) this.scheduleNote(context, input, note, track, note.time);
    }
    const buffer = await context.startRendering();
    const guard = applyPeakGuard(buffer, 0.98);
    return {
      buffer,
      notes: notes.length,
      duration: durationOfBuffer(buffer),
      frames: buffer.length,
      sampleRate: buffer.sampleRate,
      peakBefore: guard.peakBefore,
      peakAfter: guard.peakAfter || peakOfBuffer(buffer),
      clipSafe: peakOfBuffer(buffer) <= 0.980001,
      normalizedScale: guard.scale
    };
  }

  panic() {
    this.stopScheduler();
    this.stopAllNodes();
    this.releaseMasterChain();
  }

  async dispose() {
    this.panic();
    this.clock.playing = false;
    this.noiseBuffers.clear();
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // The context may already be closing.
      }
    }
  }
}

export { LOOKAHEAD_SECONDS };
