// Minimal WebGL renderer: flat-shaded planet, atmosphere shell, cloud layer,
// target markers, route lines. Fixed directional light -> continuous shading.
import { buildIcosphere } from './geometry.js';

const TYPE_COLORS = {
  ocean:  [0.10, 0.25, 0.55],
  beach:  [0.85, 0.78, 0.55],
  grass:  [0.25, 0.62, 0.28],
  forest: [0.12, 0.42, 0.20],
  rock:   [0.45, 0.42, 0.40],
  snow:   [0.92, 0.94, 0.97],
  ice:    [0.80, 0.90, 0.98],
};

const VERT = `
attribute vec3 aPos; attribute vec3 aNormal; attribute vec4 aColor;
uniform mat4 uProj, uView, uModel;
varying vec3 vNormal; varying vec4 vColor;
void main() {
  gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
}`;

const FRAG = `
precision mediump float;
uniform vec3 uLightDir; uniform float uAmbient; uniform float uUnlit;
varying vec3 vNormal; varying vec4 vColor;
void main() {
  float d = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
  float lit = mix(uAmbient + (1.0 - uAmbient) * d, 1.0, uUnlit);
  gl_FragColor = vec4(vColor.rgb * lit, vColor.a);
}`;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error('WebGL 不可用');
    this.gl = gl;
    this.canvas = canvas;
    this.prog = makeProgram(gl, VERT, FRAG);
    this.loc = {};
    for (const n of ['aPos', 'aNormal', 'aColor']) {
      this.loc[n] = gl.getAttribLocation(this.prog, n);
    }
    for (const n of ['uProj', 'uView', 'uModel', 'uLightDir', 'uAmbient', 'uUnlit']) {
      this.loc[n] = gl.getUniformLocation(this.prog, n);
    }
    this.meshes = {};
    this.rotY = 0.6; this.rotX = 0.35;
    this.cloudSpin = 0;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // Rebuild GPU buffers from planet data (call after regeneration).
  buildMeshes(planet) {
    const gl = this.gl;
    const pos = [], nrm = [], col = [];
    for (const chunk of planet.chunks) {
      for (const face of chunk.faces) {
        const [a, b, c] = planet.geo.faces[face.f];
        const va = planet.geo.verts[a], vb = planet.geo.verts[b], vc = planet.geo.verts[c];
        const pa = scale(va, planet.vertRadius[a]);
        const pb = scale(vb, planet.vertRadius[b]);
        const pc = scale(vc, planet.vertRadius[c]);
        const n = faceNormalOf(pa, pb, pc);
        const color = TYPE_COLORS[face.type] || [1, 0, 1];
        for (const p of [pa, pb, pc]) {
          pos.push(p[0], p[1], p[2]);
          nrm.push(n[0], n[1], n[2]);
          col.push(color[0], color[1], color[2], 1);
        }
      }
    }
    this.meshes.surface = this.upload(pos, nrm, col, gl.TRIANGLES);

    // clouds (transparent, above atmosphere)
    const cpos = [], cnrm = [], ccol = [];
    const cr = planet.clouds.radius;
    for (const cf of planet.clouds.faces) {
      const [a, b, c] = planet.geo.faces[cf.f];
      const pa = scale(planet.geo.verts[a], cr), pb = scale(planet.geo.verts[b], cr), pc = scale(planet.geo.verts[c], cr);
      const n = faceNormalOf(pa, pb, pc);
      for (const p of [pa, pb, pc]) {
        cpos.push(p[0], p[1], p[2]);
        cnrm.push(n[0], n[1], n[2]);
        ccol.push(1, 1, 1, cf.alpha);
      }
    }
    this.meshes.clouds = this.upload(cpos, cnrm, ccol, gl.TRIANGLES);

    // atmosphere shell
    const atmo = buildIcosphere(3);
    const apos = [], anrm = [], acol = [];
    const ar = 1 + planet.params.atmoOffset;
    for (const f of atmo.faces) {
      const pa = scale(atmo.verts[f[0]], ar), pb = scale(atmo.verts[f[1]], ar), pc = scale(atmo.verts[f[2]], ar);
      const n = faceNormalOf(pa, pb, pc);
      for (const p of [pa, pb, pc]) {
        apos.push(p[0], p[1], p[2]);
        anrm.push(n[0], n[1], n[2]);
        acol.push(0.45, 0.65, 1.0, 0.07);
      }
    }
    this.meshes.atmosphere = this.upload(apos, anrm, acol, gl.TRIANGLES);

    this.buildMarkers(planet);
  }

  buildMarkers(planet) {
    const gl = this.gl;
    const pos = [], nrm = [], col = [];
    const pushOcta = (center, size, color) => {
      const up = center; // radial direction
      const t1 = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = norm(cross(up, t1));
      const w = norm(cross(up, u));
      const base = scale(up, 1.01);
      const top = scale(up, 1.01 + size * 2.2);
      const ring = [1, 0.5, 0, -0.5, -1, -0.5].map((s, i) => {
        const ang = i * Math.PI / 3;
        const dx = Math.cos(ang) * size, dz = Math.sin(ang) * size;
        return [
          base[0] + u[0] * dx + w[0] * dz,
          base[1] + u[1] * dx + w[1] * dz,
          base[2] + u[2] * dx + w[2] * dz,
        ];
      });
      for (let i = 0; i < 6; i++) {
        const a = ring[i], b = ring[(i + 1) % 6];
        const n = faceNormalOf(top, a, b);
        for (const p of [top, a, b]) {
          pos.push(p[0], p[1], p[2]);
          nrm.push(n[0], n[1], n[2]);
          col.push(color[0], color[1], color[2], 1);
        }
      }
    };
    for (const o of planet.objects) pushOcta(o.pos, 0.022, [1.0, 0.8, 0.1]);
    for (const o of planet.obstacles) pushOcta(o.pos, 0.03, [0.85, 0.15, 0.1]);
    this.meshes.markers = this.upload(pos, nrm, col, gl.TRIANGLES);

    // route lines
    const lpos = [], lnrm = [], lcol = [];
    for (const r of planet.routes) {
      if (!r.ok) continue;
      for (let i = 0; i + 1 < r.path.length; i++) {
        const a = scale(planet.faceCenter(r.path[i]), 1.012);
        const b = scale(planet.faceCenter(r.path[i + 1]), 1.012);
        lpos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        lnrm.push(0, 1, 0, 0, 1, 0);
        lcol.push(1, 0.3, 0.9, 1, 1, 0.3, 0.9, 1);
      }
    }
    this.meshes.routes = this.upload(lpos, lnrm, lcol, gl.LINES);
  }

  upload(pos, nrm, col, mode) {
    const gl = this.gl;
    const mk = (data, loc, size) => {
      if (data.length === 0) return null;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      return { buf, loc, size };
    };
    return {
      attrs: [mk(pos, 'aPos', 3), mk(nrm, 'aNormal', 3), mk(col, 'aColor', 4)].filter(Boolean),
      count: pos.length / 3,
      mode,
    };
  }

  drawMesh(mesh, model, opts = {}) {
    if (!mesh || mesh.count === 0) return;
    const gl = this.gl;
    gl.uniformMatrix4fv(this.loc.uModel, false, model);
    gl.uniform1f(this.loc.uAmbient, opts.ambient ?? 0.28);
    gl.uniform1f(this.loc.uUnlit, opts.unlit ? 1 : 0);
    if (opts.depthWrite === false) gl.depthMask(false);
    for (const a of mesh.attrs) {
      gl.bindBuffer(gl.ARRAY_BUFFER, a.buf);
      gl.enableVertexAttribArray(this.loc[a.loc]);
      gl.vertexAttribPointer(this.loc[a.loc], a.size, gl.FLOAT, false, 0, 0);
    }
    gl.drawArrays(mesh.mode, 0, mesh.count);
    if (opts.depthWrite === false) gl.depthMask(true);
  }

  render(dt, autoRotateSpeed) {
    const gl = this.gl;
    this.rotY += autoRotateSpeed * dt;
    this.cloudSpin += autoRotateSpeed * dt * 0.25;
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.02, 0.03, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    const proj = mat4Perspective(Math.PI / 4, w / h, 0.1, 10);
    const view = mat4LookAt([0, 0, 2.6], [0, 0, 0], [0, 1, 0]);
    gl.uniformMatrix4fv(this.loc.uProj, false, proj);
    gl.uniformMatrix4fv(this.loc.uView, false, view);
    gl.uniform3fv(this.loc.uLightDir, [-0.55, 0.35, 0.75]);

    const model = mat4Mul(mat4RotX(this.rotX), mat4RotY(this.rotY));
    this.drawMesh(this.meshes.surface, model);
    this.drawMesh(this.meshes.markers, model, { unlit: true });
    this.drawMesh(this.meshes.routes, model, { unlit: true });
    this.drawMesh(this.meshes.atmosphere, model, { depthWrite: false, unlit: true });
    const cloudModel = mat4Mul(model, mat4RotY(this.cloudSpin));
    this.drawMesh(this.meshes.clouds, cloudModel, { depthWrite: false, ambient: 0.45 });
  }

  screenshot(filename = 'planet.png') {
    const a = document.createElement('a');
    a.href = this.canvas.toDataURL('image/png');
    a.download = filename;
    a.click();
  }
}

// ---- small math helpers ----
function scale(v, s) { return [v[0] * s, v[1] * s, v[2] * s]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function faceNormalOf(a, b, c) {
  return norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
}

function makeProgram(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s));
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p));
  }
  return p;
}

function mat4Perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function mat4LookAt(eye, center, up) {
  const z = norm([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1,
  ]);
}

function mat4RotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}
function mat4RotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}
function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      out[i * 4 + j] = s;
    }
  }
  return out;
}
