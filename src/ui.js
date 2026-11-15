// DOM 构建与控件绑定：轨道面板、通用控件取值。

import { GLASS_COUNT } from './project.js';

export const KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k'];

export function $(id) {
  return document.getElementById(id);
}

export function buildTrackPanel(project, onChange) {
  const panel = $('track-panel');
  panel.innerHTML = '';
  project.tracks.forEach((track, i) => {
    const card = document.createElement('div');
    card.className = 'track';
    card.dataset.track = String(i);
    card.innerHTML = `
      <h3><span>杯 ${i + 1} <small>(${KEYS[i].toUpperCase()})</small></span>
        <span class="track-state"></span></h3>
      <div class="row"><span>水位</span><input type="range" min="0" max="1" step="0.01"
        value="${track.water}" data-field="water"></div>
      <div class="row"><span>增益</span><input type="range" min="0" max="1" step="0.01"
        value="${track.gain}" data-field="gain"></div>
      <div class="row"><span>声像</span><input type="range" min="-1" max="1" step="0.05"
        value="${track.pan}" data-field="pan"></div>
      <div class="temp"><i style="width:0%"></i></div>`;
    card.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => {
        onChange(i, input.dataset.field, Number(input.value));
      });
    });
    panel.appendChild(card);
  });
}

export function updateTrackCards(project, temperatures, frequencies) {
  document.querySelectorAll('.track').forEach((card, i) => {
    const track = project.tracks[i];
    card.classList.toggle('broken', track.broken);
    const state = card.querySelector('.track-state');
    state.textContent = track.broken ? '破裂' : `${frequencies[i].toFixed(1)} Hz`;
    const bar = card.querySelector('.temp > i');
    bar.style.width = `${temperatures[i]}%`;
  });
}

export function setBadge(state) {
  const badge = $('state-badge');
  badge.className = `badge ${state}`;
  badge.textContent = state === 'playing' ? '播放中' : state === 'paused' ? '已暂停' : '已停止';
}

export function showResult(ok, message) {
  const box = $('result');
  box.className = `result ${ok ? 'success' : 'fail'}`;
  box.textContent = message;
}

export function hideResult() {
  $('result').className = 'result hidden';
}

export function renderVerifyReport(report) {
  const box = $('verify-report');
  box.className = 'verify';
  const rows = report.rows.map((r) =>
    `<tr><td>${r.label}</td><td>${r.first}</td><td>${r.reloaded}</td>
     <td class="${r.match ? 'ok' : ''}">${r.match ? '一致 ✓' : '不一致'}</td></tr>`).join('');
  box.innerHTML = `
    <strong>首轮 vs 重新载入（保存后重载，从头播放）</strong>
    <table><thead><tr><th>指标</th><th>首轮</th><th>重载后</th><th>结论</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div>${report.note}</div>`;
}

export function glassIndexFromPoint(canvas, clientX) {
  const rect = canvas.getBoundingClientRect();
  const rel = clientX - rect.left;
  const gap = rect.width * 0.02;
  const glassW = (rect.width - gap * (GLASS_COUNT + 1)) / GLASS_COUNT;
  const idx = Math.floor((rel - gap) / (glassW + gap));
  return idx >= 0 && idx < GLASS_COUNT ? idx : null;
}
