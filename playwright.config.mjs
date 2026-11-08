import { defineConfig } from '@playwright/test';

// macOS 13: Playwright's own Chromium is not supported, so tests use the installed Google Chrome.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.mjs',
  timeout: 60_000,
  workers: 2,
  use: { baseURL: 'http://localhost:4173/', channel: 'chrome', headless: true, actionTimeout: 10_000 },
  webServer: { command: 'python3 -m http.server 4173', port: 4173, reuseExistingServer: true },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: false, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
