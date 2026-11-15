import { createProject } from './model.js';

export function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

export function toCanonicalJSON(project) {
  return JSON.stringify(canonicalize(project));
}

export function toPrettyJSON(project) {
  return `${JSON.stringify(canonicalize(project), null, 2)}\n`;
}

async function sha256Node(text) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function sha256Web(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256(text) {
  if (typeof globalThis.process !== 'undefined' && process.versions && process.versions.node) {
    return sha256Node(text);
  }
  return sha256Web(text);
}

export async function projectHash(project) {
  return sha256(toCanonicalJSON(project));
}

export function countObjects(project) {
  const keyframes = project.layers.reduce(
    (total, layer) => total + (Array.isArray(layer.keyframes) ? layer.keyframes.length : 0),
    0,
  );
  return {
    projects: 1,
    assets: project.assets.length,
    layers: project.layers.length,
    keyframes,
    total: 1 + project.assets.length + project.layers.length + keyframes,
  };
}

export function createExportEnvelope(project) {
  const counts = countObjects(project);
  return {
    format: 'editor-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    counts,
    project: cloneProject(project),
  };
}

export function normalizeProject(raw) {
  return createProject(cloneProject(raw));
}
