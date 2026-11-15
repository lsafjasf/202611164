export const MAX_NODES = 300;
export const SCENE_VERSION = 1;
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/i;
const TYPES = new Set(["frame", "rect", "text"]);

export class SceneValidationError extends Error {
  constructor(message, path = "$", code = "INVALID_SCENE") {
    super(`${message} at ${path}`);
    this.name = "SceneValidationError";
    this.code = code;
    this.path = path;
  }
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function hashValue(value) {
  return hashString(stableStringify(value));
}

export function walk(node, visitor, parent = null, path = "root") {
  visitor(node, parent, path);
  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach((child, index) => walk(child, visitor, node, `${path}.children[${index}]`));
}

export function findNode(root, id) {
  let found = null;
  walk(root, (node) => {
    if (node.id === id) found = node;
  });
  return found;
}

export function findParent(root, id) {
  let found = null;
  walk(root, (node, parent) => {
    if (node.id === id) found = parent;
  });
  return found;
}

export function collectSubtreeIds(node) {
  const ids = [];
  walk(node, (current) => ids.push(current.id));
  return ids;
}

export function countNodes(root) {
  let count = 0;
  walk(root, () => {
    count += 1;
  });
  return count;
}

function validateLength(value, path, options = {}) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100000) {
    return;
  }
  if (typeof value === "string" && /^(?:100(?:\.0+)?|[0-9]{1,2}(?:\.[0-9]+)?)%$/.test(value)) {
    return;
  }
  throw new SceneValidationError(
    options.allowNegative ? "must be a finite px value or percentage" : "must be non-negative",
    path,
  );
}

function validateCoordinate(value, path) {
  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 100000) return;
  if (typeof value === "string" && /^(?:100(?:\.0+)?|[0-9]{1,2}(?:\.[0-9]+)?)%$/.test(value)) return;
  throw new SceneValidationError("must be a finite px value or percentage", path);
}

function validateColor(value, path) {
  if (typeof value !== "string" || value.length > 64 || !/^[#(),.%\w\s-]+$/.test(value)) {
    throw new SceneValidationError("must be a CSS color token", path);
  }
}

function validateNode(node, path, seen) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new SceneValidationError("node must be an object", path);
  }
  if (typeof node.id !== "string" || !ID_PATTERN.test(node.id)) {
    throw new SceneValidationError("id is invalid", `${path}.id`, "INVALID_ID");
  }
  if (seen.has(node.id)) {
    throw new SceneValidationError(`duplicate id "${node.id}"`, `${path}.id`, "DUPLICATE_ID");
  }
  seen.add(node.id);
  if (!TYPES.has(node.type)) {
    throw new SceneValidationError("type must be frame, rect, or text", `${path}.type`, "INVALID_TYPE");
  }
  validateCoordinate(node.x ?? 0, `${path}.x`);
  validateCoordinate(node.y ?? 0, `${path}.y`);
  validateLength(node.width, `${path}.width`);
  validateLength(node.height, `${path}.height`);
  if (node.visible !== undefined && typeof node.visible !== "boolean") {
    throw new SceneValidationError("visible must be boolean", `${path}.visible`);
  }
  if (node.name !== undefined && (typeof node.name !== "string" || node.name.length > 80)) {
    throw new SceneValidationError("name must be a short string", `${path}.name`);
  }
  if (node.fill !== undefined) validateColor(node.fill, `${path}.fill`);
  if (node.stroke !== undefined) validateColor(node.stroke, `${path}.stroke`);
  if (node.radius !== undefined && (!Number.isFinite(node.radius) || node.radius < 0)) {
    throw new SceneValidationError("radius must be non-negative", `${path}.radius`);
  }
  if (node.type === "text" && typeof node.text !== "string") {
    throw new SceneValidationError("text nodes need text content", `${path}.text`);
  }
  if (node.type === "text" && node.text.length > 5000) {
    throw new SceneValidationError("text exceeds 5000 characters", `${path}.text`, "CONTENT_TOO_LARGE");
  }
  if (node.font !== undefined) {
    if (!node.font || typeof node.font !== "object" || Array.isArray(node.font)) {
      throw new SceneValidationError("font must be an object", `${path}.font`);
    }
    if (node.font.size !== undefined && (!Number.isFinite(node.font.size) || node.font.size <= 0 || node.font.size > 500)) {
      throw new SceneValidationError("font size must be between 0 and 500", `${path}.font.size`);
    }
    if (node.font.family !== undefined && (typeof node.font.family !== "string" || node.font.family.length > 80)) {
      throw new SceneValidationError("font family is invalid", `${path}.font.family`);
    }
  }
  if (node.children !== undefined && !Array.isArray(node.children)) {
    throw new SceneValidationError("children must be an array", `${path}.children`);
  }
}

export function validateScene(scene) {
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
    throw new SceneValidationError("scene must be an object", "$", "INVALID_SCENE");
  }
  if (scene.version !== SCENE_VERSION) {
    throw new SceneValidationError(`unsupported version ${String(scene.version)}`, "$.version", "UNSUPPORTED_VERSION");
  }
  if (!scene.root || typeof scene.root !== "object") {
    throw new SceneValidationError("root is required", "$.root", "MISSING_ROOT");
  }
  const seen = new Set();
  let count = 0;
  function countAndValidate(node, path) {
    count += 1;
    if (count > MAX_NODES) {
      throw new SceneValidationError(`scene exceeds ${MAX_NODES} nodes`, path, "TOO_MANY_NODES");
    }
    validateNode(node, path, seen);
  }
  const stack = [[scene.root, "$.root"]];
  while (stack.length) {
    const [node, path] = stack.pop();
    countAndValidate(node, path);
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push([children[index], `${path}.children[${index}]`]);
    }
  }
  if (scene.root.type !== "frame") {
    throw new SceneValidationError("root must be a frame", "$.root.type", "INVALID_ROOT");
  }
  return scene;
}

export class SceneLoader {
  constructor(fallbackScene, logger = console) {
    this.fallbackScene = clone(fallbackScene);
    this.logger = logger;
    this.errors = [];
  }

  load(input) {
    try {
      const parsed = typeof input === "string" ? JSON.parse(input) : clone(input);
      validateScene(parsed);
      return { scene: parsed, recovered: false, errors: [] };
    } catch (error) {
      const entry = {
        id: this.errors.length + 1,
        at: new Date().toISOString(),
        code: error.code ?? "PARSE_ERROR",
        message: error.message,
        source: "scene-loader",
        recovery: "Loaded the bundled safe scene. Export remains disabled until you confirm recovery.",
      };
      this.errors.push(entry);
      this.logger.error?.("[scene-loader] input rejected; safe scene loaded", entry);
      return { scene: clone(this.fallbackScene), recovered: true, errors: [entry] };
    }
  }
}
