import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];

function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!condition) process.exitCode = 1;
}

const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
  { cwd: process.cwd(), stdio: "ignore" }
);

try {
  await waitForServer();
  await runBrowserTests();
} finally {
  server.kill("SIGTERM");
}

const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
if (process.exitCode) process.exit(process.exitCode);

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(BASE);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Vite server did not start");
}

async function runBrowserTests() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const initial = await page.evaluate(() => window.__PULSE__.getSnapshot());
  check("initial chart note count", initial.noteCount === 126, String(initial.noteCount));
  check("initial export duration", initial.duration === 60, `${initial.duration}s`);
  check("initial chart signature", initial.beatSignature === "568977DF", initial.beatSignature);

  await page.click("#calibrateButton");
  await page.waitForTimeout(250);
  const calibrationActive = await page.evaluate(
    () => window.__PULSE__.session.audio.calibrationSources.size
  );
  check("calibration schedules click voices", calibrationActive > 0, String(calibrationActive));
  await page.click("#closeCalibration");
  await page.waitForTimeout(120);
  const calibrationStopped = await page.evaluate(
    () => window.__PULSE__.session.audio.calibrationSources.size
  );
  check("calibration close releases all nodes", calibrationStopped === 0, String(calibrationStopped));

  await page.click("#startButton");
  await page.waitForTimeout(900);
  const playing = await page.evaluate(() => ({
    state: window.__PULSE__.session.state,
    voices: window.__PULSE__.session.audio.activeVoiceCount,
    beat: window.__PULSE__.session.currentBeat(),
    overlay: document.querySelector("#startOverlay").hidden
  }));
  check("transport starts", playing.state === "playing" && playing.beat > 0, playing.beat.toFixed(3));
  check("scheduled drum voices are active", playing.voices > 0, String(playing.voices));
  check("start overlay dismisses", playing.overlay);

  const pauseCycle = await rapidPauseResume(page);
  check("paused transport stays frozen", pauseCycle.frozen, pauseCycle.pauseBeats.join(", "));
  check("pause/resume adds no beat jump", pauseCycle.maxResumeJump < 0.2, pauseCycle.maxResumeJump.toFixed(4));
  check("pause releases every source", pauseCycle.voicesAfterPause === 0, String(pauseCycle.voicesAfterPause));
  check("pause freezes AudioContext", pauseCycle.contextState === "suspended", pauseCycle.contextState);

  await page.evaluate(() => {
    window.__PULSE__.setTranspose(7);
    window.__PULSE__.setSpeed(1.4);
    window.__PULSE__.setLoop(true);
  });
  const transformed = await page.evaluate(() => {
    const snapshot = window.__PULSE__.getSnapshot();
    const session = window.__PULSE__.session;
    session.anchor.beatStart = 119.75;
    session.anchor.ctxTime = session.audio.ctx.currentTime;
    return {
      transpose: snapshot.project.transpose,
      speed: snapshot.project.speed,
      noteCount: snapshot.noteCount,
      duration: snapshot.duration,
      startBeat: session.currentBeat()
    };
  });
  await page.waitForTimeout(750);
  const looped = await page.evaluate(() => {
    const session = window.__PULSE__.session;
    return {
      rawBeat: session.currentBeat(),
      localBeat: session.currentPosition().localBeat,
      voices: session.audio.activeVoiceCount,
      state: session.state,
      noteCount: session.chart.notes.length
    };
  });
  const loopAdvance = looped.rawBeat - transformed.startBeat;
  check("transpose updates without chart change", transformed.transpose === 7 && transformed.noteCount === 126);
  check("speed update keeps export duration", transformed.speed === 1.4 && transformed.duration === 60);
  check(
    "loop crosses beat zero without timing jump",
    looped.state === "playing"
      && loopAdvance > 1.15
      && loopAdvance < 1.85
      && looped.localBeat > 1.1
      && looped.localBeat < 1.9,
    `advance=${loopAdvance.toFixed(3)}, local=${looped.localBeat.toFixed(3)}`
  );
  check("loop transition schedules audio voices", looped.voices > 0, String(looped.voices));

  await page.evaluate(() => window.__PULSE__.pauseGame());
  await page.waitForTimeout(100);
  const voicesAfterLoopPause = await page.evaluate(
    () => window.__PULSE__.session.audio.activeVoiceCount
  );
  check("loop pause leaves no residual voices", voicesAfterLoopPause === 0, String(voicesAfterLoopPause));

  await saveAndReload(page);
  await inspectResult(page);

  const render = await page.evaluate(() => window.__PULSE__.renderStats());
  check("offline render duration is stable", render.duration === 60, `${render.duration}s`);
  check("offline render contains audible signal", render.peak > 0.05, `peak=${render.peak.toFixed(4)}`);
  check("export frame count matches 48 kHz clock", render.frames === 2880000, String(render.frames));
  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

  await page.screenshot({ path: "artifacts/verified.png", fullPage: true });
  await browser.close();
}

