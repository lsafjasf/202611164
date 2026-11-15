import { ANIMATABLE_PROPS } from './model.js';

export function easeRatio(ratio, easing) {
  if (easing === 'hold') return 0;
  if (easing === 'linear') return ratio;
  if (easing === 'easeIn') return ratio * ratio;
  if (easing === 'easeOut') return ratio * (2 - ratio);
  if (easing === 'easeInOut') {
    return ratio < 0.5 ? 2 * ratio * ratio : -1 + (4 - 2 * ratio) * ratio;
  }
  return ratio;
}

export function interpolateKeyframes(keyframes, time) {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const values = {};
  if (sorted.length === 0) return values;

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  for (const prop of ANIMATABLE_PROPS) {
    if (prop in first.props) values[prop] = first.props[prop];
    if (time >= last.time && prop in last.props) values[prop] = last.props[prop];
  }
  if (time <= first.time) return { ...first.props };

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    if (time < start.time || time > end.time) continue;
    const span = end.time - start.time;
    const rawRatio = span === 0 ? 1 : (time - start.time) / span;
    const ratio = easeRatio(rawRatio, end.easing);
    for (const prop of ANIMATABLE_PROPS) {
      if (prop in start.props && prop in end.props) {
        values[prop] = start.props[prop] + (end.props[prop] - start.props[prop]) * ratio;
      }
    }
  }
  return values;
}

export function evaluateAt(project, time) {
  return project.layers.map((layer) => {
    const animated = interpolateKeyframes(layer.keyframes, time);
    return {
      ...layer,
      x: animated.x ?? layer.x,
      y: animated.y ?? layer.y,
      width: animated.width ?? layer.width,
      height: animated.height ?? layer.height,
      opacity: animated.opacity ?? layer.opacity,
      rotation: animated.rotation ?? layer.rotation,
    };
  });
}

export function clampTime(project, time) {
  const duration = project.timeline.duration;
  if (project.timeline.loop) {
    return ((time % duration) + duration) % duration;
  }
  return Math.min(Math.max(time, 0), duration);
}
