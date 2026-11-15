import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StudioApp } from "../src/app.js";

const html = readFileSync(resolve("index.html"), "utf8")
  .replace(/<script type="module"[^>]*><\/script>/g, "");

export function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

export function installCanvasStub(window) {
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, {
    get(target, property) {
      if (property === "createLinearGradient" || property === "createRadialGradient") {
        return () => gradient;
      }
      if (property === "measureText") {
        return (text) => ({ width: String(text).length * 20 });
      }
      if (property in target) return target[property];
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  });
  window.HTMLCanvasElement.prototype.getContext = () => context;
  window.HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
    callback(new window.Blob(["fake-png"], { type: "image/png" }));
  };
  window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,ZmFrZQ==";
}

export function createStudio(options = {}) {
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });
  const { window } = dom;
  installCanvasStub(window);
  window.HTMLCanvasElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540, x: 0, y: 0 };
  };
  const storage = options.storage || memoryStorage();
  const app = new StudioApp({
    document: window.document,
    storage,
    contextFactory: options.contextFactory
  });
  return { dom, window, document: window.document, app, storage };
}

export function teardown(studio) {
  studio.app.destroy();
  studio.window.close();
}

export function dispatchPointer(studio, type, point, pointerType, pointerId = 1) {
  const { window, app } = studio;
  const EventClass = window.PointerEvent || window.MouseEvent || window.Event;
  const event = new EventClass(type, {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    pointerId
  });
  if (!("pointerType" in event)) {
    Object.defineProperty(event, "pointerType", { value: pointerType });
  }
  if (!("pointerId" in event)) {
    Object.defineProperty(event, "pointerId", { value: pointerId });
  }
  app.el.studioCanvas.dispatchEvent(event);
}

export function layerPoint(layer) {
  return { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
}

export async function wait(milliseconds = 10) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
