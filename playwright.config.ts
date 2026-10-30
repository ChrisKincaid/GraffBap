import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.browser.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    channel: 'msedge',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: 'list',
});
