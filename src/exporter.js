// 离线导出：用 OfflineAudioContext 以相同调度逻辑渲染整段旋律并编码 WAV。
// 导出时长由步进网格精确算出，与实时播放、循环次数严格一致。

import { GlassAudioEngine } from './audio.js';
import { patternLength, STEPS_PER_BEAT } from './project.js';
import { encodeWav } from './wav.js';

export function exportDurationSeconds(project, loops = 1) {
  const steps = patternLength(project) * Math.max(1, loops);
  const beatDuration = 60 / project.tempo;
  return (steps / STEPS_PER_BEAT) * beatDuration;
}

export async function renderProject(project, { OfflineCtor = globalThis.OfflineAudioContext,
  sampleRate = 44100, loops = 1 } = {}) {
  const duration = exportDurationSeconds(project, loops);
  const ctx = new OfflineCtor(2, Math.ceil(duration * sampleRate), sampleRate);
  const engine = new GlassAudioEngine(ctx, project);
  const events = planEvents(project, { loops, startAt: 0 });
  for (const event of events) {
    const note = event.note;
    if (engine.isBroken(note.glass)) continue;
    if (note.kind === 'rub') {
      engine.rub(note.glass, { when: event.when, duration: event.stepDuration * 0.9,
        transpose: event.transpose });
    } else {
      engine.strike(note.glass, { when: event.when, velocity: note.velocity,
        transpose: event.transpose });
    }
  }
  const rendered = await ctx.startRendering();
  engine.stopAll(duration); // 离线渲染结束即释放全部注册节点
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, ch) => rendered.getChannelData(ch));
  return {
    wav: encodeWav(channels, sampleRate),
    duration,
    noteCount: events.length,
    beatPositions: events.map((e) => e.beat),
  };
}

// 纯计算：展开循环后的全部音符事件。beat 为每轮内的拍号位置，不随循环漂移。
export function planEvents(project, { loops = 1, startAt = 0 } = {}) {
  const pattern = patternLength(project);
  const stepDuration = 60 / project.tempo / STEPS_PER_BEAT;
  const events = [];
  const totalLoops = project.loop ? Math.max(1, loops) : 1;
  for (let lap = 0; lap < totalLoops; lap += 1) {
    for (const note of project.melody) {
      const globalStep = lap * pattern + note.step;
      events.push({
        note,
        glass: note.glass,
        stepIndex: globalStep,
        patternStep: note.step,
        lap,
        beat: note.step / STEPS_PER_BEAT,
        globalBeat: globalStep / STEPS_PER_BEAT,
        when: startAt + globalStep * stepDuration,
        stepDuration,
        transpose: project.transpose,
      });
    }
  }
  return events;
}
