export const PROJECT_VERSION = 1;

export const LAYER_TYPES = Object.freeze(['rect', 'ellipse', 'text', 'image']);
export const ASSET_TYPES = Object.freeze(['image', 'audio']);
export const EASINGS = Object.freeze([
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'hold',
]);
export const ANIMATABLE_PROPS = Object.freeze(['x', 'y', 'width', 'height', 'opacity', 'rotation']);

let idCounter = 0;

export function makeId(prefix) {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${idCounter}_${rand}`;
}

export function createKeyframe(time, props, easing = 'linear') {
  return { id: makeId('kf'), time, easing, props: { ...props } };
}

export function createLayer(partial = {}) {
  return {
    id: partial.id || makeId('layer'),
    name: partial.name || 'Layer',
    type: partial.type || 'rect',
    visible: partial.visible !== false,
    locked: partial.locked === true,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    width: partial.width ?? 120,
    height: partial.height ?? 80,
    opacity: partial.opacity ?? 1,
    rotation: partial.rotation ?? 0,
    fill: partial.fill || '#4f8cff',
    assetId: partial.assetId || null,
    text: partial.text || '',
    fontSize: partial.fontSize || 24,
    keyframes: partial.keyframes || [],
  };
}

export function createAsset(partial = {}) {
  return {
    id: partial.id || makeId('asset'),
    name: partial.name || 'asset',
    type: partial.type || 'image',
    mimeType: partial.mimeType || '',
    src: partial.src || '',
    duration: partial.duration ?? null,
    params: partial.params ? { ...partial.params } : {},
  };
}

export function createProject(partial = {}) {
  const now = new Date().toISOString();
  return {
    version: PROJECT_VERSION,
    id: partial.id || makeId('proj'),
    name: partial.name || 'Untitled project',
    createdAt: partial.createdAt || now,
    updatedAt: partial.updatedAt || now,
    timeline: {
      duration: (partial.timeline && partial.timeline.duration) || 5,
      fps: (partial.timeline && partial.timeline.fps) || 30,
      loop: (partial.timeline && partial.timeline.loop) ?? true,
    },
    assets: partial.assets || [],
    layers: partial.layers || [],
    selection: {
      layerId: (partial.selection && partial.selection.layerId) || null,
      currentTime: (partial.selection && partial.selection.currentTime) || 0,
    },
  };
}
