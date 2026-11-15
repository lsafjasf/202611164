/* Canvas 可视化：纯函数 FFT + 频谱柱 + 录音波形，便于在 Node 中做逻辑验证。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Visuals = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  function fftRadix2(re, im) {
    const n = re.length;
    if ((n & (n - 1)) !== 0) throw new Error("FFT size must be power of two");
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curR = 1, curI = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = i + k + len / 2;
          const ur = re[a], ui = im[a];
          const vr = re[b] * curR - im[b] * curI;
          const vi = re[b] * curI + im[b] * curR;
          re[a] = ur + vr; im[a] = ui + vi;
          re[b] = ur - vr; im[b] = ui - vi;
          const nextR = curR * wr - curI * wi;
          curI = curR * wi + curI * wr;
          curR = nextR;
        }
      }
    }
  }

  function hannWindow(n) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    return w;
  }

  function magnitudeSpectrum(samples, fftSize) {
    const size = fftSize || 1024;
    const re = new Float32Array(size);
    const im = new Float32Array(size);
    const win = hannWindow(size);
    for (let i = 0; i < size; i++) re[i] = (samples[i] || 0) * win[i];
    fftRadix2(re, im);
    const mag = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / size;
    }
    return mag;
  }

  function peakBin(mag, sampleRate, fftSize) {
    let idx = 0, best = -1;
    for (let i = 1; i < mag.length; i++) {
      if (mag[i] > best) { best = mag[i]; idx = i; }
    }
    return { bin: idx, frequency: (idx * sampleRate) / fftSize, magnitude: best };
  }

  function bandColor(freq) {
    if (freq < 250) return "#4c8dff";
    if (freq < 2000) return "#37b26b";
    return "#e08a2d";
  }

  function drawSpectrum(canvas, mag, sampleRate, fftSize) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#10141c";
    ctx.fillRect(0, 0, w, h);
    const usable = mag.length;
    const barCount = 64;
    const barW = w / barCount;
    let maxV = 1e-6;
    for (let i = 0; i < usable; i++) if (mag[i] > maxV) maxV = mag[i];
    for (let b = 0; b < barCount; b++) {
      const start = Math.floor(Math.pow(b / barCount, 2) * usable);
      const end = Math.max(start + 1, Math.floor(Math.pow((b + 1) / barCount, 2) * usable));
      let v = 0;
      for (let i = start; i < end; i++) v = Math.max(v, mag[i]);
      const norm = Math.min(1, (v / maxV) * 1.35);
      const bh = Math.max(2, norm * (h - 18));
      const freq = (start * sampleRate) / fftSize;
      ctx.fillStyle = bandColor(freq);
      ctx.fillRect(b * barW + 1, h - bh - 14, Math.max(1, barW - 2), bh);
    }
    ctx.fillStyle = "#8b93a7";
    ctx.font = "11px monospace";
    ctx.fillText("0", 4, h - 3);
    ctx.fillText((sampleRate / 2000).toFixed(1) + " kHz", w - 58, h - 3);
  }

  function drawWaveform(canvas, channelData) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#10141c";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#58a6ff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const n = channelData.length;
    const step = Math.max(1, Math.floor(n / w));
    for (let x = 0; x < w; x++) {
      let peak = 0;
      for (let j = 0; j < step; j++) {
        const v = Math.abs(channelData[x * step + j] || 0);
        if (v > peak) peak = v;
      }
      const y = h / 2 - Math.min(1, peak) * (h / 2 - 6);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "#2c3444";
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }

  return {
    fftRadix2: fftRadix2,
    hannWindow: hannWindow,
    magnitudeSpectrum: magnitudeSpectrum,
    peakBin: peakBin,
    drawSpectrum: drawSpectrum,
    drawWaveform: drawWaveform,
    bandColor: bandColor
  };
});
