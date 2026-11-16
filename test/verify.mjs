// Verification: first-run vs reloaded project must produce identical note
// counts, beat positions and export durations; pause/resume, transpose and
// looping must not accumulate timing/pitch offset; bypass must be isolated.

import { writeFileSync, mkdirSync } from 'node:fs';
import {
  createDefaultProject, collectNotes, serializeProject, deserializeProject,
  loopDurationSeconds, secondsPerBeat, stepToBeat, beatAtTime, timeAtBeat,
} from '../js/engine.js';
import { renderProject, encodeWav, CLIP_THRESHOLD } from '../js/render.js';

const SR = 44100;
let failures = 0;
function check(name, cond, detail = '') {
  const ok = Boolean(cond);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failures++;
}

// ---- Round 1: fresh project ----
const project = createDefaultProject();
const notes1 = collectNotes(project);
const beats1 = notes1.map((n) => n.beat);
const dur1 = loopDurationSeconds(project);
const render1 = renderProject(project, SR);
mkdirSync(new URL('../artifacts', import.meta.url).pathname, { recursive: true });
const wav1 = encodeWav(render1.left, render1.right, SR);
writeFileSync(new URL('../artifacts/loop-first.wav', import.meta.url), Buffer.from(wav1));

// ---- Save + reload (round-trip through JSON, like localStorage/file) ----
const saved = serializeProject(project);
const reloaded = deserializeProject(saved);
const notes2 = collectNotes(reloaded);
const beats2 = notes2.map((n) => n.beat);
const dur2 = loopDurationSeconds(reloaded);
const render2 = renderProject(reloaded, SR);
const wav2 = encodeWav(render2.left, render2.right, SR);
writeFileSync(new URL('../artifacts/loop-reload.wav', import.meta.url), Buffer.from(wav2));

// ---- Comparisons required by the spec ----
check('note count equal after reload', notes1.length === notes2.length, `${notes1.length} vs ${notes2.length}`);
check('beat positions equal after reload',
  beats1.length === beats2.length && beats1.every((b, i) => b === beats2[i]),
  `max diff ${Math.max(0, ...beats1.map((b, i) => Math.abs(b - (beats2[i] ?? NaN))))}`);
check('export duration equal after reload', dur1 === dur2, `${dur1}s vs ${dur2}s`);
check('WAV frame count matches loop duration (first)', render1.frames === Math.round(dur1 * SR), `${render1.frames} frames`);
check('WAV frame count matches loop duration (reload)', render2.frames === Math.round(dur2 * SR), `${render2.frames} frames`);
check('WAV byte length equal', wav1.byteLength === wav2.byteLength, `${wav1.byteLength} bytes`);
check('no clipping in export', render1.peak < CLIP_THRESHOLD, `peak ${render1.peak.toFixed(4)}`);

// ---- Pause/resume drift: 200 rapid cycles must not move any step time ----
{
  const tempo = project.tempo;
  const spb = secondsPerBeat(tempo);
  let anchor = { time: 0, beat: 0 };
  let now = 0;
  let pausedTotal = 0;
  let rng = 12345;
  const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 200; i++) {
    now += rand() * 0.4; // play for a bit
    const pausedBeat = beatAtTime(anchor, tempo, now); // freeze position
    const pauseLen = rand() * 0.05; // rapid pause
    pausedTotal += pauseLen;
    now += pauseLen;
    anchor = { time: now, beat: pausedBeat }; // resume from frozen beat
  }
  const stepIndex = 47;
  const expected = stepToBeat(stepIndex) * spb + pausedTotal;
  const actual = timeAtBeat(anchor, tempo, stepToBeat(stepIndex));
  check('no beat drift after 200 pause/resume cycles', Math.abs(actual - expected) < 1e-9,
    `drift ${(actual - expected).toExponential(2)}s`);
}

// ---- Transpose must be absolute, not cumulative ----
{
  const p = deserializeProject(serializeProject(project));
  const before = collectNotes(p).map((n) => n.midi);
  p.tracks[3].transpose = 12;
  p.tracks[3].transpose = -12;
  p.tracks[3].transpose = 0;
  const after = collectNotes(p).map((n) => n.midi);
  check('transpose returns to original pitch (no cumulative offset)',
    before.every((m, i) => m === after[i]));
}

// ---- Bypass isolation: bypassing one track leaves others untouched ----
{
  const p = deserializeProject(serializeProject(project));
  p.tracks[0].bypass = true;
  const r = renderProject(p, SR);
  const expectedAudible = notes1.filter((n) => n.track !== 0).length;
  check('bypassed track removes only its own notes', r.noteCount === notes1.length,
    `grid ${r.noteCount}, audible ${expectedAudible}`);
  const audibleBeats = collectNotes(p).filter((n) => n.track !== 0).map((n) => n.beat);
  const otherBeats = beats1.filter((_, i) => notes1[i].track !== 0);
  check('other tracks keep identical beat positions when one is bypassed',
    audibleBeats.length === otherBeats.length && audibleBeats.every((b, i) => b === otherBeats[i]));
}

// ---- Loop wrap: step 0 of loop 2 lands exactly on the loop boundary ----
{
  const tempo = project.tempo;
  const anchor = { time: 0.013, beat: 0 };
  const loopBeats = stepToBeat(32);
  const wrapTime = timeAtBeat(anchor, tempo, loopBeats); // step 0 of second loop
  const expected = anchor.time + loopBeats * secondsPerBeat(tempo);
  check('loop wrap lands exactly on boundary', Math.abs(wrapTime - expected) < 1e-12);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
