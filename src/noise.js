// Seeded 2D value noise with fractal Brownian motion (fBm).

import { Rng } from './rng.js';

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class ValueNoise2D {
  constructor(seed, gridSize = 16) {
    const rng = new Rng(seed);
    this.gridSize = gridSize;
    this.values = new Float64Array((gridSize + 1) * (gridSize + 1));
    for (let i = 0; i < this.values.length; i++) this.values[i] = rng.next();
  }

 at(x, y) {
    const gx = x / this.gridSize;
    const gy = y / this.gridSize;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = smooth(gx - x0);
    const ty = smooth(gy - y0);
    const w = this.gridSize + 1;
    const v00 = this.values[y0 * w + x0];
    const v10 = this.values[y0 * w + x0 + 1];
    const v01 = this.values[(y0 + 1) * w + x0];
    const v11 = this.values[(y0 + 1) * w + x0 + 1];
    return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
  }

  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amplitude * this.at(x * frequency, y * frequency);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }
}
