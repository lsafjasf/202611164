import { generateCase, evaluate, scoreFor } from './case.js';
import { renderCase } from './audio.js';

const $ = (id) => document.getElementById(id);
const els = {
  seedInput: $('seedInput'), startBtn: $('startBtn'), restartBtn: $('restartBtn'),
  ruleInfo: $('ruleInfo'), briefing: $('briefing'), player: $('player'),
  segments: $('segments'), pauseBtn: $('pauseBtn'), nowPlaying: $('nowPlaying'),
  deduction: $('deduction'), orderRow: $('orderRow'), directionRow: $('directionRow'),
  submitBtn: $('submitBtn'), attemptsInfo: $('attemptsInfo'), feedback: $('feedback'),
  settlement: $('settlement'), settleTitle: $('settleTitle'), routeLine: $('routeLine'),
  settleTable: $('settleTable').querySelector('tbody'), scoreLine: $('scoreLine'),
};

let state = null;
let audioCtx = null;
let currentSource = null;

function stopCurrent() {
  if (currentSource) {
    try { currentSource.onended = null; currentSource.stop(); } catch {}
    currentSource = null;
  }
  els.nowPlaying.textContent = '未播放';
}

async function playSegment(seg) {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  stopCurrent();
  const src = audioCtx.createBufferSource();
  src.buffer = state.buffers[seg.id];
  src.connect(audioCtx.destination);
  src.onended = () => {
    if (currentSource === src) {
      currentSource = null;
      els.nowPlaying.textContent = '未播放';
    }
  };
  src.start();
  currentSource = src;
  els.nowPlaying.textContent = `正在播放：${seg.label}`;
}

async function togglePause() {
  if (!audioCtx) return;
  if (audioCtx.state === 'running') {
    await audioCtx.suspend(); // freezes the buffer position; content unchanged
    els.pauseBtn.textContent = '▶ 继续';
  } else if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
    els.pauseBtn.textContent = '⏸ 暂停';
  }
}

function buildSegmentCards(caseData) {
  els.segments.innerHTML = '';
  for (const seg of caseData.segments) {
    const card = document.createElement('div');
    card.className = 'seg-card';
    const isTarget = caseData.directionTargets.includes(seg.id);
    card.innerHTML = `<h3>${seg.label}</h3>
      <div class="tag">${isTarget ? '⚠ 需判定方位' : '仅需排序'}</div>`;
    const btn = document.createElement('button');
    btn.textContent = '▶ 播放 / 重播';
    btn.addEventListener('click', () => {
      els.pauseBtn.disabled = false;
      els.pauseBtn.textContent = '⏸ 暂停';
      playSegment(seg);
    });
    card.appendChild(btn);
    els.segments.appendChild(card);
  }
}

function buildDeductionForm(caseData) {
  els.orderRow.innerHTML = '';
  for (let pos = 1; pos <= 4; pos++) {
    const label = document.createElement('label');
    label.textContent = `第 ${pos} 个被运走`;
    const sel = document.createElement('select');
    sel.dataset.pos = pos;
    sel.innerHTML = '<option value="">—</option>' + caseData.segments
      .map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
    label.appendChild(sel);
    els.orderRow.appendChild(label);
  }
  els.directionRow.innerHTML = '';
  for (const id of caseData.directionTargets) {
    const seg = caseData.segments[id];
    const div = document.createElement('div');
    div.className = 'dir-block';
    div.innerHTML = `${seg.label} 的声源方位：
      <label><input type="radio" name="dir-${id}" value="left" /> 左舷（左声道）</label>
      <label><input type="radio" name="dir-${id}" value="right" /> 右舷（右声道）</label>`;
    els.directionRow.appendChild(div);
  }
}

function readSubmission(caseData) {
  const order = [...els.orderRow.querySelectorAll('select')].map((s) => s.value);
  if (order.some((v) => v === '')) return { error: '请为全部 4 个位置选择广播。' };
  const ids = order.map(Number);
  if (new Set(ids).size !== 4) return { error: '每个位置必须是不同的广播。' };
  const directions = {};
  for (const id of caseData.directionTargets) {
    const checked = document.querySelector(`input[name="dir-${id}"]:checked`);
    if (!checked) return { error: `请判定${caseData.segments[id].label}的方位。` };
    directions[id] = checked.value;
  }
  return { order: ids, directions };
}

function showHints(hints, solved) {
  els.feedback.innerHTML = '';
  for (const h of hints) {
    const p = document.createElement('p');
    p.textContent = h;
    if (solved) p.className = 'ok';
    els.feedback.appendChild(p);
  }
}

