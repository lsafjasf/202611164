/*
 * 纯时间数学模块：所有节拍位置都由「锚点 + 整数序号 × 间隔」推导，
 * 不使用累加形式，因此暂停/恢复、变速、循环、变调都不会累积偏移。
 * 该模块不依赖 DOM 或 Web Audio，可在 Node 中独立测试。
 */

export function spbFromBpm(bpm, speed = 1) {
  return 60 / (bpm * speed);
}

export function beatTime(anchor, index, spb) {
  return anchor + index * spb;
}

export function beatIndexAt(time, anchor, spb) {
  return Math.floor((time - anchor) / spb);
}

export function retuneAnchor(now, anchor, oldSpb, newSpb) {
  const posBeats = (now - anchor) / oldSpb;
  return now - posBeats * newSpb;
}

export function loopPosition(globalIndex, loopBeats) {
  return ((globalIndex % loopBeats) + loopBeats) % loopBeats;
}

export function semitoneRatio(semitones) {
  return Math.pow(2, semitones / 12);
}
