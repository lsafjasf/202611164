import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const playwrightPath = process.env.PLAYWRIGHT_PATH;
const executablePath = process.env.CHROME_PATH;
if (!playwrightPath || !executablePath) {
  throw new Error("Set PLAYWRIGHT_PATH and CHROME_PATH to run the browser smoke test.");
}

const { chromium } = await import(pathToFileURL(path.resolve(playwrightPath)));
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:4399/";
const seed = "NIGHT-001";
const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") pageErrors.push(message.text());
});

try {
  await page.goto(`${baseUrl}?seed=${seed}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "artifacts/smoke-initial.png", fullPage: true });

  assert.match(await page.title(), /回声林区/);
  assert.equal(await page.locator("#resultOverlay").isHidden(), true);
  assert.equal(await page.locator("#comparisonBody tr").count(), 0);
  assert.equal(await page.locator("#restartSeedBtn").isHidden(), true);

  const caseData = await page.evaluate(async (caseSeed) => {
    const module = await import("./js/case.js");
    return module.generateCase(caseSeed);
  }, seed);
  const truth = caseData.sources.map((source) => source.materialId);
  const orderWindows = await page.locator(".slot-window").allTextContents();
  const penalty = await page.locator("#penaltyText").textContent();

  const field = page.locator("#forestField");
  const box = await field.boundingBox();
  await page.mouse.move(box.x + box.width * 0.43, box.y + box.height * 0.58);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.47, { steps: 8 });
  await page.mouse.up();
  assert.doesNotMatch(await page.locator("#positionReadout").textContent(), /X 50\.0 \/ Y 50\.0/);

  await page.locator("#startBtn").click();
  await page.waitForFunction(() => document.querySelector("#tapeState").textContent === "RECORDING");
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.32, box.y + box.height * 0.4, { steps: 4 });
  await page.mouse.up();
  assert.match(await page.locator("#noiseCard").getAttribute("class"), /is-noisy/);
  await page.waitForTimeout(320);
  await page.waitForFunction(
    () => document.querySelector("#slotStatus1").textContent.includes("已录入"),
    { timeout: 8000 }
  );
  await page.waitForTimeout(160);
  await page.screenshot({ path: "artifacts/smoke-listening.png", fullPage: true });

  await page.locator("#pauseBtn").click();
  const pausedAt = await page.locator("#tapeTime").textContent();
  await page.waitForTimeout(750);
  const stillPausedAt = await page.locator("#tapeTime").textContent();
  assert.equal(stillPausedAt, pausedAt);

  await page.locator("#replayBtn").click();
  await page.waitForTimeout(450);
  const replayTime = await page.locator("#tapeTime").textContent();
  assert.ok(replayTime < "00:01.5", `Expected replay near zero, got ${replayTime}`);

  for (let index = 0; index < 3; index += 1) {
    await page.locator(`#guess${index + 1}`).selectOption(truth[index]);
  }
  assert.equal(await page.locator("#submitBtn").isEnabled(), true);
  await page.locator("#submitBtn").click();
  await page.waitForFunction(() => !document.querySelector("#resultOverlay").hidden);
  await page.waitForTimeout(420);
  await page.screenshot({ path: "artifacts/smoke-correct.png", fullPage: true });

  assert.equal(await page.locator("#scoreValue").textContent(), "100");
  assert.match(await page.locator("#resultTitle").textContent(), /完成/);
  assert.equal(await page.locator("#comparisonBody tr").count(), 3);
  const comparisonText = await page.locator("#comparisonBody").textContent();
  for (const source of caseData.sources) {
    assert.ok(comparisonText.includes(source.id));
    assert.ok(comparisonText.includes(source.echoMs.toString()));
  }

  await page.locator("#restartSeedBtn").click();
  await page.waitForFunction(() => document.querySelector("#resultOverlay").hidden);
  assert.equal(await page.locator("#seedInput").inputValue(), seed);
  assert.deepEqual(await page.locator(".slot-window").allTextContents(), orderWindows);
  assert.equal(await page.locator("#penaltyText").textContent(), penalty);
  assert.equal(await page.locator("#tapeState").textContent(), "STANDBY");

  await page.locator("#startBtn").click();
  await page.waitForTimeout(120);
  await page.locator("#guess1").selectOption(truth[1]);
  await page.locator("#guess2").selectOption(truth[0]);
  await page.locator("#guess3").selectOption(truth[2]);
  await page.locator("#submitBtn").click();
  await page.waitForFunction(() => !document.querySelector("#resultOverlay").hidden);
  await page.waitForTimeout(420);
  await page.screenshot({ path: "artifacts/smoke-wrong-order.png", fullPage: true });

  assert.notEqual(await page.locator("#scoreValue").textContent(), "100");
  assert.match(await page.locator("#resultMessage").textContent(), /顺序判断错误/);
  assert.match(await page.locator("#dimensionRow").textContent(), /顺序/);
  assert.match(await page.locator("#dimensionRow").textContent(), /fail|逆序/);
  assert.equal(pageErrors.length, 0, `Browser errors: ${pageErrors.join(" | ")}`);

  console.log("Browser smoke passed: pause, replay, correct=100, wrong order diagnostic, same-seed reset.");

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mobile.goto(`${baseUrl}?seed=${seed}`, { waitUntil: "networkidle" });
  await mobile.screenshot({ path: "artifacts/smoke-mobile.png", fullPage: true });
  const mobileWidth = await mobile.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  assert.ok(mobileWidth.scrollWidth <= mobileWidth.clientWidth + 1);
  console.log("Mobile layout passed without horizontal overflow.");
} finally {
  await browser.close();
}
