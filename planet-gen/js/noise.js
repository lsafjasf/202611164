// Seeded 3D value noise + fBm. Deterministic given the same seed.
import { mulberry32 } from './rng.js';

export class Noise3D {
  constructor(seed) {
    const rng = mulberry32(seed >>> 0);
    const perm = new Uint8Array(512);
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = base[i]; base[i] = base[j]; base[j] = t;
    }
    for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
    this.perm = perm;
    // Gradient-free value noise: hash lattice points to [0,1).
    this.vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.vals[i] = rng();
  }

  lattice(ix, iy, iz) {
    const p = this.perm;
    const h = p[(p[(p[ix & 255] + iy) & 255] + iz) & 255];
    return this.vals[h];
  }

  noise(x, y, z) {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const sz = fz * fz * (3 - 2 * fz);
    const lerp = (a, b, t) => a + (b - a) * t;
    const c000 = this.lattice(x0, y0, z0),     c100 = this.lattice(x0 + 1, y0, z0);
    const c010 = this.lattice(x0, y0 + 1, z0), c110 = this.lattice(x0 + 1, y0 + 1, z0);
    const c001 = this.lattice(x0, y0, z0 + 1), c101 = this.lattice(x0 + 1, y0, z0 + 1);
    const c011 = this.lattice(x0, y0 + 1, z0 + 1), c111 = this.lattice(x0 + 1, y0 + 1, z0 + 1);
    return lerp(
      lerp(lerp(c000, c100, sx), lerp(c010, c110, sx), sy),
      lerp(lerp(c001, c101, sx), lerp(c011, c111, sx), sy),
      sz
    );
  }

  fbm(x, y, z, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm; // [0,1]
  }
}
