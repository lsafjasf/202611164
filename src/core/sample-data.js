import { createAsset, createKeyframe, createLayer, createProject } from './model.js';

export function buildDefaultProject() {
  const asset = createAsset({
    id: 'asset-logo',
    name: 'logo.svg',
    type: 'image',
    mimeType: 'image/svg+xml',
    src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="40" fill="%23ffb020"/></svg>',
    params: { fit: 'contain' },
  });
  const rect = createLayer({
    id: 'layer-rect',
    name: '背景矩形',
    type: 'rect',
    x: 60, y: 60, width: 180, height: 110, fill: '#4f8cff',
  });
  rect.keyframes = [
    { ...createKeyframe(0, { x: 60, opacity: 1 }, 'linear'), id: 'kf-rect-0' },
    { ...createKeyframe(2.5, { x: 260, opacity: 0.6 }, 'easeInOut'), id: 'kf-rect-25' },
    { ...createKeyframe(5, { x: 60, opacity: 1 }, 'easeInOut'), id: 'kf-rect-50' },
  ];
  const text = createLayer({
    id: 'layer-text',
    name: '标题文字',
    type: 'text',
    x: 80, y: 200, width: 260, height: 48,
    text: 'Hello 编辑器', fontSize: 28, fill: '#1f2937',
  });
  const image = createLayer({
    id: 'layer-image',
    name: 'Logo',
    type: 'image',
    x: 320, y: 220, width: 96, height: 96, assetId: 'asset-logo',
  });
  image.keyframes = [
    { ...createKeyframe(0, { rotation: 0 }, 'linear'), id: 'kf-image-0' },
    { ...createKeyframe(5, { rotation: 360 }, 'linear'), id: 'kf-image-50' },
  ];
  const project = createProject({
    id: 'proj-default',
    name: '默认演示工程',
    createdAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z',
    timeline: { duration: 5, fps: 30, loop: true },
    assets: [asset],
    layers: [rect, text, image],
  });
  project.selection = { layerId: 'layer-rect', currentTime: 0 };
  return project;
}

export function buildBoundaryProject() {
  const layer = createLayer({
    id: 'layer-edge',
    name: '边界图层',
    type: 'ellipse',
    x: -10000, y: 10000, width: 0, height: 10000,
    opacity: 0, rotation: -360, fill: '#d64545',
  });
  layer.keyframes = [
    { ...createKeyframe(0, { opacity: 0 }, 'hold'), id: 'kf-edge-0' },
    { ...createKeyframe(3600, { opacity: 1 }, 'linear'), id: 'kf-edge-3600' },
  ];
  const audio = createAsset({
    id: 'asset-audio',
    name: 'silence.wav',
    type: 'audio',
    mimeType: 'audio/wav',
    src: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=',
    duration: 3600,
    params: { volume: 0 },
  });
  const project = createProject({
    id: 'proj-boundary',
    name: '边界工程',
    createdAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z',
    timeline: { duration: 3600, fps: 1, loop: false },
    assets: [audio],
    layers: [layer],
  });
  project.selection = { layerId: 'layer-edge', currentTime: 3600 };
  return project;
}

export function buildDanglingReferenceProject() {
  const project = buildDefaultProject();
  project.id = 'proj-bad-dangling';
  project.layers[2].assetId = 'asset-missing';
  return project;
}

export function buildIllegalTypeProject() {
  const project = buildDefaultProject();
  project.id = 'proj-bad-type';
  project.layers[0].type = 'polygon';
  project.layers[0].keyframes[1].easing = 'bounce';
  return project;
}

export function buildDuplicateIdProject() {
  const project = buildDefaultProject();
  project.id = 'proj-bad-duplicate';
  project.layers[1].id = project.layers[0].id;
  return project;
}
