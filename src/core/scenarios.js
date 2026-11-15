import { clone, findNode, hashValue } from "./model.js";

export const VIEWPORT = { width: 960, height: 640 };

export function buildNormalScene() {
  return {
    version: 1,
    name: "Release dashboard",
    root: {
      id: "root",
      type: "frame",
      name: "Canvas",
      width: 920,
      height: 590,
      fill: "#eef2f7",
      font: { family: "Inter, sans-serif", size: 14, color: "#172033" },
      children: [
        {
          id: "header",
          type: "frame",
          name: "Header",
          x: 24,
          y: 24,
          width: 872,
          height: 88,
          fill: "#ffffff",
          radius: 16,
          children: [
            {
              id: "title",
              type: "text",
              x: 24,
              y: 20,
              width: "55%",
              height: 30,
              text: "Cache health",
              font: { size: 24, weight: 700 },
              fill: "#15213b",
            },
            {
              id: "subtitle",
              type: "text",
              x: 24,
              y: 54,
              width: "62%",
              height: 20,
              text: "Layout and paint dependencies, live",
              font: { size: 13, color: "#667085" },
            },
            {
              id: "status-pill",
              type: "rect",
              x: "75%",
              y: 24,
              width: "21%",
              height: 40,
              fill: "#e5f8ef",
              stroke: "#9ee4c1",
              radius: 20,
            },
            {
              id: "status-label",
              type: "text",
              x: "77%",
              y: 35,
              width: "17%",
              height: 20,
              text: "ALL SYSTEMS NORMAL",
              font: { size: 11, weight: 700, color: "#087443" },
              fill: "#087443",
            },
          ],
        },
        {
          id: "sidebar",
          type: "frame",
          name: "Navigation",
          x: 24,
          y: 128,
          width: 220,
          height: 438,
          fill: "#ffffff",
          radius: 16,
          font: { size: 14 },
          children: [
            {
              id: "nav-active",
              type: "rect",
              x: 14,
              y: 18,
              width: 192,
              height: 44,
              fill: "#e8efff",
              radius: 10,
            },
            {
              id: "nav-overview",
              type: "text",
              x: 30,
              y: 31,
              width: "76%",
              height: 20,
              text: "Overview",
              font: { weight: 700, color: "#2457d6" },
              fill: "#2457d6",
            },
            {
              id: "nav-layout",
              type: "text",
              x: 30,
              y: 78,
              width: "76%",
              height: 20,
              text: "Layout cache",
              fill: "#475467",
            },
            {
              id: "nav-paint",
              type: "text",
              x: 30,
              y: 112,
              width: "76%",
              height: 20,
              text: "Paint cache",
              fill: "#475467",
            },
            {
              id: "sidebar-rule",
              type: "rect",
              x: 20,
              y: 158,
              width: 180,
              height: 1,
              fill: "#e4e7ec",
            },
            {
              id: "sidebar-note",
              type: "text",
              x: 20,
              y: 178,
              width: "82%",
              height: 82,
              text: "Parent geometry, inherited fonts, and visibility are part of every child key.",
              font: { size: 12, color: "#667085" },
              fill: "#667085",
            },
            {
              id: "mode-card",
              type: "rect",
              x: 18,
              y: 288,
              width: 184,
              height: 112,
              fill: "#f8fafc",
              stroke: "#dde4ee",
              radius: 12,
            },
            {
              id: "mode-label",
              type: "text",
              x: 32,
              y: 304,
              width: "72%",
              height: 20,
              text: "Dependency scope",
              font: { size: 12, weight: 700, color: "#344054" },
            },
            {
              id: "mode-value",
              type: "text",
              x: 32,
              y: 332,
              width: "72%",
              height: 42,
              text: "Changed subtree only",
              font: { size: 18, weight: 700, color: "#2457d6" },
              fill: "#2457d6",
            },
          ],
        },
        {
          id: "body-card",
          type: "frame",
          name: "Main canvas",
          x: 256,
          y: 128,
          width: 640,
          height: 438,
          fill: "#ffffff",
          radius: 16,
          children: [
            {
              id: "chart-title",
              type: "text",
              x: 22,
              y: 18,
              width: "55%",
              height: 24,
              text: "Cache activity",
              font: { size: 17, weight: 700 },
              fill: "#1d2939",
            },
            {
              id: "chart-subtitle",
              type: "text",
              x: 22,
              y: 42,
              width: "55%",
              height: 18,
              text: "Last 20 frames · sampled",
              font: { size: 11, color: "#98a2b3" },
            },
            {
              id: "chart-panel",
              type: "frame",
              name: "Chart panel",
              x: 20,
              y: 74,
              width: "94%",
              height: 300,
              fill: "#f8fafc",
              radius: 12,
              children: [
                {
                  id: "grid-a",
                  type: "rect",
                  x: 0,
                  y: "25%",
                  width: "100%",
                  height: 1,
                  fill: "#e4e7ec",
                },
                {
                  id: "grid-b",
                  type: "rect",
                  x: 0,
                  y: "50%",
                  width: "100%",
                  height: 1,
                  fill: "#e4e7ec",
                },
                {
                  id: "grid-c",
                  type: "rect",
                  x: 0,
                  y: "75%",
                  width: "100%",
                  height: 1,
                  fill: "#e4e7ec",
                },
                ...[34, 55, 44, 72, 62, 84, 94].map((height, index) => ({
                  id: `bar-${index + 1}`,
                  type: "rect",
                  x: 48 + index * 72,
                  y: `${100 - height}%`,
                  width: 38,
                  height: `${height}%`,
                  fill: index < 4 ? "#7f9cf5" : "#2457d6",
                  radius: 6,
                })),
                {
                  id: "chart-caption",
                  type: "text",
                  x: 18,
                  y: 272,
                  width: "68%",
                  height: 16,
                  text: "recomputed entries",
                  font: { size: 10, color: "#98a2b3" },
                },
              ],
            },
            {
              id: "footer-rule",
              type: "rect",
              x: 20,
              y: 390,
              width: "94%",
              height: 1,
              fill: "#eaecf0",
            },
            {
              id: "footer-copy",
              type: "text",
              x: 20,
              y: 404,
              width: "70%",
              height: 18,
              text: "Reference output is generated with caches bypassed.",
              font: { size: 11, color: "#667085" },
            },
          ],
        },
        {
          id: "footnote",
          type: "text",
          x: 24,
          y: 570,
          width: "42%",
          height: 14,
          text: "Dependency-aware editor cache",
          font: { size: 10, color: "#98a2b3" },
        },
      ],
    },
  };
}

