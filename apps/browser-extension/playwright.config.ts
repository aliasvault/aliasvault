import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for browser extension E2E tests.
 *
 * These tests load the real extension and interact with it using Playwright.
 * The extension must be built first using `npm run build:chrome`.
 *
 * Test Organization:
 * - Tests are numbered (1.x, 2.x, etc.) and run in alphabetical order
 * - fullyParallel is disabled to ensure tests run sequentially
 * - Each test gets a fresh browser context via fixtures
 */
export default defineConfig({
  testDir: './tests/e2e',

  // Global setup to check API availability before tests
  globalSetup: './tests/global-setup.ts',

  // Global teardown to clean up browser contexts
  globalTeardown: './tests/global-teardown.ts',

  // Run tests sequentially to ensure predictable order
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry failed tests (more retries on CI)
  retries: process.env.CI ? 2 : 0,

  // Amount of parallel tests to run
  workers: 4,

  // Reporter configuration
  reporter: [
    ['html', { open: 'never' }],
    ['list'], // Show test names in console
  ],

  // Global timeout for each test
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 10000,
  },

  use: {
    // Collect trace on first retry
    trace: 'on-first-retry',

    // Take screenshot on failure
    screenshot: 'only-on-failure',

    // Record video on first retry
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Load extension in persistent context
        contextOptions: {
          // Extension path will be set in test fixtures
        },
      },
    },
  ],

  // Output folder for test artifacts
  outputDir: 'tests/test-results',
});
