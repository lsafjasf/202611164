import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const weights = [400, 600];
const fontDirectory = join(process.cwd(), "fonts", "noto-sans-sc");
const sourceFiles = [
  "index.html",
  "styles.css",
  join("src", "app.js"),
  join("src", "game.js"),
  join("src", "renderer.js"),
  join("src", "audio.js")
];

function wantedCharacters(text) {
  const characters = new Set();
  for (const character of text) {
    const code = character.codePointAt(0);
    if (
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0x3400 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      characters.add(character);
    }
  }
  return characters;
}

function parseRanges(value) {
  return value.split(",").map((entry) => {
    const clean = entry.trim().replace(/^U\+/i, "");
    const [start, end = start] = clean.split("-");
    return [parseInt(start, 16), parseInt(end, 16)];
  });
}

function blockCovers(block, code) {
  return block.ranges.some(([start, end]) => code >= start && code <= end);
}

const allText = (
  await Promise.all(sourceFiles.map((file) => readFile(join(process.cwd(), file), "utf8")))
).join("\n");
const characters = [...wantedCharacters(allText)];

await mkdir(fontDirectory, { recursive: true });

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const outputBlocks = [];
let fileNumber = 0;
for (const weight of weights) {
  const family = "Noto+Sans+SC";
  const cssUrl =
    `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&display=swap`;
  const response = await fetch(cssUrl, { headers: { "User-Agent": userAgent } });
  if (!response.ok) {
    throw new Error(`Font CSS request failed: ${response.status}`);
  }
  const css = await response.text();
  const blocks = [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((match) => {
    const body = match[1];
    const url = body.match(/src:\s*url\((https:[^)]+)\)/)?.[1];
    const range = body.match(/unicode-range:\s*([^;]+);/)?.[1];
    if (!url || !range) {
      return null;
    }
    return { url, range, ranges: parseRanges(range) };
  }).filter(Boolean);
  const selected = blocks.filter((block) =>
    characters.some((character) => blockCovers(block, character.codePointAt(0)))
  );
  for (const block of selected) {
    fileNumber += 1;
    const filename = `${weight}-${String(fileNumber).padStart(2, "0")}.woff2`;
    const font = await fetch(block.url, { headers: { "User-Agent": userAgent } });
    if (!font.ok) {
      throw new Error(`Font download failed: ${font.status} ${block.url}`);
    }
    await writeFile(join(fontDirectory, filename), Buffer.from(await font.arrayBuffer()));
    outputBlocks.push(
      `@font-face {\n  font-family: "Noto Sans SC";\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  src: url("./noto-sans-sc/${filename}") format("woff2");\n  unicode-range: ${block.range.trim()};\n}`
    );
  }
}

await writeFile(
  join(process.cwd(), "fonts", "noto-sans-sc.css"),
  `${outputBlocks.join("\n\n")}\n`
);
const files = await readdir(fontDirectory);
console.log(`Vendored ${files.length} font files for ${characters.length} characters.`);
