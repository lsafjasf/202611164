"use strict";

// Browser-level verification; run with `npm run test:ui`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const Engine = require("../js/engine.js");

const ROOT = path.resolve(__dirname, "..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2"
};

function serve() {
  const server = http.createServer(function (request, response) {
    const relative = decodeURIComponent(request.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve(server);
    });
  });
}

async function startCase(page, base, seed) {
  await page.goto(base + "/?seed=" + encodeURIComponent(seed), { waitUntil: "networkidle" });
  await page.click("#start-btn");
  await page.waitForTimeout(300);
}

async function probe(page) {
  await page.click("#probe-btn");
  await page.waitForTimeout(1650);
}

async function playToConclusion(page, caseData, wrongJunction) {
  await probe(page);
  await page.click("[data-length=\"" + caseData.main.lengthKey + "\"]");
  await page.click("#advance-btn");
  for (let index = 0; index < 3; index += 1) {
    await page.waitForTimeout(120);
    await probe(page);
    let direction = caseData.junctions[index].open.direction;
    if (index === wrongJunction) {
      direction = Engine.BEARINGS.find(function (bearing) {
        return bearing.key !== direction;
      }).key;
    }
    await page.click("[data-direction=\"" + direction + "\"]");
    await page.waitForTimeout(180);
  }
}

async function canvasData(page) {
  return page.evaluate(function () {
    return document.getElementById("game-canvas").toDataURL();
  });
}

async function main() {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", function (error) { errors.push(error.message); });
  page.on("console", function (message) {
    if (message.type() === "error") errors.push(message.text());
  });

  try {
    const correctSeed = "UI-CORRECT-731904";
    const correctCase = Engine.createCase(correctSeed);
    await startCase(page, base, correctSeed);
    await playToConclusion(page, correctCase, -1);
    await page.click("#open-submit");
    const modalText = await page.locator("#submit-modal").innerText();
    assert.equal(modalText.includes("开放"), false, "submission modal must not reveal the true direction");
    assert.equal(modalText.includes(correctCase.main.meters + " m"), false, "submission modal must not reveal measured length");
    await page.click(".submit-confirm");
    await page.waitForTimeout(350);
    assert.equal(await page.locator("#result-title").innerText(), "推断成立");
    assert.equal(await page.locator("#result-correct").innerText(), "4 / 4");
    assert.equal(await page.locator("#error-callout").isVisible(), false);
    assert.equal(await page.locator(".result-table td.evidence-cell").count(), 4);

    await page.click("#restart-seed");
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#header-seed").innerText(), correctSeed);
    assert.equal(await page.locator("#probe-status").innerText(), "尚未敲击");
    assert.equal(await page.locator("#result-screen").isVisible(), false);

    const wrongJunction = 1;
    await playToConclusion(page, correctCase, wrongJunction);
    await page.click("#open-submit");
    await page.click(".submit-confirm");
    await page.waitForTimeout(350);
    assert.equal(await page.locator("#result-title").innerText(), "部分推断成立");
    assert.equal(await page.locator("#result-correct").innerText(), "3 / 4");
    assert.equal(await page.locator("#error-callout").isVisible(), true);
    assert.match(await page.locator("#error-detail").innerText(), /第2岔口方向/);
    assert.equal(await page.locator(".result-table tr.is-mismatch").count(), 1);

    const pauseSeed = "UI-PAUSE-REPLAY";
    await startCase(page, base, pauseSeed);
    await probe(page);
    const before = await canvasData(page);
    await page.click("#pause-btn");
    await page.waitForTimeout(200);
    assert.equal(await page.locator("#pause-overlay").isVisible(), true);
    assert.equal(await page.locator("#audio-status").innerText(), "声场冻结");
    assert.equal(await canvasData(page), before, "pause must not change the clue record");
    await page.click("#resume-btn");
    await page.waitForTimeout(200);
    assert.equal(await canvasData(page), before, "resume must not change the clue record");
    await page.click("#replay-btn");
    await page.waitForTimeout(1550);
    assert.equal(await canvasData(page), before, "replay must not reroll or append clues");
    assert.equal(await page.locator("#probe-status").innerText(), "P01 已记录 / 1 条");
    assert.deepEqual(errors, []);
    console.log("UI verification passed: correct, wrong, pause, replay, same-seed restart.");
  } finally {
    await browser.close();
    await new Promise(function (resolve) { server.close(resolve); });
  }
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
