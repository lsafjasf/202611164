import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"], ["json", { outputFile: "evidence/playwright.json" }]],
  use: {
    baseURL: "http://127.0.0.1:4320",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "touch", use: { ...devices["Pixel 7"] } }
  ],
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:4320",
    reuseExistingServer: true
  }
});
