import { CONFIG } from './config.js';

export function drawMap(canvas, game, options = {}) {
  const ctx2d = canvas.getContext('2d');
  const w = canvas.width;
  const cell = w / CONFIG.gridSize;
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  ctx2d.fillStyle = '#061826';
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);

  ctx2d.strokeStyle = 'rgba(90,170,200,0.18)';
  ctx2d.lineWidth = 1;
  for (let i = 0; i <= CONFIG.gridSize; i++) {
    ctx2d.beginPath();
    ctx2d.moveTo(i * cell, 0);
    ctx2d.lineTo(i * cell, w);
    ctx2d.stroke();
    ctx2d.beginPath();
    ctx2d.moveTo(0, i * cell);
    ctx2d.lineTo(w, i * cell);
    ctx2d.stroke();
  }

  // 母舰/出发点
  ctx2d.fillStyle = '#3ddc97';
  ctx2d.fillRect(game.map.home.x * cell + cell * 0.2, game.map.home.y * cell + cell * 0.2, cell * 0.6, cell * 0.6);
  ctx2d.fillStyle = '#061826';
  ctx2d.font = `${cell * 0.32}px monospace`;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  ctx2d.fillText('H', game.map.home.x * cell + cell / 2, game.map.home.y * cell + cell / 2);

  // 玩家标记（调查阶段不提示对错，结算时才着色）
  for (const marker of game.markers) {
    const cx = marker.x * cell + cell / 2;
    const cy = marker.y * cell + cell / 2;
    ctx2d.strokeStyle = options.reveal ? (marker.correct ? '#3ddc97' : '#ff6b6b') : '#ffd166';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, cell * 0.28, 0, Math.PI * 2);
    ctx2d.stroke();
    ctx2d.beginPath();
    ctx2d.moveTo(cx - cell * 0.18, cy - cell * 0.18);
    ctx2d.lineTo(cx + cell * 0.18, cy + cell * 0.18);
    ctx2d.moveTo(cx + cell * 0.18, cy - cell * 0.18);
    ctx2d.lineTo(cx - cell * 0.18, cy + cell * 0.18);
    ctx2d.stroke();
  }

  // 结算后才揭示暗礁与信标
  if (options.reveal) {
    for (const reef of game.map.reefs) {
      ctx2d.fillStyle = 'rgba(180,120,90,0.9)';
      ctx2d.beginPath();
      ctx2d.moveTo(reef.x * cell + cell * 0.5, reef.y * cell + cell * 0.15);
      ctx2d.lineTo(reef.x * cell + cell * 0.85, reef.y * cell + cell * 0.8);
      ctx2d.lineTo(reef.x * cell + cell * 0.15, reef.y * cell + cell * 0.8);
      ctx2d.closePath();
      ctx2d.fill();
    }
    for (const beacon of game.map.beacons) {
      const got = game.collected.includes(beacon.id);
      ctx2d.fillStyle = got ? '#3ddc97' : '#5aa9e6';
      ctx2d.beginPath();
      ctx2d.arc(beacon.x * cell + cell / 2, beacon.y * cell + cell / 2, cell * 0.22, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.fillStyle = '#eaf6ff';
      ctx2d.font = `${cell * 0.26}px monospace`;
      ctx2d.fillText(beacon.id, beacon.x * cell + cell / 2, beacon.y * cell + cell / 2);
    }
  }

  // 潜航器
  ctx2d.fillStyle = '#eaf6ff';
  ctx2d.beginPath();
  ctx2d.arc(game.sub.x * cell + cell / 2, game.sub.y * cell + cell / 2, cell * 0.26, 0, Math.PI * 2);
  ctx2d.fill();
  ctx2d.fillStyle = '#5aa9e6';
  ctx2d.beginPath();
  ctx2d.arc(game.sub.x * cell + cell / 2, game.sub.y * cell + cell / 2, cell * 0.12, 0, Math.PI * 2);
  ctx2d.fill();
}

