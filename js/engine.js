/* 确定性案件引擎：同 seed 永远生成相同的真实参数、线索顺序与惩罚规则。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CaseEngine = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const PASSAGES = ["通道一", "通道二", "通道三"];
  const SOURCES = [
    { id: "steps", label: "脚步声", band: "中频 0.8–2 kHz", baseFreq: 1200 },
    { id: "drip", label: "滴水声", band: "高频 2–6 kHz", baseFreq: 3200 },
    { id: "hum", label: "低频嗡鸣", band: "低频 60–180 Hz", baseFreq: 110 }
  ];
  const WALLS = [
    { id: "concrete", label: "混凝土墙", rt60: 0.35, damp: 0.45, band: "混响短、高频被吸收" },
    { id: "brick", label: "砖墙", rt60: 0.75, damp: 0.7, band: "中频混响明显" },
    { id: "tile", label: "瓷砖墙", rt60: 1.25, damp: 0.95, band: "长混响、高频反射强" }
  ];
  const DOORS = [
    { id: "narrow", label: "窄门洞", gain: 0.32, lowpass: 900, band: "高频衰减强" },
    { id: "normal", label: "标准门洞", gain: 0.6, lowpass: 3200, band: "全频通过" },
    { id: "arch", label: "宽拱门", gain: 0.95, lowpass: 7000, band: "高频保留完整" }
  ];
  const POSITIONS = [
    { id: "P1", label: "位置 A · 靠近储物间", geometry: [
      { gain: 0.9, delay: 0.02, pan: -0.5 }, { gain: 0.45, delay: 0.11, pan: 0.3 }, { gain: 0.28, delay: 0.19, pan: 0.65 } ] },
    { id: "P2", label: "位置 B · 楼梯下方", geometry: [
      { gain: 0.4, delay: 0.13, pan: 0.45 }, { gain: 0.85, delay: 0.03, pan: -0.35 }, { gain: 0.35, delay: 0.16, pan: 0.6 } ] },
    { id: "P3", label: "位置 C · 管道井旁", geometry: [
      { gain: 0.3, delay: 0.18, pan: 0.6 }, { gain: 0.42, delay: 0.12, pan: 0.2 }, { gain: 0.92, delay: 0.025, pan: -0.55 } ] },
    { id: "P4", label: "位置 D · 中央走廊", geometry: [
      { gain: 0.62, delay: 0.09, pan: -0.25 }, { gain: 0.6, delay: 0.085, pan: 0.05 }, { gain: 0.58, delay: 0.1, pan: 0.3 } ] }
  ];
  const LOOP_SECONDS = 64;
  const MAX_RECORD_SECONDS = 8;
  const PENALTY_SECONDS = 10;

  function hashSeed(seed) {
    let h = 2166136261 >>> 0;
    const s = String(seed);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = hashSeed(seed);
    return function rng() {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(rng, items) {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function buildEvents(rng) {
    const events = [];
    SOURCES.forEach(function (src, s) {
      if (src.id === "steps") {
        let t = 2 + rng() * 4;
        while (t < LOOP_SECONDS - 3) {
          const bursts = 4 + Math.floor(rng() * 3);
          for (let k = 0; k < bursts; k++) {
            events.push({ source: s, time: round2(t + k * 0.42), kind: "steps" });
          }
          t += 12 + rng() * 8;
        }
      } else if (src.id === "drip") {
        let t = 1.5 + rng() * 3;
        while (t < LOOP_SECONDS - 1) {
          events.push({ source: s, time: round2(t), kind: "drip" });
          t += 2.2 + rng() * 2.6;
        }
      } else {
        for (let k = 0; k < 6; k++) {
          events.push({ source: s, time: round2(4 + k * 10 + rng() * 2), kind: "hum" });
        }
      }
    });
    events.sort(function (a, b) { return a.time - b.time; });
    return events;
  }

  function generateCase(seed) {
    const rng = mulberry32(seed);
    const sourceMap = shuffled(rng, SOURCES.map(function (x) { return x.id; }));
    const wallMap = shuffled(rng, WALLS.map(function (x) { return x.id; }));
    const doorMap = shuffled(rng, DOORS.map(function (x) { return x.id; }));
    const passages = PASSAGES.map(function (name, i) {
      return {
        index: i,
        name: name,
        source: sourceMap[i],
        wall: wallMap[i],
        door: doorMap[i]
      };
    });
    return {
      seed: String(seed),
      passages: passages,
      events: buildEvents(rng),
      loopSeconds: LOOP_SECONDS,
      maxRecordSeconds: MAX_RECORD_SECONDS,
      penaltySeconds: PENALTY_SECONDS
    };
  }

  function findById(list, id) {
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function fmtTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  const DIMENSIONS = [
    { key: "source", label: "声源类型", options: SOURCES },
    { key: "wall", label: "墙面材质", options: WALLS },
    { key: "door", label: "门洞大小", options: DOORS }
  ];

  function gradeSubmission(caseData, answers) {
    const rows = [];
    let wrongCount = 0;
    caseData.passages.forEach(function (passage) {
      DIMENSIONS.forEach(function (dim) {
        const truth = passage[dim.key];
        const chosen = answers[passage.index] && answers[passage.index][dim.key];
        const correct = chosen === truth;
        if (!correct) wrongCount++;
        rows.push({
          passage: passage.name,
          passageIndex: passage.index,
          dimension: dim.label,
          dimensionKey: dim.key,
          chosen: chosen ? findById(dim.options, chosen).label : "未作答",
          truth: findById(dim.options, truth).label,
          correct: correct
        });
      });
    });
    return {
      rows: rows,
      wrongCount: wrongCount,
      total: rows.length,
      correctCount: rows.length - wrongCount,
      penaltySeconds: wrongCount * caseData.penaltySeconds
    };
  }

  function eventsForPassage(caseData, passageIndex) {
    return caseData.events
      .filter(function (ev) { return ev.source === passageIndex; })
      .map(function (ev) {
        const src = findById(SOURCES, ev.kind);
        return { time: ev.time, label: src.label, band: src.band };
      });
  }

  function buildEvidenceRows(caseData, grade, windowMeta) {
    return grade.rows.map(function (row) {
      const passage = caseData.passages[row.passageIndex];
      const src = findById(SOURCES, passage.source);
      const wall = findById(WALLS, passage.wall);
      const door = findById(DOORS, passage.door);
      const events = eventsForPassage(caseData, row.passageIndex);
      const sampleTimes = events.slice(0, 3).map(function (e) {
        return fmtTime(e.time);
      }).join("、");
      const winInfo = windowMeta && windowMeta.length
        ? windowMeta.map(function (w) { return w.label + "@" + fmtTime(w.start); }).join("；")
        : "未录窗口，采用循环时间轴";
      let band;
      if (row.dimensionKey === "source") band = src.band;
      if (row.dimensionKey === "wall") band = wall.band + "（RT60 " + wall.rt60 + "s）";
      if (row.dimensionKey === "door") band = door.band + "（低通 " + door.lowpass + " Hz）";
      return {
        passage: row.passage,
        dimension: row.dimension,
        chosen: row.chosen,
        truth: row.truth,
        sourceLabel: src.label,
        timeInfo: "线索时刻 " + sampleTimes + "（64s 循环）",
        windowInfo: winInfo,
        band: band,
        correct: row.correct
      };
    });
  }

  function wrongHints(grade) {
    return grade.rows.filter(function (r) { return !r.correct; }).map(function (r) {
      return r.passage + " 的【" + r.dimension + "】判断错误：你选择“" +
        r.chosen + "”，请重点复核该维度的声音特征。";
    });
  }

  function deterministicSummary(caseData) {
    return caseData.events.slice(0, 6).map(function (e) {
      return e.time + ":" + e.kind + "@P" + (e.source + 1);
    }).join("|");
  }

  return {
    PASSAGES: PASSAGES,
    SOURCES: SOURCES,
    WALLS: WALLS,
    DOORS: DOORS,
    POSITIONS: POSITIONS,
    DIMENSIONS: DIMENSIONS,
    LOOP_SECONDS: LOOP_SECONDS,
    MAX_RECORD_SECONDS: MAX_RECORD_SECONDS,
    PENALTY_SECONDS: PENALTY_SECONDS,
    mulberry32: mulberry32,
    generateCase: generateCase,
    gradeSubmission: gradeSubmission,
    buildEvidenceRows: buildEvidenceRows,
    wrongHints: wrongHints,
    deterministicSummary: deterministicSummary,
    fmtTime: fmtTime
  };
});
