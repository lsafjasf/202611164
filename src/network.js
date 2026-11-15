// Route network: deterministic MST over objects with incremental recomputation.

import { findPath, euclidean } from './pathfinding.js';
import { canonicalHash, toHex, fnv1a } from './hash.js';

function edgeKey(a, b) {
  return [a, b].sort().join('~');
}

export function edgeHash(aId, bId, path) {
  return canonicalHash({
    edge: edgeKey(aId, bId),
    length: path.length,
    end: path[path.length - 1],
  });
}

// All-pairs reachable edges, each weighted by actual grid path length.
function buildEdgeCandidates(terrain, objects) {
  const candidates = [];
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const path = findPath(terrain, objects[i], objects[j]);
      if (path) {
        candidates.push({
          a: objects[i].id,
          b: objects[j].id,
          path,
          length: path.length,
          straight: euclidean(objects[i].x, objects[i].y, objects[j].x, objects[j].y),
        });
      }
    }
  }
  // Deterministic ordering: shortest path, then straight distance, then key.
  candidates.sort((p, q) =>
    p.length - q.length ||
    p.straight - q.straight ||
    edgeKey(p.a, p.b).localeCompare(edgeKey(q.a, q.b)));
  return candidates;
}

export function buildNetwork(terrain, objects) {
  const candidates = buildEdgeCandidates(terrain, objects);
  const parent = new Map(objects.map((o) => [o.id, o.id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  const edges = new Map();
  for (const cand of candidates) {
    const ra = find(cand.a);
    const rb = find(cand.b);
    if (ra === rb) continue;
    parent.set(ra, rb);
    edges.set(edgeKey(cand.a, cand.b), {
      a: cand.a,
      b: cand.b,
      path: cand.path,
      hash: edgeHash(cand.a, cand.b, cand.path),
    });
  }
  return edges;
}

function incidentEdgeKeys(edges, objectId) {
  const keys = [];
  for (const key of edges.keys()) {
    const [a, b] = key.split('~');
    if (a === objectId || b === objectId) keys.push(key);
  }
  return keys;
}

// Recompute only edges incident to a moved object; all other edge hashes stay.
export function recomputeIncident(terrain, objects, edges, movedId) {
  const removed = [];
  for (const key of incidentEdgeKeys(edges, movedId)) {
    removed.push(edges.get(key));
    edges.delete(key);
  }

  const byId = new Map(objects.map((o) => [o.id, o]));
  const connectedRoots = connectedComponents(objects, edges);
  const moved = byId.get(movedId);
  const result = { blocked: [], rebuilt: [] };

  // Reconnect each component that lost its link with a fresh shortest path.
  for (const root of connectedRoots) {
    if (root.has(movedId)) continue;
    let best = null;
    for (const targetId of root) {
      const target = byId.get(targetId);
      const path = findPath(terrain, moved, target);
      if (path) {
        const candidate = {
          length: path.length,
          straight: euclidean(moved.x, moved.y, target.x, target.y),
          targetId,
          path,
        };
        if (!best || candidate.length < best.length ||
          (candidate.length === best.length && candidate.straight < best.straight)) {
          best = candidate;
        }
      }
    }
    if (!best) {
      result.blocked.push(...reportBlocked(root, movedId, byId));
      continue;
    }
    const key = edgeKey(movedId, best.targetId);
    edges.set(key, {
      a: movedId,
      b: best.targetId,
      path: best.path,
      hash: edgeHash(movedId, best.targetId, best.path),
    });
    result.rebuilt.push(key);
  }
  return result;
}

function connectedComponents(objects, edges) {
  const adjacency = new Map(objects.map((o) => [o.id, []]));
  for (const edge of edges.values()) {
    adjacency.get(edge.a).push(edge.b);
    adjacency.get(edge.b).push(edge.a);
  }
  const seen = new Set();
  const components = [];
  for (const obj of objects) {
    if (seen.has(obj.id)) continue;
    const component = new Set();
    const stack = [obj.id];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      component.add(id);
      stack.push(...adjacency.get(id));
    }
    components.push(component);
  }
  return components;
}

function reportBlocked(root, movedId, byId) {
  const moved = byId.get(movedId);
  const reports = [];
  for (const targetId of root) {
    const target = byId.get(targetId);
    reports.push({
      from: movedId,
      to: targetId,
      fromPos: { x: moved.x, y: moved.y },
      toPos: { x: target.x, y: target.y },
    });
  }
  return reports;
}

// After terrain edits, verify every existing edge and mark severed ones.
export function verifyNetwork(terrain, objects, edges) {
  const blocked = [];
  for (const [key, edge] of [...edges.entries()]) {
    const path = findPath(terrain, { x: edge.path[0].x, y: edge.path[0].y },
      edge.path[edge.path.length - 1]);
    if (!path) {
      blocked.push({
        edge: key,
        from: edge.a,
        to: edge.b,
        fromPos: { x: edge.path[0].x, y: edge.path[0].y },
        toPos: { x: edge.path[edge.path.length - 1].x, y: edge.path[edge.path.length - 1].y },
      });
      edges.delete(key);
    } else if (path.length !== edge.path.length) {
      edge.path = path;
      edge.hash = edgeHash(edge.a, edge.b, path);
    }
  }
  return blocked;
}

export function networkFingerprint(edges) {
  return toHex(fnv1a([...edges.values()].map((e) => e.hash).sort().join('|')));
}
