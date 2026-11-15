import { renderProjectToWav } from "./audio.js";
import { loopAlignmentAudit, rapidPauseResumeAudit } from "./clock.js";
import {
  buildNotePlan,
  cloneProject,
  deserializeProject,
  normalizeProject,
  serializeProject,
} from "./project.js";

export async function runClosedLoopAudit(project, onProgress = () => {}) {
  const firstPass = normalizeProject(project);
  const json = serializeProject(firstPass);
  const reloaded = deserializeProject(json);
  const bars = firstPass.exportBars;
  const firstPlan = buildNotePlan(firstPass, bars);
  const reloadPlan = buildNotePlan(reloaded, bars);

  onProgress("比较首轮与 JSON 重载的音符及节拍…");
  const beatDelta = maxArrayDelta(
    firstPlan.map((note) => note.beat),
    reloadPlan.map((note) => note.beat),
  );
  const notePass = firstPlan.length === reloadPlan.length;
  const beatPass = notePass && beatDelta < 1e-9;

  const pauseAudit = rapidPauseResumeAudit(firstPass.bpm);
  const loopAudit = loopAlignmentAudit(firstPass, Math.max(2, bars));
  const loopPass = loopAudit.maxOffset < 1e-9;
  const pausePass = pauseAudit.offset < 1e-9;
  const transposedProject = cloneProject(firstPass);
  transposedProject.transpose =
    firstPass.transpose >= 8 ? firstPass.transpose - 5 : firstPass.transpose + 5;
  const expectedPitchShift = transposedProject.transpose - firstPass.transpose;
  const transposedPlan = buildNotePlan(transposedProject, bars);
  const transposeBeatDelta = maxArrayDelta(
    firstPlan.map((note) => note.beat),
    transposedPlan.map((note) => note.beat),
  );
  const transposePitchDelta =
    transposedPlan.length === firstPlan.length &&
    transposedPlan.every(
      (note, index) => note.midi - firstPlan[index].midi === expectedPitchShift,
    );
  const transposePass =
    transposeBeatDelta < 1e-9 && transposePitchDelta && transposedPlan.length === firstPlan.length;

  onProgress("离线渲染首轮 WAV…");
  const firstRender = await renderProjectToWav(firstPass);
  onProgress("重载工程并离线渲染 WAV…");
  const reloadRender = await renderProjectToWav(reloaded);

  const durationDelta = Math.abs(firstRender.duration - reloadRender.duration);
  const durationPass = durationDelta < 1e-9;
  const exportNotesPass = firstRender.noteCount === reloadRender.noteCount;
  const allPass =
    notePass &&
    beatPass &&
    durationPass &&
    exportNotesPass &&
    pausePass &&
    loopPass &&
    transposePass;

  onProgress(
    allPass
      ? "校验完成：音序、暂停恢复与导出均无累计偏移。"
      : "校验发现差异，请查看下方的对比数据。",
  );

  return {
    pass: allPass,
    firstPass: {
      noteCount: firstPlan.length,
      exportNoteCount: firstRender.noteCount,
      beatPositions: firstPlan.map((note) => note.beat),
      duration: firstRender.duration,
      frames: firstRender.frames,
      loopDuration: firstRender.loopDuration,
      tail: firstRender.tail,
    },
    reloaded: {
      noteCount: reloadPlan.length,
      exportNoteCount: reloadRender.noteCount,
      beatPositions: reloadPlan.map((note) => note.beat),
      duration: reloadRender.duration,
      frames: reloadRender.frames,
      loopDuration: reloadRender.loopDuration,
      tail: reloadRender.tail,
    },
    delta: {
      noteCount: reloadPlan.length - firstPlan.length,
      beat: beatDelta,
      duration: durationDelta,
      frames: reloadRender.frames - firstRender.frames,
      pause: pauseAudit.offset,
      loop: loopAudit.maxOffset,
      transpose: transposeBeatDelta,
    },
    checks: {
      notes: notePass,
      beats: beatPass,
      duration: durationPass,
      exportNotes: exportNotesPass,
      pause: pausePass,
      loop: loopPass,
      transpose: transposePass,
    },
    pauseAudit,
    loopAudit,
    jsonBytes: new Blob([json]).size,
  };
}

function maxArrayDelta(left, right) {
  if (left.length !== right.length) {
    return Number.POSITIVE_INFINITY;
  }
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
  }
  return maximum;
}