export function buildBoundaryScene() {
  const children = [];
  for (let index = 0; index < 244; index += 1) {
    children.push({
      id: `cell-${index}`,
      type: "rect",
      x: `${index % 20 * 5}%`,
      y: `${Math.floor(index / 20) * 5}%`,
      width: "4%",
      height: "3%",
      fill: index % 3 === 0 ? "#dbe5ff" : "#eff3fa",
    });
  }
  children.push({
    id: "edge-text",
    type: "text",
    x: 1,
    y: 1,
    width: "98%",
    height: 1,
    text: "x".repeat(5000),
    font: { size: 64, weight: 700 },
  });
  return {
    version: 1,
    name: "Boundary scene",
    root: {
      id: "root",
      type: "frame",
      width: "100%",
      height: "100%",
      fill: "#f8fafc",
      font: { size: 12 },
      children: [{
        id: "edge-frame",
        type: "frame",
        x: 0,
        y: 0,
        width: "100%",
        height: "100%",
        fill: "#ffffff",
        children,
      }],
    },
  };
}

export const CORRUPTED_INPUTS = [
  {
    name: "malformed-json",
    input: "{\"version\":1,\"root\":{\"id\":\"root\",",
  },
  {
    name: "invalid-geometry",
    input: JSON.stringify({ version: 1, root: { id: "root", type: "frame", width: "wide", height: 10 } }),
  },
  {
    name: "duplicate-id",
    input: JSON.stringify({
      version: 1,
      root: {
        id: "root",
        type: "frame",
        width: 100,
        height: 100,
        children: [
          { id: "dup", type: "rect", x: 0, y: 0, width: 10, height: 10 },
          { id: "dup", type: "rect", x: 10, y: 10, width: 10, height: 10 },
        ],
      },
    }),
  },
];

export function applyModification(scene, modification) {
  if (modification === "size") {
    const parent = findNode(scene.root, "body-card");
    parent.width = 684;
    return parent;
  }
  if (modification === "font") {
    const parent = findNode(scene.root, "sidebar");
    parent.font = { ...parent.font, size: 20 };
    return parent;
  }
  if (modification === "hidden") {
    const parent = findNode(scene.root, "chart-panel");
    parent.visible = false;
    return parent;
  }
  throw new Error(`Unknown modification: ${modification}`);
}

export function sceneExportChecksum(scene) {
  return hashValue(clone(scene));
}
