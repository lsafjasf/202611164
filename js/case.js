import { makeRng } from './rng.js';

export const SEGMENT_COUNT = 4;
export const DIRECTION_TARGET_COUNT = 2;

// Deterministically builds a case from a seed.
// Each of the 4 broadcasts hides:
//  - order: transport position 1..4, encoded as harbor-bell strike count (time anchor)
//  - pan: 'left' | 'right' stereo position of horn/machinery/footsteps
//  - timbre params: hornFreq, hornCount, machineryRate, footstepRate, anchorOffset
export function generateCase(seed) {
  const rng = makeRng(seed);
  const orderPerm = rng.shuffle([1, 2, 3, 4]); // orderPerm[i] = true order of segment i
  const ids = [0, 1, 2, 3];
  const directionTargets = rng.shuffle(ids).slice(0, DIRECTION_TARGET_COUNT).sort();

  const segments = ids.map((id) => {
    const order = orderPerm[id];
    return {
      id,
      label: `广播${'①②③④'[id]}`,
      order, // true transport position (1..4)
      bellCount: order, // time anchor: bell strikes == transport order
      anchorOffset: 1.2 + id * 0.35 + rng.next() * 0.4, // seconds, first bell
      pan: rng.next() < 0.5 ? 'left' : 'right',
      panValue: 0, // filled below
      hornFreq: 70 + rng.int(0, 8) * 12, // 70..166 Hz fundamental
      hornCount: rng.int(2, 3),
      machineryRate: 1.2 + rng.int(0, 5) * 0.35, // clanks per second
      footstepRate: 1.6 + rng.int(0, 4) * 0.4, // steps per second
      duration: 9,
    };
  });
  for (const s of segments) s.panValue = s.pan === 'left' ? -0.85 : 0.85;

  return {
    seed,
    segments,
    directionTargets, // segment ids whose pan must be identified
    rules: {
      maxAttempts: 3 + rng.int(0, 1),
      penaltyPerFail: rng.pick([100, 150, 200]),
      baseScore: 1000,
    },
  };
}

// submission: { order: [segIdAtPos1, segIdAtPos2, segIdAtPos3, segIdAtPos4],
//               directions: { [segId]: 'left'|'right' } }
export function evaluate(caseData, submission) {
  const { segments, directionTargets } = caseData;
  const byId = new Map(segments.map((s) => [s.id, s]));

  const orderCorrect = submission.order.map((segId, pos) => byId.get(segId).order === pos + 1);
  const wrongPositions = orderCorrect
    .map((ok, i) => (ok ? null : i + 1))
    .filter((p) => p !== null);

  const directionResults = {};
  for (const id of directionTargets) {
    directionResults[id] = submission.directions[id] === byId.get(id).pan;
  }
  const wrongDirections = directionTargets.filter((id) => !directionResults[id]);

  const solved = wrongPositions.length === 0 && wrongDirections.length === 0;

  const hints = [];
  if (wrongPositions.length > 0) {
    hints.push(
      `顺序维度有误：位置 ${wrongPositions.join('、')} 的货柜判断不正确——请重听各段的时间锚点（港口钟声敲击次数，次数即运走次序）。`
    );
  }
  if (wrongDirections.length > 0) {
    const names = wrongDirections.map((id) => byId.get(id).label).join('、');
    hints.push(`方位维度有误：${names} 的方位判断不正确——注意汽笛与机械声在左右声道的分布。`);
  }
  if (solved) hints.push('全部顺序与两处方位均正确，结案！');

  return { solved, orderCorrect, wrongPositions, directionResults, wrongDirections, hints };
}

export function scoreFor(caseData, fails) {
  const { baseScore, penaltyPerFail } = caseData.rules;
  return Math.max(0, baseScore - fails * penaltyPerFail);
}
