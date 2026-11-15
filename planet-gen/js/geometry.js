// Icosphere geometry, chunked by base icosahedron face for incremental recompute.

export function buildIcosphere(detail, chunkLevel = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalize);
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  // Track which base face each triangle descends from -> chunk id.
  let chunkOf = faces.map((_, i) => i);
  const effChunkLevel = Math.min(chunkLevel, detail);

  for (let d = 0; d < detail; d++) {
    const midCache = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? a + '_' + b : b + '_' + a;
      let idx = midCache.get(key);
      if (idx !== undefined) return idx;
      const va = verts[a], vb = verts[b];
      idx = verts.length;
      verts.push(normalize([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]));
      midCache.set(key, idx);
      return idx;
    };
    const newFaces = [], newChunk = [];
    for (let f = 0; f < faces.length; f++) {
      const [a, b, c] = faces[f];
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      newFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      if (d < effChunkLevel) {
        // each face at this level becomes its own chunk
        const base = newFaces.length - 4;
        newChunk.push(base, base + 1, base + 2, base + 3);
      } else {
        newChunk.push(chunkOf[f], chunkOf[f], chunkOf[f], chunkOf[f]);
      }
    }
    faces = newFaces;
    chunkOf = newChunk;
  }
  return { verts, faces, chunkOf, chunkCount: 20 * Math.pow(4, effChunkLevel), detail };
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  return normalize(n);
}

// Adjacency between faces (share an edge).
export function buildFaceAdjacency(faces) {
  const edgeMap = new Map();
  const adj = faces.map(() => []);
  faces.forEach((f, fi) => {
    for (let e = 0; e < 3; e++) {
      const a = f[e], b = f[(e + 1) % 3];
      const key = a < b ? a + '_' + b : b + '_' + a;
      const other = edgeMap.get(key);
      if (other !== undefined) {
        adj[fi].push(other);
        adj[other].push(fi);
      } else {
        edgeMap.set(key, fi);
      }
    }
  });
  return adj;
}
