import { mulberry32 } from './engine.js';

export const MAZE_DEPTH = 6;
export const CHECKPOINT_DEPTHS = [2, 4, 6];
export const MAX_PROBES = 2;

/*
 * 不可见迷宫：深度 6 的二叉通道，只有一条正确路径。
 * 玩家依靠左右声道（声像）、回响时间（距离）、音高（深度）判断出口。
 */
export class Maze {
  constructor(seed = Date.now()) {
    this.seed = seed;
    const rand = mulberry32(seed);
    this.correctPath = [];
    for (let i = 0; i < MAZE_DEPTH; i += 1) {
      this.correctPath.push(rand() < 0.5 ? 'L' : 'R');
    }
    this.depth = 0;
    this.errors = 0;
    this.inWrongNode = false;
    this.probesLeft = MAX_PROBES;
    this.checkpoints = 0;
    this.moves = [];
    this.submitted = false;
  }

  echoTime() {
    const remaining = MAZE_DEPTH - this.depth;
    return 0.08 + remaining * 0.04;
  }

  wrongEchoTime() {
    return this.echoTime() + 0.12;
  }

  cueSpec() {
    const dir = this.correctPath[this.depth];
    return {
      pan: dir === 'L' ? -0.8 : 0.8,
      semis: this.depth * 2,
      echoTime: this.echoTime(),
    };
  }

  probe() {
    if (this.probesLeft <= 0 || this.inWrongNode || this.submitted) return null;
    this.probesLeft -= 1;
    const dir = this.correctPath[this.depth];
    const good = this.echoTime();
    const bad = this.wrongEchoTime();
    return {
      L: { pan: -0.9, echoTime: dir === 'L' ? good : bad },
      R: { pan: 0.9, echoTime: dir === 'R' ? good : bad },
    };
  }

  choose(choice) {
    if (this.submitted || this.inWrongNode || this.depth >= MAZE_DEPTH) return null;
    const correct = choice === this.correctPath[this.depth];
    this.moves.push({ choice, correct });
    let checkpoint = false;
    if (correct) {
      this.depth += 1;
      if (CHECKPOINT_DEPTHS.includes(this.depth)) {
        this.checkpoints += 1;
        checkpoint = true;
      }
    } else {
      this.errors += 1;
      this.inWrongNode = true;
    }
    return {
      correct,
      checkpoint,
      done: this.depth >= MAZE_DEPTH,
      noiseLevel: this.noiseLevel(),
    };
  }

  back() {
    if (!this.inWrongNode || this.submitted) return false;
    this.inWrongNode = false;
    return true;
  }

  noiseLevel() {
    return Math.min(1, this.errors * 0.2);
  }

  canSubmit() {
    return !this.submitted && this.depth >= MAZE_DEPTH && this.checkpoints === 3;
  }

  submit() {
    if (!this.canSubmit()) return null;
    this.submitted = true;
    return {
      correctPath: [...this.correctPath],
      moves: [...this.moves],
      errors: this.errors,
      probesUsed: MAX_PROBES - this.probesLeft,
    };
  }
}
