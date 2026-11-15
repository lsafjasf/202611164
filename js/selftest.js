// 自检：全部基于纯逻辑 + 模拟时钟，结果确定性，可在浏览器面板与 Node 测试中复用。
import {
  Transport, buildEvents, defaultProject, durationSec, exportDurationSec,
  virtualToBeat, serializeProject, deserializeProject, compareProjects, projectStats,
} from './core.js';

class MockClock {
  constructor() { this.t = 1000; }
  now() { return this.t; }
  advance(sec) { this.t += sec; }
}

function caseResult(name, pass, detail) {
  return { name, pass, detail };
}

export function runSelfCheck(project = defaultProject()) {
  const results = [];

  // 1. 声学模型：掩蔽与高速漏音确实发生且数量合理
  const ev = buildEvents(project);
  const masked = ev.all.filter((e) => e.status === 'masked').length;
  const leaked = ev.all.filter((e) => e.status === 'leak').length;
  results.push(caseResult(
    '密集齿片掩蔽被标记',
    masked >= 2,
    `掩蔽事件 ${masked} 个（速度 ${project.speed.toFixed(2)}×，总事件 ${ev.all.length}）`,
  ));
  const fast = structuredCloneLike(project);
  fast.speed = 3;
  const evFast = buildEvents(fast);
  const leakedFast = evFast.all.filter((e) => e.status === 'leak').length;
  results.push(caseResult(
    '高速下出现漏音跳过',
    leakedFast >= 1,
    `3× 速度漏音 ${leakedFast} 个（1× 时 ${leaked} 个）`,
  ));

  // 2. 暂停/恢复不累积节拍误差：模拟快速暂停恢复 5 次
  const clock = new MockClock();
  const dur = durationSec(project);
  const tr = new Transport(() => clock.now(), dur);
  tr.start();
  const marks = [];
  for (let i = 0; i < 5; i += 1) {
    clock.advance(0.3);
    tr.pause();
    const frozen = tr.virtualTime;
    clock.advance(2.7); // 暂停期间时钟照走，虚拟时间不得变化
    if (Math.abs(tr.virtualTime - frozen) > 1e-12) break;
    tr.start();
    clock.advance(0.2);
    marks.push(tr.virtualTime);
  }
  const expectedActive = 5 * 0.5;
  const pauseDrift = Math.abs(tr.virtualTime - expectedActive);
  results.push(caseResult(
    '快速暂停恢复零累积误差',
    pauseDrift < 1e-9 && marks.length === 5,
    `累计播放 ${tr.virtualTime.toFixed(6)}s，理论 ${expectedActive.toFixed(6)}s，偏差 ${pauseDrift.toExponential(2)}`,
  ));

  // 3. 循环回绕不累积偏移：运行超过 2 个完整时长
  const clock2 = new MockClock();
  const tr2 = new Transport(() => clock2.now(), dur);
  tr2.start();
  let wraps = 0;
  const wrapPositions = [];
  for (let i = 0; i < 1000; i += 1) {
    clock2.advance(0.1);
    if (tr2.wrapIfNeeded()) {
      wraps += 1;
      wrapPositions.push(tr2.virtualTime);
    }
  }
  const wrapClean = wrapPositions.every((p) => p === 0);
  results.push(caseResult(
    '循环回绕无偏移',
    wraps >= 2 && wrapClean,
    `回绕 ${wraps} 次，每次回到 ${wrapPositions[0]?.toFixed(6) ?? 'N/A'}s`,
  ));

  // 4. 变速重锚定：位置连续、无跳变
  const clock3 = new MockClock();
  const tr3 = new Transport(() => clock3.now(), dur);
  tr3.start();
  clock3.advance(1.0);
  const before = tr3.virtualTime;
  const dur2 = durationSec({ ...project, speed: 2 });
  tr3.reanchor(dur2);
  const after = tr3.virtualTime;
  clock3.advance(1.0);
  const advanced = tr3.virtualTime - after;
  results.push(caseResult(
    '变速重锚定不跳变',
    Math.abs(before - after) < 1e-12 && Math.abs(advanced - 1.0) < 1e-12,
    `变速点 ${before.toFixed(4)}→${after.toFixed(4)}s，随后推进 ${advanced.toFixed(4)}s`,
  ));

  // 5. 变调只改频率不改时间
  const shifted = structuredCloneLike(project);
  shifted.tracks[0].detune = 100;
  const evA = buildEvents(project);
  const evB = buildEvents(shifted);
  const sameTimes = evA.all.every((e, i) => e.time === evB.all[i].time && e.beat === evB.all[i].beat);
  const freqChanged = evB.all[0].freq !== evA.all[0].freq ||
    evB.all.some((e) => e.trackId === 't1' && Math.abs(e.freq - evA.all.find((x) => x.noteId === e.noteId).freq) > 1);
  results.push(caseResult(
    '变调不改节拍时间',
    sameTimes && freqChanged,
    `时间轴一致=${sameTimes}，频率变化=${freqChanged}`,
  ));

  // 6. 保存 → 重载：音符数量、节拍位置、导出时长完全一致
  const roundTrip = deserializeProject(serializeProject(project));
  const cmp = compareProjects(project, roundTrip);
  results.push(caseResult(
    '保存/重载音符与节拍一致',
    cmp.noteCountMatch && cmp.beatsAligned,
    `音符 ${cmp.noteCountBefore}→${cmp.noteCountAfter}，节拍不一致 ${cmp.beatMismatch.length} 处`,
  ));
  results.push(caseResult(
    '重载前后导出时长一致',
    cmp.exportDurationMatch,
    `${cmp.exportDurationBefore.toFixed(4)}s → ${cmp.exportDurationAfter.toFixed(4)}s`,
  ));

  // 7. 首轮 vs 重载后的首轮节拍位置（离线时间轴）
  const timelineBefore = evA.all.map((e) => ({ beat: e.beat, time: +e.time.toFixed(6), id: e.noteId }));
  const timelineAfter = buildEvents(roundTrip).all.map((e) => ({ beat: e.beat, time: +e.time.toFixed(6), id: e.noteId }));
  const timelineMatch = JSON.stringify(timelineBefore) === JSON.stringify(timelineAfter);
  results.push(caseResult(
    '首轮与重载节拍位置逐项相同',
    timelineMatch,
    `抽样首拍 ${timelineBefore[0].beat}@${timelineBefore[0].time}s，末拍 ${timelineBefore.at(-1).beat}@${timelineBefore.at(-1).time}s`,
  ));

  // 8. 虚拟时间 → 节拍换算与 BPM/速度一致
  const beatAt = virtualToBeat(dur, project.bpm, project.speed);
  results.push(caseResult(
    '时间/节拍换算闭环',
    Math.abs(beatAt - project.totalBeats) < 1e-9,
    `${dur.toFixed(3)}s 对应 ${beatAt.toFixed(3)} 拍（工程 ${project.totalBeats} 拍）`,
  ));

  return {
    results,
    pass: results.every((r) => r.pass),
    stats: projectStats(project),
    counts: { total: ev.all.length, ok: ev.all.filter((e) => e.status === 'ok').length, masked, leaked, fastLeak: leakedFast },
    exportDuration: exportDurationSec(project),
  };
}

function structuredCloneLike(obj) {
  return JSON.parse(JSON.stringify(obj));
}
