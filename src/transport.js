export class TransportClock {
  constructor({ duration = 20, speed = 1 } = {}) {
    this.duration = duration;
    this.speed = speed;
    this.playing = false;
    this.baseContextTime = 0;
    this.basePosition = 0;
  }

  setDuration(duration) {
    this.duration = Math.max(0.1, duration);
    this.basePosition = Math.min(this.basePosition, this.duration - 1e-6);
  }

  play(contextTime) {
    if (this.playing) return this.positionAt(contextTime);
    this.baseContextTime = contextTime;
    this.playing = true;
    return this.basePosition;
  }

  pause(contextTime) {
    if (this.playing) {
      this.basePosition = this.positionAt(contextTime);
      this.playing = false;
    }
    return this.basePosition;
  }

  seek(position, contextTime) {
    this.basePosition = this.wrap(position);
    this.baseContextTime = contextTime;
    return this.basePosition;
  }

  setSpeed(speed, contextTime) {
    if (this.playing) {
      this.basePosition = this.positionAt(contextTime);
      this.baseContextTime = contextTime;
    }
    this.speed = Math.max(0.1, speed);
    return this.basePosition;
  }

  wrap(position) {
    const wrapped = position % this.duration;
    return wrapped < 0 ? wrapped + this.duration : wrapped;
  }

  rawPositionAt(contextTime) {
    if (!this.playing) return this.basePosition;
    return this.basePosition + Math.max(0, contextTime - this.baseContextTime) * this.speed;
  }

  positionAt(contextTime) {
    return this.wrap(this.rawPositionAt(contextTime));
  }
}

export function beatAt(seconds, bpm) {
  return seconds / (60 / bpm);
}

export function secondsPerBeat(bpm) {
  return 60 / Math.max(1, bpm);
}

export function signedBeatError(actual, expected, bpm) {
  return (actual - expected) / secondsPerBeat(bpm);
}
