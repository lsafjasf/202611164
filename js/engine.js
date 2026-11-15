(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EchoEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SPEED_OF_SOUND = 343;
  const MAX_TURNS = 3;
  const WRONG_TURN_COST = 34;

  const BEARINGS = [
    { key: "left", label: "左侧", short: "左", pan: -0.82 },
    { key: "straight", label: "直行", short: "直", pan: 0 },
    { key: "right", label: "右侧", short: "右", pan: 0.82 }
  ];

  const LENGTH_OPTIONS = [
    { key: "short", label: "短巷", range: "18–28 m" },
    { key: "mid", label: "中巷", range: "32–48 m" },
    { key: "deep", label: "深巷", range: "58–72 m" }
  ];

  const JUNCTION_LABELS = ["一号岔口", "二号岔口", "三号岔口"];

  function normalizeSeed(seed) {
    const raw = String(seed == null ? "" : seed).trim();
    return (raw || "731904").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 18) || "731904";
  }

  function hashSeed(input) {
    let hash = 2166136261 >>> 0;
    const text = normalizeSeed(input);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function random() {
      value += 0x6d2b79f5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function between(random, min, max) {
    return min + (max - min) * random();
  }

  function integer(random, min, max) {
    return Math.floor(between(random, min, max + 1));
  }

  function roundTo(value, step) {
    return Math.round(value / step) * step;
  }

  function bearingByKey(key) {
    return BEARINGS.find((entry) => entry.key === key) || BEARINGS[1];
  }

  function lengthByKey(key) {
    return LENGTH_OPTIONS.find((entry) => entry.key === key) || LENGTH_OPTIONS[1];
  }

  function createCase(seedInput) {
    const seed = normalizeSeed(seedInput);
    const random = mulberry32(hashSeed(seed));
    const mainLengthKey = LENGTH_OPTIONS[integer(random, 0, 2)].key;
    const mainMeters = mainLengthKey === "short"
      ? integer(random, 18, 28)
      : mainLengthKey === "mid"
        ? integer(random, 32, 48)
        : integer(random, 58, 72);
    const mainHumidity = roundTo(between(random, 0.22, 0.88), 0.01);
    const mainBand = roundTo(980 - mainMeters * 3.1 + between(random, -45, 45), 10);

    const junctions = JUNCTION_LABELS.map(function (label, index) {
      const openDirection = BEARINGS[integer(random, 0, 2)].key;
      const openMeters = integer(random, 12, 27);
      const humidity = roundTo(between(random, 0.35, 0.95), 0.01);
      const openDelayMs = roundTo((openMeters * 2 / SPEED_OF_SOUND) * 1000 + between(random, 19, 39), 1);
      const openBand = roundTo(1540 - humidity * 610 + between(random, -70, 70), 10);
      const openStrength = roundTo(between(random, 0.58, 0.79), 0.01);
      const mask = {
        startMs: roundTo(between(random, openDelayMs * 0.38, openDelayMs * 0.72), 1),
        durationMs: integer(random, 620, 1080),
        bandHz: roundTo(between(random, 110, 260), 5),
        pan: roundTo(between(random, -0.65, 0.65), 0.01),
        gain: roundTo(between(random, 0.1, 0.2), 0.01)
      };
      const blocked = BEARINGS.map(function (bearing) {
        const deadMeters = between(random, 3.2, 7.8);
        return {
          direction: bearing.key,
          meters: roundTo(deadMeters, 0.1),
          delayMs: roundTo((deadMeters * 2 / SPEED_OF_SOUND) * 1000 + between(random, 4, 18), 1),
          bandHz: roundTo(between(random, 1680, 2350), 10),
          strength: roundTo(between(random, 0.16, 0.3), 0.01),
          noiseSeed: integer(random, 1, 2147483646)
        };
      });
      const openBearing = bearingByKey(openDirection);
      const open = {
        direction: openDirection,
        label: openBearing.label,
        pan: openBearing.pan,
        meters: openMeters,
        delayMs: openDelayMs,
        bandHz: openBand,
        strength: openStrength,
        humidity: humidity,
        noiseSeed: integer(random, 1, 2147483646)
      };
      return {
        index,
        label,
        open,
        blocked,
        humidity,
        machine: mask
      };
    });

    return {
      seed,
      main: {
        lengthKey: mainLengthKey,
        meters: mainMeters,
        humidity: mainHumidity,
        delayMs: roundTo((mainMeters * 2 / SPEED_OF_SOUND) * 1000 + between(random, 7, 15), 1),
        bandHz: mainBand,
        strength: roundTo(between(random, 0.64, 0.84), 0.01),
        noiseSeed: integer(random, 1, 2147483646)
      },
      junctions,
      penalties: {
        maxTurns: MAX_TURNS,
        wrongTurnCost: WRONG_TURN_COST,
        startsAt: 100
      }
    };
  }

  function clueStrengthLabel(strength) {
    if (strength >= 0.58) return "清晰";
    if (strength >= 0.32) return "微弱";
    return "被掩蔽";
  }

  function makeClue(caseData, probeIndex, entry) {
    return Object.freeze({
      probeIndex,
      source: entry.source,
      sourceLabel: entry.sourceLabel,
      delayMs: entry.delayMs,
      bandHz: entry.bandHz,
      pan: entry.pan,
      bearing: entry.bearing,
      strength: entry.strength,
      strengthLabel: clueStrengthLabel(entry.strength),
      humidity: entry.humidity,
      decayMs: entry.decayMs,
      noiseSeed: entry.noiseSeed,
      mask: entry.mask || null,
      caseSeed: caseData.seed
    });
  }

  function publicSnapshot(session) {
    return {
      seed: session.seed,
      oxygen: session.oxygen,
      stage: session.stage,
      currentJunction: session.currentJunction,
      junctionTotal: JUNCTION_LABELS.length,
      probes: session.probes.map(function (probe) {
        return Object.freeze({
          id: probe.id,
          type: probe.type,
          title: probe.title,
          clues: probe.clues.slice(),
          junctionIndex: probe.junctionIndex
        });
      }),
      logs: session.logs.slice(),
      lengthGuess: session.lengthGuess,
      directionGuesses: session.directionGuesses.slice(),
      wrongTurns: session.wrongTurns,
      turnsTaken: session.turnsTaken,
      canSubmit: session.stage === "conclude",
      oxygenExhausted: session.oxygen <= 0
    };
  }

  function Investigation(seedInput) {
    this.seed = normalizeSeed(seedInput);
    this._case = createCase(this.seed);
    this.oxygen = this._case.penalties.startsAt;
    this.stage = "main";
    this.currentJunction = 0;
    this.probes = [];
    this.logs = [];
    this.lengthGuess = null;
    this.directionGuesses = [];
    this.wrongTurns = 0;
    this.turnsTaken = 0;
    this._probedStages = new Set();
  }

  Investigation.prototype.snapshot = function snapshot() {
    return publicSnapshot(this);
  };

  Investigation.prototype.probe = function probe() {
    if (this.stage === "conclude" || this.oxygen <= 0) {
      throw new Error("The investigation is no longer accepting probes.");
    }
    if (this._probedStages.has(this.stage + ":" + this.currentJunction)) {
      return this.probes[this.probes.length - 1];
    }

    const probeIndex = this.probes.length + 1;
    const isMain = this.stage === "main";
    const junction = isMain ? null : this._case.junctions[this.currentJunction];
    const base = {
      source: isMain ? "main_end" : "junction_" + (this.currentJunction + 1),
      sourceLabel: isMain ? "主巷尽头" : JUNCTION_LABELS[this.currentJunction] + "支巷",
      humidity: isMain ? this._case.main.humidity : junction.humidity,
      mask: junction ? junction.machine : {
        startMs: 180,
        durationMs: 700,
        bandHz: 92,
        pan: -0.18,
        gain: 0.08
      }
    };

    let rawEntries;
    if (isMain) {
      rawEntries = [{
        direction: "straight",
        bearing: "主巷轴向",
        pan: 0,
        delayMs: this._case.main.delayMs,
        bandHz: this._case.main.bandHz,
        strength: this._case.main.strength,
        noiseSeed: this._case.main.noiseSeed,
        decayMs: 760
      }];
    } else {
      rawEntries = BEARINGS.map(function (bearing) {
        if (bearing.key === junction.open.direction) {
          return {
            direction: bearing.key,
            bearing: bearing.label,
            pan: bearing.pan,
            delayMs: junction.open.delayMs,
            bandHz: junction.open.bandHz,
            strength: junction.open.strength,
            noiseSeed: junction.open.noiseSeed,
            decayMs: 1050
          };
        }
        const blocked = junction.blocked.find(function (entry) {
          return entry.direction === bearing.key;
        });
        return {
          direction: bearing.key,
          bearing: bearing.label,
          pan: bearing.pan,
          delayMs: blocked.delayMs,
          bandHz: blocked.bandHz,
          strength: blocked.strength,
          noiseSeed: blocked.noiseSeed,
          decayMs: 170
        };
      });
    }

    const clues = rawEntries
      .slice()
      .sort(function (a, b) { return a.delayMs - b.delayMs; })
      .map(function (entry) {
        return makeClue(this._case, probeIndex, Object.assign({}, base, entry));
      }, this);
    const result = Object.freeze({
      id: "P" + String(probeIndex).padStart(2, "0"),
      type: isMain ? "main" : "junction",
      title: isMain ? "主巷测距回响" : JUNCTION_LABELS[this.currentJunction] + "回响",
      clues: Object.freeze(clues),
      junctionIndex: isMain ? null : this.currentJunction
    });

    this.probes.push(result);
    this.logs.push.apply(this.logs, clues);
    this._probedStages.add(this.stage + ":" + this.currentJunction);
    return result;
  };

  Investigation.prototype.hasProbedCurrentStage = function hasProbedCurrentStage() {
    return this._probedStages.has(this.stage + ":" + this.currentJunction);
  };

  Investigation.prototype.setLengthGuess = function setLengthGuess(key) {
    if (this.stage !== "main") {
      throw new Error("Length can only be recorded while measuring the main gallery.");
    }
    if (!this.hasProbedCurrentStage()) {
      throw new Error("Probe the main gallery before recording a length.");
    }
    if (!LENGTH_OPTIONS.some(function (entry) { return entry.key === key; })) {
      throw new Error("Unknown length choice.");
    }
    this.lengthGuess = key;
    return publicSnapshot(this);
  };

  Investigation.prototype.descendToJunctions = function descendToJunctions() {
    if (this.stage !== "main") {
      throw new Error("Already beyond the main gallery.");
    }
    if (!this.lengthGuess) {
      throw new Error("Record a length estimate before descending.");
    }
    this.stage = "junction";
    this.currentJunction = 0;
    return publicSnapshot(this);
  };

  Investigation.prototype.chooseDirection = function chooseDirection(direction) {
    if (this.stage !== "junction") {
      throw new Error("There is no junction decision at this stage.");
    }
    if (!this.hasProbedCurrentStage()) {
      throw new Error("Probe the junction before turning.");
    }
    if (!BEARINGS.some(function (entry) { return entry.key === direction; })) {
      throw new Error("Unknown direction.");
    }

    const junction = this._case.junctions[this.currentJunction];
    const correct = junction.open.direction === direction;
    if (!correct) {
      this.wrongTurns += 1;
      this.oxygen = Math.max(0, this.oxygen - this._case.penalties.wrongTurnCost);
    }
    this.directionGuesses[this.currentJunction] = direction;
    this.turnsTaken += 1;

    if (this.currentJunction >= this._case.junctions.length - 1) {
      this.stage = "conclude";
    } else {
      this.currentJunction += 1;
    }
    return publicSnapshot(this);
  };

  Investigation.prototype.buildConclusion = function buildConclusion(overrides) {
    if (this.stage !== "conclude") {
      throw new Error("All three turns must be recorded before submission.");
    }
    const supplied = overrides || {};
    const conclusion = {
      length: supplied.length || this.lengthGuess,
      directions: [
        supplied.directions && supplied.directions[0] || this.directionGuesses[0],
        supplied.directions && supplied.directions[1] || this.directionGuesses[1],
        supplied.directions && supplied.directions[2] || this.directionGuesses[2]
      ]
    };
    if (!conclusion.length || !LENGTH_OPTIONS.some(function (entry) { return entry.key === conclusion.length; })) {
      throw new Error("A valid length conclusion is required.");
    }
    conclusion.directions.forEach(function (direction) {
      if (!BEARINGS.some(function (entry) { return entry.key === direction; })) {
        throw new Error("A valid direction conclusion is required.");
      }
    });
    return conclusion;
  };

  function formatDelay(delayMs) {
    return delayMs.toFixed(1) + " ms";
  }

  function formatBand(bandHz) {
    return Math.round(bandHz) + " Hz";
  }

  function findProbe(session, predicate) {
    for (let i = session.probes.length - 1; i >= 0; i -= 1) {
      if (predicate(session.probes[i])) return session.probes[i];
    }
    return null;
  }

  function evidenceFromClue(clue) {
    return {
      source: clue.sourceLabel,
      time: formatDelay(clue.delayMs),
      band: formatBand(clue.bandHz),
      bearing: clue.bearing,
      strength: clue.strengthLabel,
      text: clue.sourceLabel + " · " + formatDelay(clue.delayMs) + " · " +
        formatBand(clue.bandHz) + " · " + clue.strengthLabel
    };
  }

  function evaluateConclusion(session, conclusionInput) {
    const conclusion = session.buildConclusion(conclusionInput);
    const caseData = session._case;
    const mainProbe = findProbe(session, function (probe) { return probe.type === "main"; });
    const mainClue = mainProbe && mainProbe.clues[0];
    const trueLength = lengthByKey(caseData.main.lengthKey);
    const guessLength = lengthByKey(conclusion.length);
    const rows = [];

    rows.push({
      key: "length",
      dimension: "主巷长度",
      guess: guessLength.label + " / " + guessLength.range,
      truth: trueLength.label + " / " + caseData.main.meters + " m",
      matched: conclusion.length === caseData.main.lengthKey,
      evidence: mainClue ? evidenceFromClue(mainClue) : {
        source: "主巷尽头",
        time: "未探测",
        band: "未探测",
        bearing: "轴向",
        strength: "无记录",
        text: "主巷尽头 · 无探测记录"
      },
      detail: "湿度 " + Math.round(caseData.main.humidity * 100) + "%"
    });

    caseData.junctions.forEach(function (junction, index) {
      const guess = bearingByKey(conclusion.directions[index]);
      const truth = bearingByKey(junction.open.direction);
      const probe = findProbe(session, function (entry) {
        return entry.type === "junction" && entry.junctionIndex === index;
      });
      const openClue = probe && probe.clues.find(function (clue) {
        return clue.bearing === junction.open.label;
      });
      rows.push({
        key: "junction_" + (index + 1),
        dimension: "第" + (index + 1) + "岔口方向",
        guess: guess.label,
        truth: truth.label + "开放 / " + junction.open.meters + " m",
        matched: conclusion.directions[index] === junction.open.direction,
        evidence: openClue ? evidenceFromClue(openClue) : {
          source: junction.label + "支巷",
          time: "未探测",
          band: "未探测",
          bearing: truth.label,
          strength: "无记录",
          text: junction.label + " · 无探测记录"
        },
        detail: "岩壁湿度 " + Math.round(junction.humidity * 100) + "%"
      });
    });

    const mismatches = rows.filter(function (row) { return !row.matched; });
    const correctCount = rows.length - mismatches.length;
    return {
      rows,
      correctCount,
      total: rows.length,
      allCorrect: mismatches.length === 0,
      mismatchedDimensions: mismatches.map(function (row) { return row.dimension; }),
      mismatchSummary: mismatches.length
        ? "偏差维度：" + mismatches.map(function (row) { return row.dimension; }).join("、")
        : "四个判断维度全部吻合。",
      verdict: mismatches.length === 0
        ? "推断成立"
        : correctCount === 0
          ? "推断不成立"
          : "部分推断成立",
      oxygen: session.oxygen,
      oxygenExhausted: session.oxygen <= 0,
      wrongTurns: session.wrongTurns,
      turnsTaken: session.turnsTaken,
      seed: caseData.seed
    };
  }

  return {
    BEARINGS,
    LENGTH_OPTIONS,
    JUNCTION_LABELS,
    MAX_TURNS,
    WRONG_TURN_COST,
    normalizeSeed,
    hashSeed,
    createCase,
    Investigation,
    evaluateConclusion,
    bearingByKey,
    lengthByKey
  };
});