function updateAttempts() {
  const { maxAttempts, penaltyPerFail } = state.caseData.rules;
  els.attemptsInfo.textContent =
    `剩余尝试 ${maxAttempts - state.fails}/${maxAttempts} · 每次失败扣 ${penaltyPerFail} 分`;
}

function settle(solved, submission, result) {
  stopCurrent();
  els.pauseBtn.disabled = true;
  els.submitBtn.disabled = true;
  els.settlement.classList.remove('hidden');
  els.settleTitle.textContent = solved ? '✅ 结案报告：推断成立' : '❌ 结案报告：推断失败';

  const byPos = [1, 2, 3, 4].map((p) => state.caseData.segments.find((s) => s.order === p));
  els.routeLine.innerHTML = '<span class="hl">真实路线：</span>' +
    byPos.map((s, i) => `第${i + 1}批 → ${s.label}（${s.pan === 'left' ? '左舷' : '右舷'}）`)
      .join(' → ');

  els.settleTable.innerHTML = '';
  for (const seg of state.caseData.segments) {
    const isTarget = state.caseData.directionTargets.includes(seg.id);
    const playerPos = submission ? submission.order.indexOf(seg.id) + 1 : '—';
    const playerDir = submission ? submission.directions[seg.id] : null;
    const orderOk = playerPos === seg.order;
    const dirOk = isTarget ? playerDir === seg.pan : null;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${seg.label}${isTarget ? ' ⚠' : ''}</td>
      <td>汽笛×${seg.hornCount}，机械 ${seg.machineryRate.toFixed(2)} 次/秒，脚步 ${seg.footstepRate.toFixed(1)} 步/秒</td>
      <td>钟声 ×${seg.bellCount}（首次 ${seg.anchorOffset.toFixed(2)}s）</td>
      <td>汽笛基频 ${seg.hornFreq} Hz</td>
      <td>${seg.pan === 'left' ? '左舷' : '右舷'}</td>
      <td>第 ${seg.order} 批</td>
      <td>第 ${playerPos} 批${isTarget ? `；${playerDir === 'left' ? '左舷' : '右舷'}` : ''}</td>
      <td class="${orderOk && dirOk !== false ? 'ok' : 'bad'}">
        顺序${orderOk ? '✓' : '✗'}${isTarget ? ` 方位${dirOk ? '✓' : '✗'}` : ''}
      </td>`;
    els.settleTable.appendChild(tr);
  }
  els.scoreLine.textContent = `最终得分：${scoreFor(state.caseData, state.fails)}`;
  els.settlement.scrollIntoView({ behavior: 'smooth' });
}

function onSubmit() {
  const submission = readSubmission(state.caseData);
  if (submission.error) {
    showHints([submission.error], false);
    return;
  }
  const result = evaluate(state.caseData, submission);
  if (result.solved) {
    showHints(result.hints, true);
    settle(true, submission, result);
    return;
  }
  state.fails += 1;
  updateAttempts();
  showHints(result.hints, false);
  if (state.fails >= state.caseData.rules.maxAttempts) {
    settle(false, submission, result);
  }
}

async function startCase(seed) {
  els.startBtn.disabled = true;
  els.ruleInfo.textContent = '正在实时生成声纹线索…';
  stopCurrent();
  const caseData = generateCase(seed);
  const buffers = await renderCase(caseData);
  state = { caseData, buffers, fails: 0 };
  els.briefing.classList.remove('hidden');
  els.player.classList.remove('hidden');
  els.deduction.classList.remove('hidden');
  els.settlement.classList.add('hidden');
  els.feedback.innerHTML = '';
  els.submitBtn.disabled = false;
  els.pauseBtn.disabled = true;
  els.pauseBtn.textContent = '⏸ 暂停';
  buildSegmentCards(caseData);
  buildDeductionForm(caseData);
  updateAttempts();
  els.ruleInfo.textContent =
    `Seed ${seed} · 允许尝试 ${caseData.rules.maxAttempts} 次 · 失败每次扣 ${caseData.rules.penaltyPerFail} 分`;
  els.startBtn.disabled = false;
  els.restartBtn.disabled = false;
}

els.startBtn.addEventListener('click', () => startCase(Number(els.seedInput.value) || 0));
els.restartBtn.addEventListener('click', () => startCase(Number(els.seedInput.value) || 0));
els.pauseBtn.addEventListener('click', togglePause);
els.submitBtn.addEventListener('click', onSubmit);
