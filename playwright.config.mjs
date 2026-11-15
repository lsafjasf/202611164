import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.mjs",
  timeout: 30000,
  fullyParallel: false,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e-report.json" }]],
  use: {
    baseURL: "http://127.0.0.1:4373",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "node scripts/serve.mjs",
    port: 4373,
    reuseExistingServer: true
  }
});
