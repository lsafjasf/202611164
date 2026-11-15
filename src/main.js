// UI controller: drag-and-drop editing, parameter panel, save/load, block alerts.

import { Scene } from './scene.js';
import { Renderer } from './renderer.js';
import { persistence } from './persistence.js';
import { DEFAULT_PARAMS } from './terrain.js';

const $ = (id) => document.getElementById(id);

class MapApp {
  constructor() {
    this.renderer = null;
    this.drag = null;
    this.bindStaticEvents();
    this.startNew($('seedInput').value || '20261116', DEFAULT_PARAMS);
  }

  startNew(seed, params) {
    this.scene = new Scene(seed, params);
    this.renderer = new Renderer($('mapCanvas'), this.scene, 8);
    this.syncSummary();
    this.syncParams();
    this.renderLog('已根据 seed 生成新场景');
    this.renderBlocked();
    this.renderer.draw();
    this.autoSave();
  }

  bindStaticEvents() {
    $('regenerateBtn').addEventListener('click', () => {
      this.scene.regenerate();
      this.renderLog('显式重新生成，布局已回到该 seed 的初始状态');
      this.afterSceneChange();
    });
    $('newSeedBtn').addEventListener('click', () => {
      const seed = String(Math.floor(Math.random() * 1_000_000_000));
      $('seedInput').value = seed;
      this.startNew(seed, this.scene ? this.scene.params : DEFAULT_PARAMS);
    });
    $('applySeedBtn').addEventListener('click', () => {
      const seed = $('seedInput').value.trim();
      if (!seed) return this.flashStatus('seed 不能为空');
      this.startNew(seed, this.scene.params);
    });
    $('saveBtn').addEventListener('click', () => {
      const size = persistence.save(this.scene);
      this.flashStatus(`已保存到浏览器（${size} 字节），哈希 ${this.scene.layoutHash()}`);
    });
    $('loadBtn').addEventListener('click', () => this.restoreFrom(persistence.load()));
    $('exportBtn').addEventListener('click', () => persistence.exportFile(this.scene));
    $('importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = await persistence.importFile(file);
        await this.restoreFrom(data);
      } catch (err) {
        this.flashStatus(err.message);
      }
      e.target.value = '';
    });
    $('applyParamsBtn').addEventListener('click', () => this.applyParams());
    $('resetParamsBtn').addEventListener('click', () => {
      this.fillParams(DEFAULT_PARAMS);
      this.applyParams();
    });
    this.bindCanvasEvents();
  }

  bindCanvasEvents() {
    const canvas = $('mapCanvas');
    canvas.addEventListener('mousedown', (e) => {
      const hit = this.renderer.objectAtPixel(e.clientX, e.clientY);
      if (!hit) return;
      this.drag = { id: hit.id };
      this.renderer.selectedId = hit.id;
      this.updateDragPreview(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      this.updateDragPreview(e);
      this.renderer.draw();
    });
    window.addEventListener('mouseup', () => {
      if (!this.drag) return;
      const preview = this.renderer.dragPreview;
      const drag = this.drag;
      this.drag = null;
      this.renderer.dragPreview = null;
      if (preview && preview.valid) this.commitMove(drag.id, preview.x, preview.y);
      else if (preview) this.flashStatus('移动被拒绝：' + (preview.reason || '位置非法'));
      this.renderer.draw();
    });
  }

  updateDragPreview(event) {
    const cell = this.renderer.cellAtPixel(event.clientX, event.clientY);
    const check = this.scene.validateMove(this.drag.id, cell.x, cell.y);
    this.renderer.dragPreview = { x: cell.x, y: cell.y, valid: check.ok, reason: check.reason };
  }

  commitMove(id, x, y) {
    const obj = this.scene.getObject(id);
    const result = this.scene.moveObject(id, x, y);
    if (!result.ok) {
      this.flashStatus(`移动被拒绝：${result.reason}`);
      return;
    }
    this.renderLog(
      `移动 ${id} (${obj.x},${obj.y}) → (${x},${y})；` +
      `重算边 ${result.rebuiltEdges.length} 条，受影响对象 ${result.changedObjects.join(',') || '无'}`);
    this.afterSceneChange();
  }

  async restoreFrom(data) {
    if (!data) return this.flashStatus('没有可载入的存档');
    const { Scene } = await import('./scene.js');
    const restored = await Scene.fromJSON(data);
    this.scene = restored.scene;
    this.renderer = new Renderer($('mapCanvas'), this.scene, 8);
    const match = restored.restoredHash === restored.savedHash;
    $('seedInput').value = this.scene.seed;
    this.syncSummary();
    this.syncParams();
    this.renderLog(`载入存档：编辑 ${this.scene.editLog.length} 条，布局哈希${match ? '一致' : '不一致'}`);
    this.renderBlocked();
    this.renderer.draw();
    this.flashStatus(match
      ? `载入成功，哈希校验通过 ${restored.restoredHash}`
      : '警告：载入后哈希与存档不一致');
  }

  applyParams() {
    const next = this.readParams();
    if (!next) return;
    const result = this.scene.updateParams(next);
    if (result.rebuilt === 'full') {
      this.renderer = new Renderer($('mapCanvas'), this.scene, 8);
      this.renderLog('地形/数量参数变化，已整体重算');
    } else {
      this.renderLog('仅覆盖半径变化，坐标与对象哈希保持不变');
    }
    this.afterSceneChange();
  }

  readParams() {
    const num = (id) => Number($(id).value);
    const params = structuredClone(this.scene.params);
    params.width = num('pWidth');
    params.height = num('pHeight');
    params.waterLevel = num('pWater');
    params.minObjectSpacing = num('pSpacing');
    params.villageCount = num('pVillages');
    params.towerCount = num('pTowers');
    params.supplyCount = num('pSupplies');
    params.coverage.village = num('pCovVillage');
    params.coverage.tower = num('pCovTower');
    params.coverage.supply = num('pCovSupply');
    if (params.width < 20 || params.height < 20 || params.width > 160 || params.height > 160) {
      this.flashStatus('网格尺寸需在 20–160 之间');
      return null;
    }
    return params;
  }

  fillParams(params) {
    $('pWidth').value = params.width;
    $('pHeight').value = params.height;
    $('pWater').value = params.waterLevel;
    $('pSpacing').value = params.minObjectSpacing;
    $('pVillages').value = params.villageCount;
    $('pTowers').value = params.towerCount;
    $('pSupplies').value = params.supplyCount;
    $('pCovVillage').value = params.coverage.village;
    $('pCovTower').value = params.coverage.tower;
    $('pCovSupply').value = params.coverage.supply;
  }

  syncParams() {
    this.fillParams(this.scene.params);
  }

  syncSummary() {
    $('seedInput').value = this.scene.seed;
    $('summarySeed').textContent = this.scene.seed;
    $('summaryTargets').textContent = String(this.scene.targetCount());
    $('summaryRules').textContent = this.scene.rulesSummary();
    $('summaryHash').textContent = this.scene.layoutHash();
  }

  afterSceneChange() {
    this.syncSummary();
    this.renderBlocked();
    this.renderer.draw();
    this.autoSave();
  }

  renderBlocked() {
    const box = $('blockedBox');
    const reports = this.scene.lastBlocked;
    if (!reports.length) {
      box.style.display = 'none';
      box.textContent = '';
      return;
    }
    box.style.display = 'block';
    box.innerHTML = reports.map((r) => {
      const from = r.fromPos ? `(${r.fromPos.x},${r.fromPos.y})` : '';
      const to = r.toPos ? `(${r.toPos.x},${r.toPos.y})` : '';
      const barrier = r.barrierCells
        ? `，阻断格 ${r.barrierCells.length} 个，首格 (${r.barrierCells[0][0]},${r.barrierCells[0][1]})`
        : '';
      return `路线阻断：${r.from}${from} ↔ ${r.to}${to}${barrier}`;
    }).join('<br>');
  }

  renderLog(message) {
    const list = $('editLog');
    const item = document.createElement('li');
    item.textContent = `#${this.scene.editLog.length} ${message}`;
    list.prepend(item);
  }

  flashStatus(message) {
    const el = $('statusLine');
    el.textContent = message;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
  }

  autoSave() {
    try {
      persistence.save(this.scene);
    } catch {
      // localStorage 不可用时静默降级，用户仍可手动导出 JSON。
    }
  }
}

export { MapApp };

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.mapApp = new MapApp();
  });
}
