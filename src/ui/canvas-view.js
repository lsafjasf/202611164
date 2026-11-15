import { evaluateAt } from '../core/engine.js';

export const CANVAS_WIDTH = 480;
export const CANVAS_HEIGHT = 320;

export class CanvasView {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.store = store;
    this.ctx = canvas.getContext('2d');
    this.images = new Map();
  }

  loadImages() {
    const jobs = this.store.project.assets
      .filter((asset) => asset.type === 'image')
      .map((asset) => new Promise((resolve) => {
        if (this.images.has(asset.id)) {
          resolve();
          return;
        }
        const image = new Image();
        image.onload = () => {
          this.images.set(asset.id, image);
          resolve();
        };
        image.onerror = () => resolve();
        image.src = asset.src;
      }));
    return Promise.all(jobs);
  }

  hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const layers = evaluateAt(this.store.project, this.store.project.selection.currentTime);
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const layer = layers[index];
      if (!layer.visible) continue;
      if (x >= layer.x && x <= layer.x + layer.width && y >= layer.y && y <= layer.y + layer.height) {
        return layer.id;
      }
    }
    return null;
  }

  pixelHash() {
    const { data } = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      let hash = 0x811c9dc5;
    for (let index = 0; index < data.length; index += 1) {
      hash ^= data[index];
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  render() {
    const ctx = this.ctx;
    const project = this.store.project;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const layers = evaluateAt(project, project.selection.currentTime);
    for (const layer of layers) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      const centerX = layer.x + layer.width / 2;
      const centerY = layer.y + layer.height / 2;
      ctx.translate(centerX, centerY);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);
      if (layer.type === 'rect') {
        ctx.fillStyle = layer.fill;
        ctx.fillRect(layer.x, layer.y, layer.width, layer.height);
      } else if (layer.type === 'ellipse') {
        ctx.fillStyle = layer.fill;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, layer.width / 2, layer.height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (layer.type === 'text') {
        ctx.fillStyle = layer.fill;
        ctx.font = `${layer.fontSize}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(layer.text, layer.x, layer.y, layer.width);
      } else if (layer.type === 'image') {
        const image = this.images.get(layer.assetId);
        if (image) {
          ctx.drawImage(image, layer.x, layer.y, layer.width, layer.height);
        } else {
          ctx.fillStyle = '#d1d5db';
          ctx.fillRect(layer.x, layer.y, layer.width, layer.height);
        }
      }
      ctx.restore();
    }

    const selectedId = project.selection.layerId;
    const selected = layers.find((layer) => layer.id === selectedId);
    if (selected) {
      ctx.save();
      ctx.strokeStyle = '#0f62fe';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(selected.x - 2, selected.y - 2, selected.width + 4, selected.height + 4);
      ctx.restore();
    }
    return this.pixelHash();
  }
}
