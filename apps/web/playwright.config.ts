import { defineConfig, devices } from '@playwright/test';

import { resolveApiUrl } from './tests/helpers/api-url';

/**
 * Playwright configuration for the web app E2E tests.
 *
 * The tests drive the built app in a browser against a running AliasVault API (Debug build, see global-setup.ts).
 * - ALIASVAULT_API_URL: the API to test against; defaults to the port block in the repo's dev.env.
 * - ALIASVAULT_WEB_URL: an already running web app (e.g. `./scripts/dev.sh web`); when unset, Playwright builds the
 *   app and serves dist/ via `vite preview`.
 */
const API_URL = resolveApiUrl();
const PREVIEW_PORT = 4173;
const WEB_URL = process.env.ALIASVAULT_WEB_URL || `http://localhost:${PREVIEW_PORT}`;

process.env.ALIASVAULT_API_URL = API_URL;

export default defineConfig({
  testDir: './tests/e2e',

  // Checks the API is reachable and applies the test server settings.
  globalSetup: './tests/global-setup.ts',

  /*
   * Every test registers its own account, so all tests run in parallel, also within a file except
   * when a test file is marked as serial explicitly.
   */
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : '100%',

  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  expect: {
    timeout: 10000,
  },

  use: {
    baseURL: WEB_URL,
    locale: 'en-US',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: process.env.ALIASVAULT_WEB_URL ? undefined : {
    command: `npx vite build && npx vite preview --port ${PREVIEW_PORT} --strictPort`,
    url: WEB_URL,
    reuseExistingServer: false,
  },

  outputDir: 'tests/test-results',
});
