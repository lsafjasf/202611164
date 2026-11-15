import {
  ANIMATABLE_PROPS,
  ASSET_TYPES,
  EASINGS,
  LAYER_TYPES,
  PROJECT_VERSION,
} from './model.js';

const LAYER_FIELDS = new Set([
  'id', 'name', 'type', 'visible', 'locked', 'x', 'y', 'width', 'height',
  'opacity', 'rotation', 'fill', 'assetId', 'text', 'fontSize', 'keyframes',
]);
const ASSET_FIELDS = new Set(['id', 'name', 'type', 'mimeType', 'src', 'duration', 'params']);
const KEYFRAME_FIELDS = new Set(['id', 'time', 'easing', 'props']);
const PROJECT_FIELDS = new Set([
  'version', 'id', 'name', 'createdAt', 'updatedAt', 'timeline',
  'assets', 'layers', 'selection',
]);

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function pushError(errors, code, path, message) {
  errors.push({ code, path, message });
}

function checkKnownFields(errors, path, object, known) {
  for (const key of Object.keys(object)) {
    if (!known.has(key)) {
      pushError(errors, 'unknown-field', `${path}.${key}`, `未知字段 "${key}"`);
    }
  }
}

function checkType(errors, path, value, predicate, expected) {
  if (!predicate(value)) {
    pushError(errors, 'illegal-type', path, `期望 ${expected}，实际为 ${value === null ? 'null' : typeof value}`);
    return false;
  }
  return true;
}

