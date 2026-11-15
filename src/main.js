// 应用编排：音频引擎、调度器、渲染器、输入、工程存取、验证报告。

import {
  defaultProject, patternLength,
} from './project.js';
import { GlassAudioEngine } from './audio.js';
import { GlassSequencer } from './sequencer.js';
import { GlassRenderer } from './renderer.js';
import {
  $, KEYS, buildTrackPanel, updateTrackCards, setBadge,
  showResult, renderVerifyReport, glassIndexFromPoint,
} from './ui.js';
import { bindControls, bootstrapReloadCheck, metricsSnapshot, applyProject } from './controls.js';

class GlassApp {
  constructor() {
    this.project = defaultProject();
    this.ctx = new AudioContext();
    this.pendingAutoPlay = false;
    this.engine = new GlassAudioEngine(this.ctx, this.project);
    this.renderer = new GlassRenderer($('stage'), this.project, this.ctx);
    this.sequencer = new GlassSequencer(this.engine, this.project, {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      now: () => this.ctx.currentTime,
    });
    this.keyDownAt = new Map();
    this.lastRubAt = new Map();
    this._coolTimer = null;
    this._bindSequencer();
  }

  init() {
    buildTrackPanel(this.project, (i, field, value) => this.onTrackChange(i, field, value));
    bindControls(this);
    this.bindCanvasInput();
    this.bindKeyboard();
    this.renderer.start();
    this.startCoolingLoop();
    this.refreshReadout();
    this.maybeShowReloadReport();
    if (this.pendingAutoPlay) this.armAutoplay();
  }

  maybeShowReloadReport() {
    const pending = bootstrapReloadCheck(this);
    if (!pending) return;
    const reloaded = metricsSnapshot(pending.project);
    const sameArray = (a, b) => a.length === b.length &&
      a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    renderVerifyReport({
      rows: [
        { label: '音符数量', first: pending.verify.noteCount, reloaded: reloaded.noteCount,
          match: pending.verify.noteCount === reloaded.noteCount },
        { label: '节拍位置(拍)',
          first: `[${pending.verify.beatPositions.join(', ')}]`,
          reloaded: `[${reloaded.beatPositions.join(', ')}]`,
          match: sameArray(pending.verify.beatPositions, reloaded.beatPositions) },
        { label: '导出时长(秒)',
          first: pending.verify.exportDuration.toFixed(3),
          reloaded: reloaded.exportDuration.toFixed(3),
          match: Math.abs(pending.verify.exportDuration - reloaded.exportDuration) < 1e-9 },
      ],
      note: `页面重新载入：${reloaded.noteCount} 个音符从第 0 拍开始，导出时长 ${reloaded.exportDuration.toFixed(3)}s。`,
    });
    applyProject(this, pending.project);
    // 浏览器自动播放策略：音频上下文可能仍被挂起，等首次用户手势再从头播放。
    this.pendingAutoPlay = true;
  }

  armAutoplay() {
    const start = async () => {
      if (this.ctx.state === 'suspended') {
        try { await this.ctx.resume(); } catch { return; }
      }
      if (this.ctx.state === 'running') {
        this.pendingAutoPlay = false;
        document.removeEventListener('pointerdown', start);
        document.removeEventListener('keydown', start);
        await this.sequencer.play();
      }
    };
    document.addEventListener('pointerdown', start, { once: true });
    document.addEventListener('keydown', start, { once: true });
  }

  _bindSequencer() {
    this.sequencer.onStateChange = (state) => {
      setBadge(state);
      if (state === 'stopped') this.renderer.setStep(-1);
    };
    this.sequencer.onVisual = (event, note) => {
      this.renderer.setStep(event.patternStep);
      if (note) this.renderer.pulse(note.glass, event.when + 1.4);
    };
    this.sequencer.onSuccess = () => {
      showResult(true, `成功：完整演奏 ${this.project.melody.length} 个音符，八只杯子无一破裂。`);
    };
    this.sequencer.onFail = (info) => {
      showResult(false, `失败：${info.reason === 'broken-cup' ? '杯子破裂' : info.reason}，演奏中止。`);
    };
  }

  bindCanvasInput() {
    const canvas = $('stage');
    let hovering = null;
    canvas.addEventListener('mousemove', (e) => {
      const idx = glassIndexFromPoint(canvas, e.clientX);
      if (idx === null || idx !== hovering) hovering = idx;
      if (idx === null) return;
      const now = this.ctx.currentTime;
      const last = this.lastRubAt.get(idx) ?? -Infinity;
      if (now - last > 0.12) {
        this.engine.rub(idx, { when: now, duration: 0.18 });
        this.renderer.pulse(idx, now + 0.5);
        this.lastRubAt.set(idx, now);
      }
    });
    canvas.addEventListener('click', (e) => {
      const idx = glassIndexFromPoint(canvas, e.clientX);
      if (idx !== null) this.manualStrike(idx, 0.65);
    });
  }

  bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.repeat || e.target.tagName === 'INPUT') return;
      const idx = KEYS.indexOf(e.key.toLowerCase());
      if (idx >= 0) {
        this.keyDownAt.set(idx, performance.now());
        this.manualStrike(idx, 0.55);
      }
    });
    document.addEventListener('keyup', (e) => {
      const idx = KEYS.indexOf(e.key.toLowerCase());
      if (idx >= 0) this.keyDownAt.delete(idx);
    });
  }

  manualStrike(idx, baseVelocity) {
    if (this.engine.isBroken(idx)) return;
    const holdMs = this.keyDownAt.has(idx)
      ? performance.now() - this.keyDownAt.get(idx) : 0;
    // 保持在破裂阈值之下，避免手动探索意外打断整段旋律的成功判定。
    const velocity = Math.min(this.project.physics.breakVelocity - 0.02,
      baseVelocity + holdMs / 1000 * 0.2);
    const result = this.engine.strike(idx, { when: this.ctx.currentTime, velocity });
    if (result) {
      this.renderer.pulse(idx, this.ctx.currentTime + 1.2);
      if (result.broken) showResult(false, `杯 ${idx + 1} 因敲击过强破裂！修复后才能再次成功。`);
      this.refreshReadout();
    }
  }

  onTrackChange(i, field, value) {
    const track = this.project.tracks[i];
    track[field] = value;
    if (field === 'gain') this.engine.setTrackGain(i, value);
    if (field === 'pan') this.engine.setTrackPan(i, value);
    this.refreshReadout();
  }

  startCoolingLoop() {
    let last = performance.now();
    this._coolTimer = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      // 音频时钟挂起（暂停）时不累积冷却时间，恢复后状态与暂停瞬间一致。
      if (this.ctx.state === 'running' && this.sequencer.state !== 'paused') {
        this.engine.cool(dt);
      }
      this.renderer.heatMap = this.engine.temperatures.slice();
      this.refreshReadout();
    }, 200);
  }

  refreshReadout() {
    const freqs = this.project.tracks.map((_, i) => this.engine.frequencyFor(i, this.project.transpose));
    updateTrackCards(this.project, this.engine.temperatures, freqs);
    const totalBeats = patternLength(this.project) / 2;
    $('beat-readout').textContent =
      `节拍 ${this.sequencer.beatPosition.toFixed(2)} / ${totalBeats.toFixed(2)}`;
  }

  renderFrame() {
    this.refreshReadout();
  }
}

// 导出供 controls.js 使用的应用单例。
export const app = new GlassApp();
app.init();
