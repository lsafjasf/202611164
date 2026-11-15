import { defineConfig } from '@playwright/test';
const webServer = {
  command: 'PORT=43219 node tools/static-server.mjs',
  url: 'http://127.0.0.1:43219',
  reuseExistingServer: true,
  timeout: 10000,
};

export default defineConfig({
  testDir: './test',
  testMatch: /e2e\.test\.mjs/,
  timeout: 30000,
  webServer,
  use: {
    headless: true,
    baseURL: 'http://127.0.0.1:43219',
  },
});
