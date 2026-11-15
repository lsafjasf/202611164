import test from "node:test";
import assert from "node:assert/strict";
import { applyPeakGuard, durationOfBuffer, encodeWav, peakOfBuffer } from "../src/wav.js";

function fakeBuffer(channelData, sampleRate) {
  return {
    numberOfChannels: channelData.length,
    length: channelData[0].length,
    sampleRate,
    getChannelData: (channel) => channelData[channel]
  };
}

test("peak guard prevents clipping without changing duration", () => {
  const buffer = fakeBuffer(
    [new Float32Array(100).fill(1.4), new Float32Array(100).fill(-1.2)],
    10
  );
  const before = peakOfBuffer(buffer);
  const report = applyPeakGuard(buffer, 0.98);
  assert.ok(Math.abs(before - 1.4) < 1e-7);
  assert.ok(Math.abs(report.peakAfter - 0.98) < 1e-7);
  assert.ok(peakOfBuffer(buffer) <= 0.980001);
  assert.equal(buffer.length, 100);
  assert.equal(durationOfBuffer(buffer), 10);
});

test("WAV encoder writes exact PCM duration and RIFF sizes", () => {
  const buffer = fakeBuffer(
    [new Float32Array(441).fill(0.25), new Float32Array(441).fill(-0.25)],
    44100
  );
  const bytes = encodeWav(buffer);
  const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), "WAVE");
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(40, true), 441 * 2 * 2);
  assert.equal(bytes.length, 44 + 441 * 4);
});