// 把线索描述符画成确定性波形（同描述符 -> 同图形），不依赖音频上下文。
export function drawWaveform(canvas, entry) {
  const ctx2d = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx2d.fillStyle = '#04101b';
  ctx2d.fillRect(0, 0, w, h);
  ctx2d.strokeStyle = 'rgba(90,170,200,0.25)';
  ctx2d.beginPath();
  ctx2d.moveTo(0, h / 2);
  ctx2d.lineTo(w, h / 2);
  ctx2d.stroke();
  if (!entry) {
    ctx2d.fillStyle = '#7fa8c0';
    ctx2d.font = '14px monospace';
    ctx2d.textAlign = 'center';
    ctx2d.fillText('选择左侧日志以查看波形（可重播声音）', w / 2, h / 2);
    return;
  }

  ctx2d.strokeStyle = '#5aa9e6';
  ctx2d.lineWidth = 2;
  ctx2d.beginPath();
  const samples = 320;
  if (entry.type === 'listen') {
    // 监听波形：信标正弦音调 + 海流宽带起伏，确定性绘制
    const span = entry.duration || 2.5;
    for (let i = 0; i < samples; i++) {
      const t = (i / samples) * span;
      const tone = 0.42 * Math.sin(t * entry.measuredFreq * 0.09);
      const flow = entry.turbulence * 0.3 * Math.sin(t * 14 + entry.pan * 3) * Math.sin(t * 5.3);
      const x = 12 + (i / (samples - 1)) * (w - 24);
      const y = h / 2 - (tone + flow) * (h * 0.36);
      if (i === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();
    ctx2d.fillStyle = '#ffd166';
    ctx2d.font = '11px monospace';
    ctx2d.textAlign = 'left';
    ctx2d.fillText(`${entry.measuredFreq}Hz  pan=${entry.pan}`, 14, 16);
    return;
  }

  const echoes = entry.echoes || [];
  const maxDelay = Math.max(2, ...echoes.map((e) => e.delay), ...(entry.clutter || []));
  const xOf = (delay) => 12 + (delay / maxDelay) * (w - 24);
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * maxDelay;
    let amp = entry.noiseFloor * 0.35 * Math.sin(t * 47) * Math.sin(t * 13 + 1.7);
    for (const echo of echoes) {
      const d = t - echo.delay;
      if (Math.abs(d) < 0.16) amp += echo.amplitude * Math.exp(-Math.abs(d) * 22) * Math.sin(d * 120);
    }
    for (const delay of entry.clutter || []) {
      const d = t - delay;
      if (Math.abs(d) < 0.08) amp += 0.12 * Math.exp(-Math.abs(d) * 40) * Math.sin(d * 200 + 2);
    }
    const x = 12 + (i / (samples - 1)) * (w - 24);
    const y = h / 2 - amp * (h * 0.4);
    if (i === 0) ctx2d.moveTo(x, y);
    else ctx2d.lineTo(x, y);
  }
  ctx2d.stroke();

  ctx2d.fillStyle = '#ffd166';
  ctx2d.font = '11px monospace';
  ctx2d.textAlign = 'center';
  for (const echo of echoes) {
    ctx2d.fillText(`${echo.delay}s`, xOf(echo.delay), 16);
  }
}

export function drawGauges(canvas, game) {
  const ctx2d = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.fillStyle = '#04101b';
  ctx2d.fillRect(0, 0, w, h);
  const bar = (label, value, max, y, color) => {
    ctx2d.fillStyle = '#7fa8c0';
    ctx2d.font = '12px monospace';
    ctx2d.textAlign = 'left';
    ctx2d.fillText(`${label} ${value}/${max}`, 10, y - 6);
    ctx2d.strokeStyle = 'rgba(90,170,200,0.4)';
    ctx2d.strokeRect(10, y, w - 20, 12);
    ctx2d.fillStyle = color;
    ctx2d.fillRect(11, y + 1, (w - 22) * Math.max(0, Math.min(1, value / max)), 10);
  };
  bar('能源', Math.round(game.energy), CONFIG.startEnergy, 18, game.energy < 25 ? '#ff6b6b' : '#3ddc97');
  const noise = Math.min(1, CONFIG.scanNoiseBase + (game.scans - 1) * CONFIG.scanNoisePerScan);
  bar('噪音', Math.round(noise * 100), 100, 54, '#ffd166');
  bar('信标', game.collected.length, CONFIG.beaconCount, 90, '#5aa9e6');
}
