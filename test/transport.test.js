import test from "node:test";
import assert from "node:assert/strict";
import { signedBeatError, TransportClock } from "../src/transport.js";

test("rapid pause and resume does not accumulate beat error", () => {
  const clock = new TransportClock({ duration: 20, speed: 1 });
  clock.play(10);
  let contextTime = 10;
  const active = 0.037;
  const paused = 0.005;
  for (let index = 0; index < 120; index += 1) {
    contextTime += active;
    clock.pause(contextTime);
    assert.equal(clock.positionAt(contextTime), clock.basePosition);
    contextTime += paused;
    clock.play(contextTime);
  }
  contextTime += active;
  clock.pause(contextTime);
  const expected = 121 * active;
  const error = signedBeatError(clock.basePosition, expected, 120);
  assert.ok(Math.abs(error) < 1e-12, `beat error ${error}`);
});

test("speed changes preserve transport phase exactly", () => {
  const clock = new TransportClock({ duration: 20, speed: 1 });
  clock.play(100);
  assert.ok(Math.abs(clock.positionAt(104) - 4) < 1e-12);
  clock.setSpeed(1.5, 104);
  assert.ok(Math.abs(clock.positionAt(106) - 7) < 1e-12);
  clock.setSpeed(0.5, 106);
  assert.ok(Math.abs(clock.positionAt(108) - 8) < 1e-12);
});

test("loop wrapping is deterministic at the boundary", () => {
  const clock = new TransportClock({ duration: 20, speed: 1 });
  clock.play(5);
  assert.ok(Math.abs(clock.positionAt(24.5) - 19.5) < 1e-9);
  assert.ok(Math.abs(clock.positionAt(25.25) - 0.25) < 1e-9);
});
