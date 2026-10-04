import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", fullyParallel: false, workers: 1, timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:3100", browserName: "chromium", viewport: { width: 390, height: 844 } },
  webServer: { command: "npm run start -- --hostname 127.0.0.1 --port 3100", url: "http://127.0.0.1:3100/nutrition", reuseExistingServer: false, timeout: 60_000 },
});
