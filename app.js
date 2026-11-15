/* 界面逻辑：所有异常都进入错误日志并展示恢复建议，不吞错、不伪造成功。
   性能说明：画布为静态渲染（无逐帧动画），仅在状态变化时重绘，降低非关键开销。 */
'use strict';
(function () {
  const { SpriteAtlas, AtlasError } = window.SpriteAtlasLib;

  const atlas = new SpriteAtlas({ width: 1024, height: 1024, maxWidth: 4096, maxHeight: 4096 });
  let selected = null;
  let frameSeq = 0;
  let rngState = 20261116;

  const canvas = document.getElementById('atlas-canvas');
  const ctx = canvas.getContext('2d');
  const errors = [];

  function rand() {
    rngState |= 0; rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nameColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360}, 65%, 55%)`;
  }

  function logError(err, op) {
    errors.push({ time: new Date().toLocaleTimeString(), code: err.code || 'UNEXPECTED', message: err.message, op });
    const li = document.createElement('li');
    li.textContent = `[${errors[errors.length - 1].time}] ${err.code || 'ERROR'} (${op}): ${err.message}`;
    document.getElementById('error-list').prepend(li);
    document.getElementById('err-count').textContent = String(errors.length);
    // 恢复建议常驻可见，直到下一次成功操作
    const box = document.getElementById('recovery');
    box.classList.remove('hidden');
    document.getElementById('recovery-text').textContent =
      err instanceof AtlasError ? err.recovery : '发生未预期错误，请查看控制台。';
    console.error(err);
  }

  function clearRecovery() {
    document.getElementById('recovery').classList.add('hidden');
  }

  function fmtBytes(n) {
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(1) + ' KB';
  }

  function refresh() {
    const m = atlas.metrics();
    document.getElementById('st-mode').textContent =
      m.lastOpMode === 'repack' ? '全量重排' : m.lastOpMode === 'import' ? '导入' : '增量';
    document.getElementById('st-util').textContent = (m.utilization * 100).toFixed(1) + '%';
    document.getElementById('st-repack').textContent = String(m.repackCount);
    document.getElementById('st-frames').textContent = String(m.frameCount);
    document.getElementById('st-size').textContent = `${m.atlasWidth}×${m.atlasHeight}`;
    document.getElementById('st-mem').textContent = fmtBytes(m.memoryBytes);
    document.getElementById('st-lastms').textContent = m.lastOpMs.toFixed(2) + ' ms';
    document.getElementById('st-totalms').textContent = m.totalPackMs.toFixed(2) + ' ms';

    // 静态重绘：仅状态变化时执行
    canvas.width = m.atlasWidth;
    canvas.height = m.atlasHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const f of atlas.frames.values()) {
      ctx.fillStyle = nameColor(f.name);
      ctx.fillRect(f.x, f.y, f.w, f.h);
      if (f.name === selected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(f.x + 1, f.y + 1, f.w - 2, f.h - 2);
      }
    }
    const list = document.getElementById('frame-list');
    list.innerHTML = '';
    for (const f of atlas.frames.values()) {
      const li = document.createElement('li');
      li.textContent = `${f.name}  (${f.x},${f.y}) ${f.w}×${f.h}`;
      if (f.name === selected) li.classList.add('selected');
      li.onclick = () => { selected = f.name; refresh(); };
      list.appendChild(li);
    }
  }

  function guard(op, fn) {
    try {
      fn();
      clearRecovery();
    } catch (err) {
      logError(err, op); // 状态未被破坏：packer 内部保证失败无副作用或已回滚
    }
    refresh();
  }

  document.getElementById('btn-add').onclick = () => guard('insert', () => {
    for (let i = 0; i < 8; i++) {
      const w = 16 + Math.floor(rand() * 48);
      const h = 16 + Math.floor(rand() * 48);
      atlas.insert(`frame_${String(frameSeq++).padStart(3, '0')}`, w, h);
    }
  });

  document.getElementById('btn-remove').onclick = () => guard('remove', () => {
    if (!selected) throw new AtlasError('NOT_FOUND', '尚未选中任何帧');
    atlas.remove(selected);
    selected = null;
  });

  document.getElementById('btn-repack').onclick = () => guard('repack', () => atlas.repack());

  document.getElementById('btn-export').onclick = () => guard('export', () => {
    const blob = new Blob([atlas.toJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sprite-atlas.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('file-import').onchange = (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => guard('import', () => {
      // 先解析成功再替换：导入失败时现有图集完全保留
      const next = SpriteAtlas.fromJSON(String(reader.result), { maxWidth: 4096, maxHeight: 4096, allowGrow: true });
      Object.assign(atlas, next);
      selected = null;
    });
    reader.readAsText(file);
    ev.target.value = '';
  };

  canvas.onclick = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
    selected = null;
    for (const f of atlas.frames.values()) {
      if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) selected = f.name;
    }
    refresh();
  };

  refresh();
})();
