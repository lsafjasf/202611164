const peakCache = new WeakMap();

function extractPeaks(buffer, bucketCount = 360) {
  const cached = peakCache.get(buffer);
  if (cached && cached.bucketCount === bucketCount) {
    return cached.peaks;
  }
  const channel = buffer.getChannelData(0);
  const second = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : channel;
  const step = Math.max(1, Math.floor(channel.length / bucketCount));
  const peaks = new Float32Array(bucketCount);
  let maximum = 0.0001;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = bucket * step;
    const end = Math.min(channel.length, start + step);
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index] * 0.58 + second[index] * 0.42));
    }
    peaks[bucket] = peak;
    maximum = Math.max(maximum, peak);
  }
  for (let index = 0; index < peaks.length; index += 1) {
    peaks[index] = Math.min(1, peaks[index] / maximum);
  }
  peakCache.set(buffer, { bucketCount, peaks });
  return peaks;
}

export function drawWaveform(canvas, buffer, options = {}) {
  if (!canvas) return;
  const { progress = 0, active = false, complete = false } = options;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width;
  const h = rect.height;
  const center = h / 2;
  context.clearRect(0, 0, w, h);

  context.strokeStyle = active
    ? "rgba(104, 224, 194, 0.14)"
    : "rgba(155, 178, 180, 0.1)";
  context.lineWidth = 1;
  for (let line = 1; line < 4; line += 1) {
    const x = (w / 4) * line;
    context.beginPath();
    context.moveTo(x, 7);
    context.lineTo(x, h - 7);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(0, center);
  context.lineTo(w, center);
  context.stroke();

  if (!buffer) {
    context.strokeStyle = "rgba(155, 178, 180, 0.25)";
    context.setLineDash([3, 5]);
    context.beginPath();
    context.moveTo(0, center);
    context.lineTo(w, center);
    context.stroke();
    context.setLineDash([]);
    return;
  }

  const peaks = extractPeaks(buffer, Math.max(180, Math.floor(w / 2)));
  const played = Math.max(0, Math.min(1, progress));
  const barWidth = Math.max(1, w / peaks.length - 0.6);
  for (let index = 0; index < peaks.length; index += 1) {
    const x = (index / peaks.length) * w;
    const amplitude = Math.max(0.8, peaks[index] * (h * 0.42));
    const isPlayed = index / peaks.length <= played;
    if (active && isPlayed) {
      context.fillStyle = complete ? "#68e0c2" : "#e8b857";
    } else if (active) {
      context.fillStyle = "rgba(232, 184, 87, 0.28)";
    } else {
      context.fillStyle = "rgba(155, 178, 180, 0.38)";
    }
    context.fillRect(x, center - amplitude, barWidth, amplitude * 2);
  }

  if (active) {
    const cursorX = played * w;
    context.fillStyle = "#f1e8d4";
    context.fillRect(cursorX, 4, 1.25, h - 8);
    context.beginPath();
    context.fillStyle = "rgba(232, 184, 87, 0.08)";
    context.fillRect(0, 0, cursorX, h);
  }
}