async function rapidPauseResume(page) {
  const pauseBeats = [];
  let frozen = true;
  let maxResumeJump = 0;
  let voicesAfterPause = -1;
  let contextState = "";

  for (let index = 0; index < 3; index += 1) {
    await page.waitForTimeout(260);
    await page.evaluate(() => window.__PULSE__.pauseGame());
    await page.waitForTimeout(120);
    const first = await page.evaluate(() => ({
      beat: window.__PULSE__.session.currentBeat(),
      voices: window.__PULSE__.session.audio.activeVoiceCount,
      context: window.__PULSE__.session.audio.ctx.state
    }));
    await page.waitForTimeout(170);
    const second = await page.evaluate(() => window.__PULSE__.session.currentBeat());
    pauseBeats.push(first.beat.toFixed(3));
    frozen = frozen && Math.abs(second - first.beat) < 1e-9;
    voicesAfterPause = first.voices;
    contextState = first.context;

    await page.evaluate(() => window.__PULSE__.resumeGame());
    await page.waitForTimeout(70);
    const resumed = await page.evaluate(() => window.__PULSE__.session.currentBeat());
    maxResumeJump = Math.max(maxResumeJump, Math.abs(resumed - second));
  }

  return { pauseBeats, frozen, maxResumeJump, voicesAfterPause, contextState };
}

async function saveAndReload(page) {
  await page.evaluate(() => {
    const gains = { kick: 0.55, snare: 0.8, hat: 0.2, stab: 0.95 };
    for (const [laneId, gain] of Object.entries(gains)) {
      const input = document.querySelector(`[data-gain="${laneId}"]`);
      input.value = String(gain);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    document.querySelector('[data-pitch-step="1"][data-pitch-lane="kick"]').click();
    document.querySelector('[data-pitch-step="1"][data-pitch-lane="kick"]').click();
    document.querySelector('[data-pitch-step="-1"][data-pitch-lane="hat"]').click();
    const transpose = document.querySelector("#transposeRange");
    transpose.value = "5";
    transpose.dispatchEvent(new Event("input", { bubbles: true }));
    const speed = document.querySelector("#speedRange");
    speed.value = "1.3";
    speed.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const saved = await page.evaluate(() => window.__PULSE__.save());
  check("save records all track gains", saved.lanes.length === 4
    && saved.lanes.every((lane) => typeof lane.gain === "number"), JSON.stringify(saved.lanes));
  check("save records note count and duration", saved.noteCount === 126 && saved.duration === 60);

  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const restored = await page.evaluate(() => ({
    snapshot: window.__PULSE__.getSnapshot(),
    beat: window.__PULSE__.session.currentBeat(),
    state: window.__PULSE__.session.state,
    startVisible: !document.querySelector("#startOverlay").hidden
  }));
  const gains = Object.fromEntries(restored.snapshot.project.lanes.map((lane) => [lane.id, lane.gain]));
  const pitches = Object.fromEntries(restored.snapshot.project.lanes.map((lane) => [lane.id, lane.pitch]));
  check(
    "reload restores per-track gain",
    gains.kick === 0.55 && gains.snare === 0.8 && gains.hat === 0.2 && gains.stab === 0.95,
    JSON.stringify(gains)
  );
  check(
    "reload restores per-track pitch",
    pitches.kick === 2 && pitches.hat === -1,
    JSON.stringify(pitches)
  );
  check(
    "reload restores global parameters",
    restored.snapshot.project.transpose === 5
      && restored.snapshot.project.speed === 1.3
      && restored.snapshot.project.loop === true,
    JSON.stringify({
      transpose: restored.snapshot.project.transpose,
      speed: restored.snapshot.project.speed,
      loop: restored.snapshot.project.loop
    })
  );
  check("reload resets transport to beginning", restored.beat === 0 && restored.state === "idle" && restored.startVisible);
  check(
    "reload keeps chart identity",
    restored.snapshot.noteCount === 126 && restored.snapshot.beatSignature === "568977DF"
      && restored.snapshot.duration === 60
  );

  const audit = await page.evaluate(async () => {
    await window.__PULSE__.runReloadAudit();
    return window.__PULSE__.getLastAudit();
  });
  check("reload audit note count match", audit.matches.notes, `${audit.first.noteCount} = ${audit.second.noteCount}`);
  check("reload audit beat signature match", audit.matches.beats, `${audit.first.beatSignature} = ${audit.second.beatSignature}`);
  check(
    "reload audit export duration match",
    audit.matches.duration && audit.first.duration === 60 && audit.second.duration === 60,
    `${audit.first.duration.toFixed(6)}s = ${audit.second.duration.toFixed(6)}s`
  );
}

async function inspectResult(page) {
  await page.click("#startButton");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const session = window.__PULSE__.session;
    session.project.loop = false;
    session.anchor.beatStart = 119.7;
    session.anchor.ctxTime = session.audio.ctx.currentTime;
  });
  await page.waitForTimeout(1200);
  const result = await page.evaluate(() => {
    const session = window.__PULSE__.session;
    return {
      state: session.state,
      counts: session.counts,
      total: Object.values(session.counts).reduce((sum, count) => sum + count, 0),
      voices: session.audio.activeVoiceCount,
      context: session.audio.ctx.state,
      visible: !document.querySelector("#resultOverlay").hidden,
      statText: document.querySelector("#resultStats").innerText,
      grade: document.querySelector("#resultGrade").textContent
    };
  });
  check(
    "result lists every grade",
    ["PERFECT", "GREAT", "GOOD", "MISS"].every((label) => result.statText.includes(label)),
    result.statText.replaceAll("\n", " ")
  );
  check("result totals one full chart", result.total === 126, `${result.total} / 126`);
  check("result releases all audio nodes", result.voices === 0 && result.context === "suspended",
    `voices=${result.voices}, ctx=${result.context}`);
  check("result overlay is visible", result.visible && result.state === "result", result.grade);
}
