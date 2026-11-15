import { EditorStore } from '../core/store.js';
import {
  buildBoundaryProject,
  buildDefaultProject,
} from '../core/sample-data.js';
import { countObjects } from '../core/serialize.js';
import { createKeyframe, createLayer } from '../core/model.js';
import { CanvasView } from './canvas-view.js';

const $ = (selector) => document.querySelector(selector);

class EditorApp {
  constructor() {
    this.store = EditorStore.load();
    this.canvasView = new CanvasView($('#canvas'), this.store);
    this.exportText = '';
    this.elements = {
      layerList: $('#layer-list'),
      layerForm: $('#layer-form'),
      assetList: $('#asset-list'),
      metrics: $('#metric-count'),
      hash: $('#metric-hash'),
      pixelHash: $('#metric-pixel-hash'),
      status: $('#status'),
      errorBox: $('#error-box'),
      exportPreview: $('#export-preview'),
      timeRange: $('#time-range'),
      timeLabel: $('#time-label'),
      keyframeList: $('#keyframe-list'),
      canvas: $('#canvas'),
    };
    this.bindEvents();
    this.store.subscribe(() => this.refresh());
    this.refresh();
  }

  setStatus(message, isError = false) {
    this.elements.status.textContent = message;
    this.elements.errorBox.hidden = !isError;
    if (isError) this.elements.errorBox.textContent = message;
  }

  async refresh() {
    await this.canvasView.loadImages();
    const pixelHash = this.canvasView.render();
    const project = this.store.project;
    this.renderLayers();
    this.renderAssets();
    this.renderKeyframes();
    this.renderForm();
    const counts = countObjects(project);
    this.elements.metrics.textContent =
      `总 ${counts.total}（工程 ${counts.projects} / 图层 ${counts.layers} / 关键帧 ${counts.keyframes} / 素材 ${counts.assets}）`;
    this.elements.hash.textContent = await this.store.currentHash();
    this.elements.pixelHash.textContent = pixelHash;
    this.elements.timeRange.max = project.timeline.duration;
    this.elements.timeRange.value = project.selection.currentTime;
    this.elements.timeLabel.textContent =
      `${project.selection.currentTime.toFixed(2)}s / ${project.timeline.duration.toFixed(2)}s`;
    this.elements.canvas.setAttribute(
      'aria-label',
      `工程画布预览，${project.layers.length} 个图层，当前选中 ${project.selection.layerId ?? '无'}，时间 ${project.selection.currentTime.toFixed(2)} 秒`,
    );
    const selectedOption = this.elements.layerList.querySelector('[aria-selected="true"]');
    if (selectedOption && document.activeElement === document.body) {
      selectedOption.tabIndex = 0;
    }
  }