export function validateProject(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return {
      valid: false,
      errors: [{ code: 'illegal-type', path: '$', message: '工程必须是 JSON 对象' }],
    };
  }
  checkKnownFields(errors, '$', input, PROJECT_FIELDS);

  if (input.version !== PROJECT_VERSION) {
    pushError(errors, 'unsupported-version', '$.version', `不支持的版本: ${String(input.version)}`);
  }
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    pushError(errors, 'illegal-type', '$.id', '工程 id 必须是非空字符串');
  }
  if (typeof input.name !== 'string') {
    pushError(errors, 'illegal-type', '$.name', '工程名称必须是字符串');
  }

  const timeline = input.timeline;
  if (!isPlainObject(timeline)) {
    pushError(errors, 'illegal-type', '$.timeline', 'timeline 必须是对象');
  } else {
    if (!isFiniteNumber(timeline.duration) || timeline.duration <= 0 || timeline.duration > 3600) {
      pushError(errors, 'out-of-range', '$.timeline.duration', '时长必须在 (0, 3600] 秒之间');
    }
    if (!Number.isInteger(timeline.fps) || timeline.fps < 1 || timeline.fps > 240) {
      pushError(errors, 'out-of-range', '$.timeline.fps', '帧率必须是 [1, 240] 内的整数');
    }
    if (typeof timeline.loop !== 'boolean') {
      pushError(errors, 'illegal-type', '$.timeline.loop', 'loop 必须是布尔值');
    }
  }

  const seenIds = new Map();
  const registerId = (id, path) => {
    if (typeof id !== 'string' || id.trim() === '') {
      pushError(errors, 'illegal-type', path, 'id 必须是非空字符串');
      return;
    }
    if (seenIds.has(id)) {
      pushError(errors, 'duplicate-id', path, `重复的对象 id: ${id}（另见 ${seenIds.get(id)}）`);
    } else {
      seenIds.set(id, path);
    }
  };

  const assets = input.assets;
  const assetIds = new Set();
  if (!Array.isArray(assets)) {
    pushError(errors, 'illegal-type', '$.assets', 'assets 必须是数组');
  } else {
    assets.forEach((asset, index) => {
      const path = `$.assets[${index}]`;
      if (!isPlainObject(asset)) {
        pushError(errors, 'illegal-type', path, '素材必须是对象');
        return;
      }
      checkKnownFields(errors, path, asset, ASSET_FIELDS);
      registerId(asset.id, `${path}.id`);
      assetIds.add(asset.id);
      if (!ASSET_TYPES.includes(asset.type)) {
        pushError(errors, 'illegal-type', `${path}.type`, `非法素材类型: ${String(asset.type)}`);
      }
      if (typeof asset.name !== 'string') {
        pushError(errors, 'illegal-type', `${path}.name`, '素材名称必须是字符串');
      }
      if (typeof asset.src !== 'string' || asset.src.trim() === '') {
        pushError(errors, 'illegal-type', `${path}.src`, '素材 src 必须是非空字符串');
      }
      if (asset.duration !== null && (!isFiniteNumber(asset.duration) || asset.duration < 0)) {
        pushError(errors, 'out-of-range', `${path}.duration`, '素材时长必须为 null 或非负数');
      }
      if (!isPlainObject(asset.params)) {
        pushError(errors, 'illegal-type', `${path}.params`, '素材参数必须是对象');
      }
    });
  }

  const layers = input.layers;
  const layerIds = new Set();
  const validateNumber = (path, value, min, max) => {
    if (!isFiniteNumber(value) || value < min || value > max) {
      pushError(errors, 'out-of-range', path, `数值必须在 [${min}, ${max}] 内`);
    }
  };

  if (!Array.isArray(layers)) {
    pushError(errors, 'illegal-type', '$.layers', 'layers 必须是数组');
  } else {
    layers.forEach((layer, index) => {
      const path = `$.layers[${index}]`;
      if (!isPlainObject(layer)) {
        pushError(errors, 'illegal-type', path, '图层必须是对象');
        return;
      }
      checkKnownFields(errors, path, layer, LAYER_FIELDS);
      registerId(layer.id, `${path}.id`);
      layerIds.add(layer.id);
      if (!LAYER_TYPES.includes(layer.type)) {
        pushError(errors, 'illegal-type', `${path}.type`, `非法图层类型: ${String(layer.type)}`);
      }
      if (typeof layer.name !== 'string') {
        pushError(errors, 'illegal-type', `${path}.name`, '图层名称必须是字符串');
      }
      if (typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') {
        pushError(errors, 'illegal-type', path, 'visible/locked 必须是布尔值');
      }
      validateNumber(`${path}.x`, layer.x, -10000, 10000);
      validateNumber(`${path}.y`, layer.y, -10000, 10000);
      validateNumber(`${path}.width`, layer.width, 0, 10000);
      validateNumber(`${path}.height`, layer.height, 0, 10000);
      validateNumber(`${path}.opacity`, layer.opacity, 0, 1);
      validateNumber(`${path}.rotation`, layer.rotation, -360, 360);
      if (typeof layer.fill !== 'string') {
        pushError(errors, 'illegal-type', `${path}.fill`, '填充色必须是字符串');
      }
      if (layer.assetId !== null && layer.assetId !== undefined) {
        if (typeof layer.assetId !== 'string' || !assetIds.has(layer.assetId)) {
          pushError(errors, 'dangling-reference', `${path}.assetId`, `悬空素材引用: ${String(layer.assetId)}`);
        }
      }
      if (layer.type === 'text' && typeof layer.text !== 'string') {
        pushError(errors, 'illegal-type', `${path}.text`, '文字图层必须包含 text 字符串');
      }
      validateNumber(`${path}.fontSize`, layer.fontSize, 1, 500);

      if (!Array.isArray(layer.keyframes)) {
        pushError(errors, 'illegal-type', `${path}.keyframes`, '关键帧必须是数组');
        return;
      }
      const times = new Set();
      layer.keyframes.forEach((keyframe, kfIndex) => {
        const kfPath = `${path}.keyframes[${kfIndex}]`;
        if (!isPlainObject(keyframe)) {
          pushError(errors, 'illegal-type', kfPath, '关键帧必须是对象');
          return;
        }
        checkKnownFields(errors, kfPath, keyframe, KEYFRAME_FIELDS);
        registerId(keyframe.id, `${kfPath}.id`);
        if (!isFiniteNumber(keyframe.time) || keyframe.time < 0) {
          pushError(errors, 'out-of-range', `${kfPath}.time`, '关键帧时间必须是非负数字');
        } else if (isPlainObject(timeline) && keyframe.time > timeline.duration) {
          pushError(errors, 'out-of-range', `${kfPath}.time`, '关键帧时间超出时间轴时长');
        }
        if (times.has(keyframe.time)) {
          pushError(errors, 'duplicate-keyframe-time', kfPath, `图层内重复的关键帧时间: ${keyframe.time}`);
        }
        times.add(keyframe.time);
        if (!EASINGS.includes(keyframe.easing)) {
          pushError(errors, 'illegal-type', `${kfPath}.easing`, `非法缓动类型: ${String(keyframe.easing)}`);
        }
        if (!isPlainObject(keyframe.props)) {
          pushError(errors, 'illegal-type', `${kfPath}.props`, '关键帧属性必须是对象');
          return;
        }
        for (const prop of Object.keys(keyframe.props)) {
          if (!ANIMATABLE_PROPS.includes(prop)) {
            pushError(errors, 'illegal-type', `${kfPath}.props.${prop}`, `不可动画的属性: ${prop}`);
          } else if (!isFiniteNumber(keyframe.props[prop])) {
            pushError(errors, 'illegal-type', `${kfPath}.props.${prop}`, '关键帧属性值必须是数字');
          }
        }
      });
    });
  }

  const selection = input.selection;
  if (!isPlainObject(selection)) {
    pushError(errors, 'illegal-type', '$.selection', 'selection 必须是对象');
  } else {
    if (selection.layerId !== null && (typeof selection.layerId !== 'string' || !layerIds.has(selection.layerId))) {
      pushError(errors, 'dangling-reference', '$.selection.layerId', `悬空图层选择: ${String(selection.layerId)}`);
    }
    if (!isFiniteNumber(selection.currentTime) || selection.currentTime < 0) {
      pushError(errors, 'out-of-range', '$.selection.currentTime', '当前时间必须是非负数字');
    }
  }

  if (typeof input.createdAt !== 'string' || Number.isNaN(Date.parse(input.createdAt))) {
    pushError(errors, 'illegal-type', '$.createdAt', 'createdAt 必须是合法时间字符串');
  }
  if (typeof input.updatedAt !== 'string' || Number.isNaN(Date.parse(input.updatedAt))) {
    pushError(errors, 'illegal-type', '$.updatedAt', 'updatedAt 必须是合法时间字符串');
  }

  return { valid: errors.length === 0, errors };
}

export function validateEnvelope(envelope) {
  if (!isPlainObject(envelope)) {
    return { valid: false, errors: [{ code: 'illegal-type', path: '$', message: '导出包必须是 JSON 对象' }] };
  }
  if (envelope.format !== 'editor-project') {
    return {
      valid: false,
      errors: [{ code: 'illegal-type', path: '$.format', message: `非法导出格式: ${String(envelope.format)}` }],
    };
  }
  return validateProject(envelope.project);
}
