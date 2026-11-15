function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = ["#6ee7b7", "#60a5fa", "#f59e0b", "#f472b6", "#a78bfa", "#fb7185"];

export function makeNormalDocument(seed = 20261116) {
  const random = mulberry32(seed);
  const objects = [];
  const types = ["rect", "ellipse", "text"];
  for (let index = 0; index < 24; index += 1) {
    const type = types[index % types.length];
    const shape = {
      id: `normal-${String(index + 1).padStart(2, "0")}`,
      type,
      x: Math.round(40 + random() * 900),
      y: Math.round(40 + random() * 520),
      width: Math.round(50 + random() * 160),
      height: Math.round(36 + random() * 110),
      color: COLORS[index % COLORS.length],
      rotation: (index % 5) * 3,
      opacity: 0.7 + (index % 4) * 0.1,
    };
    if (type === "text") shape.text = `图层 ${String(index + 1).padStart(2, "0")}`;
    objects.push(shape);
  }
  return { version: 1, width: 1200, height: 760, objects };
}

export function makeBoundaryDocument() {
  return {
    version: 1,
    width: 8192,
    height: 8192,
    objects: [
      {
        id: "edge-min",
        type: "rect",
        x: -1_000_000,
        y: -1_000_000,
        width: 0.01,
        height: 0.01,
        color: "#000000",
        rotation: -360,
        opacity: 0.05,
      },
      {
        id: "edge-max",
        type: "ellipse",
        x: 1_000_000,
        y: 1_000_000,
        width: 2_000_000,
        height: 2_000_000,
        color: "#ffffff",
        rotation: 360,
        opacity: 1,
      },
      {
        id: "text-max-length",
        type: "text",
        x: 0,
        y: 0,
        width: 8192,
        height: 8192,
        color: "#6ee7b7",
        text: "边".repeat(500),
      },
    ],
  };
}

export function makeEmptyBoundaryDocument() {
  return { version: 1, width: 1, height: 1, objects: [] };
}

function tooManyObjects() {
  const objects = Array.from({ length: 1001 }, (_, index) => ({
    id: `overflow-${index}`,
    type: "rect",
    x: index,
    y: index,
    width: 1,
    height: 1,
    color: "#60a5fa",
  }));
  return { version: 1, width: 100, height: 100, objects };
}

export const corruptPayloads = Object.freeze([
  { name: "truncated-json", value: '{"version":1,"objects":[' },
  { name: "missing-version", value: { width: 320, height: 200, objects: [] } },
  {
    name: "invalid-shape",
    value: {
      version: 1,
      width: 320,
      height: 200,
      objects: [
        { id: "ok-before-error", type: "rect", x: 0, y: 0, width: 10, height: 10, color: "#ffffff" },
        { id: "bad", type: "triangle", x: 0, y: 0, width: 10, height: 10, color: "#ffffff" },
      ],
    },
  },
  {
    name: "duplicate-id",
    value: {
      version: 1,
      width: 320,
      height: 200,
      objects: [
        { id: "same", type: "rect", x: 0, y: 0, width: 10, height: 10, color: "#ffffff" },
        { id: "same", type: "rect", x: 20, y: 0, width: 10, height: 10, color: "#ffffff" },
      ],
    },
  },
  { name: "too-many-objects", value: tooManyObjects() },
  { name: "bad-width", value: { version: 1, width: 0, height: 200, objects: [] } },
]);
