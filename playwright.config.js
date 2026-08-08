// @ts-check
const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
    // plakt.html is a self-contained file — no dev server needed, tests
    // open it directly. baseURL lets tests just do page.goto('/plakt.html').
    baseURL: 'file://' + path.resolve(__dirname) + '/',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 1000 } } },
  ],
});