  renderLayers() {
    const list = this.elements.layerList;
    const selectedId = this.store.project.selection.layerId;
    const focusedId = document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.layerId
      : null;
    list.textContent = '';
    this.store.project.layers.forEach((layer, index) => {
      const item = document.createElement('li');
      item.id = `layer-option-${layer.id}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(layer.id === selectedId));
      item.tabIndex = layer.id === selectedId ? 0 : -1;
      item.dataset.layerId = layer.id;
      item.textContent = `${index + 1}. ${layer.name}（${layer.type}）${layer.visible ? '' : ' [隐藏]'}`;
      list.appendChild(item);
      if (layer.id === focusedId) item.focus();
    });
  }

  renderAssets() {
    const list = this.elements.assetList;
    list.innerHTML = '';
    this.store.project.assets.forEach((asset) => {
      const item = document.createElement('li');
      item.textContent = `${asset.name} · ${asset.type} · ${asset.mimeType || '未知 MIME'} · 参数 ${JSON.stringify(asset.params)}`;
      list.appendChild(item);
    });
  }

  renderKeyframes() {
    const list = this.elements.keyframeList;
    list.innerHTML = '';
    const layer = this.store.project.layers.find(
      (item) => item.id === this.store.project.selection.layerId,
    );
    if (!layer) return;
    layer.keyframes.forEach((keyframe) => {
      const item = document.createElement('li');
      item.textContent = `t=${keyframe.time.toFixed(2)}s · ${keyframe.easing} · ${JSON.stringify(keyframe.props)}`;
      list.appendChild(item);
    });
  }

  renderForm() {
    const layer = this.store.project.layers.find(
      (item) => item.id === this.store.project.selection.layerId,
    );
    const form = this.elements.layerForm;
    form.querySelectorAll('input').forEach((input) => {
      input.disabled = !layer;
    });
    if (!layer) return;
    for (const input of form.querySelectorAll('input')) {
      if (input.name in layer) input.value = layer[input.name];
    }
  }

  bindEvents() {
    $('#btn-new').addEventListener('click', () => this.loadProject(buildDefaultProject(), '默认工程已载入'));
    $('#btn-boundary').addEventListener('click', () => this.loadProject(buildBoundaryProject(), '边界工程已载入'));
    $('#btn-export').addEventListener('click', () => this.exportProject());
    $('#btn-import').addEventListener('click', () => $('#file-import').click());
    $('#btn-undo').addEventListener('click', () => this.store.undo());
    $('#btn-redo').addEventListener('click', () => this.store.redo());

    $('#file-import').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const text = await file.text();
      this.importProject(text);
      event.target.value = '';
    });

    this.elements.layerList.addEventListener('click', (event) => {
      const item = event.target.closest('li[data-layer-id]');
      if (item) this.selectLayer(item.dataset.layerId);
    });
    this.elements.layerList.addEventListener('keydown', (event) => this.handleLayerListKey(event));

    this.elements.canvas.addEventListener('pointerdown', (event) => {
      const layerId = this.canvasView.hitTest(event.clientX, event.clientY);
      if (layerId) {
        this.selectLayer(layerId);
      } else {
        this.setStatus('画布空白处未命中任何图层', false);
      }
      this.elements.canvas.focus();
    });
    this.elements.canvas.tabIndex = 0;
    this.elements.canvas.addEventListener('keydown', (event) => this.handleCanvasKey(event));

    this.elements.layerForm.addEventListener('change', (event) => {
      const layerId = this.store.project.selection.layerId;
      if (!layerId || !event.target.name) return;
      const value = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
      this.store.updateLayer(layerId, { [event.target.name]: value });
      this.setStatus(`已更新图层参数 ${event.target.name}=${value}`);
    });

    $('#btn-keyframe').addEventListener('click', () => this.insertKeyframe());
    this.elements.timeRange.addEventListener('input', (event) => {
      this.store.setCurrentTime(Number(event.target.value));
    });

    $('#btn-add-rect').addEventListener('click', () => this.addLayer('rect'));
    $('#btn-add-text').addEventListener('click', () => this.addLayer('text'));

    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        this.store.undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        this.store.redo();
      }
    });
  }

  selectLayer(layerId) {
    this.store.selectLayer(layerId);
    const option = this.elements.layerList.querySelector(`[data-layer-id="${layerId}"]`);
    const focusInsideList = this.elements.layerList.contains(document.activeElement);
    if (option && focusInsideList) option.focus();
    this.setStatus(`已选中图层 ${layerId}`);
  }

  handleLayerListKey(event) {
    const ids = this.store.project.layers.map((layer) => layer.id);
    if (ids.length === 0) return;
    const currentId = this.store.project.selection.layerId;
    const index = Math.max(0, ids.indexOf(currentId));
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.selectLayer(ids[Math.min(index + 1, ids.length - 1)]);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      this.selectLayer(ids[Math.max(index - 1, 0)]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      this.selectLayer(ids[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      this.selectLayer(ids[ids.length - 1]);
    }
  }

  handleCanvasKey(event) {
    const ids = this.store.project.layers.map((layer) => layer.id);
    if (ids.length === 0) return;
    const index = ids.indexOf(this.store.project.selection.layerId);
    if (event.key === 'Tab' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = index < 0 ? ids[0] : ids[(index + 1) % ids.length];
      this.selectLayer(next);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = index <= 0 ? ids[ids.length - 1] : ids[index - 1];
      this.selectLayer(prev);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const layer = this.store.project.layers.find((item) => item.id === ids[index >= 0 ? index : 0]);
      if (layer) this.setStatus(`画布键盘确认图层 ${layer.name}`);
    }
  }

  addLayer(type) {
    const layer = createLayer({
      type,
      name: type === 'text' ? '新文字图层' : '新矩形图层',
      text: type === 'text' ? '文字' : '',
      x: 40 + (this.store.project.layers.length * 12) % 200,
      y: 40 + (this.store.project.layers.length * 16) % 160,
    });
    this.store.addLayer(layer);
    this.setStatus(`已添加 ${type} 图层 ${layer.id}`);
  }

  insertKeyframe() {
    const layerId = this.store.project.selection.layerId;
    const layer = this.store.project.layers.find((item) => item.id === layerId);
    if (!layer) {
      this.setStatus('请先选中一个图层再插入关键帧', true);
      return;
    }
    const keyframe = createKeyframe(
      this.store.project.selection.currentTime,
      {
        x: layer.x, y: layer.y, width: layer.width, height: layer.height,
        opacity: layer.opacity, rotation: layer.rotation,
      },
      'easeInOut',
    );
    this.store.addKeyframe(layerId, keyframe);
    this.setStatus(`已在 t=${keyframe.time.toFixed(2)}s 插入关键帧 ${keyframe.id}`);
  }

  loadProject(project, message) {
    const result = this.store.importJSON(JSON.stringify({ format: 'editor-project', version: 1, project }));
    if (result.ok) this.setStatus(message);
  }

  exportProject() {
    const { envelope, json } = this.store.exportProject();
    this.exportText = json;
    this.elements.exportPreview.textContent = json;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.store.project.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.setStatus(`已导出工程（导出前状态已保留快照，对象数与哈希见右侧指标）`);
    return { envelope, json };
  }

  importProject(text) {
    const hashBefore = this.store.project.id;
    const result = this.store.importJSON(text);
    if (result.ok) {
      this.exportText = text;
      this.elements.exportPreview.textContent = text;
      this.setStatus('导入成功：图层、关键帧、时间轴与素材参数已恢复，选择状态保持一致');
      return;
    }
    const detail = result.errors
      .map((error, index) => `${index + 1}. [${error.code}] ${error.path} — ${error.message}`)
      .join('\n');
    this.setStatus(`导入被阻止，当前工程保持不变（工程 ${hashBefore} 未被替换）。失败原因：\n${detail}`, true);
  }
}

globalThis.editorApp = new EditorApp();
export { EditorApp };
