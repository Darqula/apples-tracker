import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: "http://127.0.0.1:3070",
    viewport: { width: 1400, height: 900 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node start-server.mjs",
    url: "http://127.0.0.1:3070/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
