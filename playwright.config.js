const fs = require("fs");
const { defineConfig } = require("@playwright/test");

const localBrowsers = "/home/hj/.cache/ms-playwright";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(localBrowsers)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
}

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:49321",
    locale: "zh-CN",
    acceptDownloads: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node server.js",
    env: { ...process.env, PORT: "49321" },
    url: "http://127.0.0.1:49321",
    reuseExistingServer: true,
    timeout: 15000
  }
});
