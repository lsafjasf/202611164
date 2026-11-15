import { AudioEngine } from "./audio.js";
import { buildChart } from "./chart.js";
import {
  CHART_BEATS,
  CHART_DURATION,
  SAMPLE_RATE,
  SECONDS_PER_BEAT
} from "./config.js";

export async function renderProjectAudio(project, { encode = true } = {}) {
  const chart = buildChart(project.difficulty);
  const frameCount = Math.round(CHART_DURATION * SAMPLE_RATE);
  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error("当前浏览器不支持离线音频渲染");

  const context = new OfflineContext(2, frameCount, SAMPLE_RATE);
  const engine = new AudioEngine({ context });
  engine.initGraph();
  engine.setMix(project.lanes);
  engine.setTranspose(project.transpose);

  for (const note of chart.notes) {
    engine.scheduleLane(note.laneId, note.time, {
      velocity: note.velocity,
      accent: true
    });
  }

  if (project.metronome) {
    for (let beat = 0; beat < CHART_BEATS; beat += 1) {
      engine.scheduleClick(beat * SECONDS_PER_BEAT);
    }
  }

  const buffer = await context.startRendering();
  const wav = encode ? encodeWave(buffer) : null;
  return {
    buffer,
    blob: wav ? new Blob([wav], { type: "audio/wav" }) : null,
    duration: buffer.duration,
    frames: buffer.length,
    sampleRate: buffer.sampleRate,
    noteCount: chart.notes.length
  };
}

export function encodeWave(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, data[channel][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return arrayBuffer;
}

export function downloadExport(rendered, filename = "pulse-grid-mix.wav") {
  const url = URL.createObjectURL(rendered.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
