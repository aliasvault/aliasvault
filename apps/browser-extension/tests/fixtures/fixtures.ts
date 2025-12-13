import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

import { createTestUser, type TestUser } from '../helpers/test-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Path to the built Chrome extension.
 * Run `npm run build:chrome` before running E2E tests.
 */
const EXTENSION_PATH = path.join(__dirname, '..', '..', 'dist', 'chrome-mv3');

/**
 * Default API URL for local development.
 */
const DEFAULT_API_URL = process.env.ALIASVAULT_API_URL || 'http://localhost:5092';

/**
 * Test-scoped fixtures (created per test file/describe block).
 */
type TestFixtures = {
  context: BrowserContext;
  extensionId: string;
  testUser: TestUser;
  apiUrl: string;
};

/**
 * Cache for browser context within a test file.
 * This allows tests within the same describe.serial block to share context,
 * while ensuring each test FILE gets a fresh context (logged out state).
 */
let cachedContext: BrowserContext | null = null;
let cachedExtensionId: string | null = null;
let contextTestFile: string | null = null;

/**
 * Extended test fixture that provides a browser context with the extension loaded,
 * a test user, and helper functions.
 *
 * Each test file gets a fresh browser context, ensuring tests start in a logged-out state.
 * Tests within the same file can share the context via describe.serial blocks.
 */
export const test = base.extend<TestFixtures>({
  apiUrl: [DEFAULT_API_URL, { option: true }],

  // Context that's fresh per test file but shared within a file
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use, testInfo) => {
    const currentTestFile = testInfo.file;

    // If we have a cached context from a different file, close it
    if (cachedContext && contextTestFile !== currentTestFile) {
      await cachedContext.close();
      cachedContext = null;
      cachedExtensionId = null;
      contextTestFile = null;
    }

    // Create new context if we don't have one for this file
    if (!cachedContext) {
      cachedContext = await chromium.launchPersistentContext('', {
        headless: false, // Extensions require headed mode
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          '--no-first-run',
          '--disable-gpu',
        ],
      });
      contextTestFile = currentTestFile;

      // Wait for service worker and get extension ID
      let [background] = cachedContext.serviceWorkers();
      if (!background) {
        background = await cachedContext.waitForEvent('serviceworker');
      }
      cachedExtensionId = background.url().split('/')[2];
    }

    await use(cachedContext);

    // Don't close here - let it be reused within the same file
    // It will be closed when the next file starts or when tests end
  },

  extensionId: async ({ context }, use) => {
    // Extension ID is cached along with context
    if (!cachedExtensionId) {
      let [background] = context.serviceWorkers();
      if (!background) {
        background = await context.waitForEvent('serviceworker');
      }
      cachedExtensionId = background.url().split('/')[2];
    }
    await use(cachedExtensionId);
  },

  testUser: async ({ apiUrl }, use) => {
    // API availability is checked in global setup
    // Create a test user for this test run
    const testUser = await createTestUser(apiUrl);
    await use(testUser);
  },
});

export const expect = test.expect;

/**
 * Close the cached browser context.
 * Call this in afterAll hooks or global teardown to ensure clean shutdown.
 */
export async function closeCachedContext(): Promise<void> {
  if (cachedContext) {
    await cachedContext.close();
    cachedContext = null;
    cachedExtensionId = null;
    contextTestFile = null;
  }
}

/**
 * Helper to wait for the popup to finish initial loading.
 *
 * The popup shows a loading spinner overlay (with z-50) during initial load.
 * This function waits for actual content to be visible, indicating loading is complete.
 *
 * @param popup - The popup page
 * @param timeout - Maximum time to wait in milliseconds (default: 10000)
 */
export async function waitForPopupReady(popup: Page, timeout: number = 10000): Promise<void> {
  // Wait for the loading overlay to disappear by waiting for actual content to be interactable.
  // The login form has input fields that only become visible after loading completes.
  // We wait for either the login form inputs OR the settings button (visible on login page).
  // Using CSS-only selectors to avoid mixing with Playwright-specific selectors.
  await popup.waitForSelector(
    'input[type="text"], input[type="password"], button#settings',
    { state: 'visible', timeout }
  );
}

/**
 * Helper to open the extension popup and wait for it to be ready.
 *
 * @param context - The browser context
 * @param extensionId - The extension ID
 * @param waitForReady - Whether to wait for the popup to finish loading (default: true)
 */
export async function openPopup(
  context: BrowserContext,
  extensionId: string,
  waitForReady: boolean = true
): Promise<Page> {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);

  if (waitForReady) {
    await waitForPopupReady(popupPage);
  }

  return popupPage;
}

/**
 * Helper to wait for post-login state (vault is visible).
 *
 * This confirms the user has successfully logged in and the vault UI is ready.
 *
 * @param popup - The popup page
 * @param timeout - Maximum time to wait in milliseconds (default: 30000)
 */
export async function waitForLoggedIn(popup: Page, timeout: number = 30000): Promise<void> {
  await popup.getByRole('button', { name: 'Vault' }).waitFor({ state: 'visible', timeout });
}

/**
 * Helper to configure the extension to use a custom API URL.
 *
 * @param popup - The popup page
 * @param apiUrl - The API URL to configure
 */
export async function configureApiUrl(popup: Page, apiUrl: string): Promise<void> {
  // Click settings button
  const settingsButton = await popup.waitForSelector('button#settings');
  await settingsButton.click();

  // Select "Self-hosted" (custom) option
  await popup.selectOption('select', ['custom']);

  // Fill in the custom URL input
  await popup.fill('input#custom-api-url', apiUrl);

  // Go back to main page
  await popup.click('button#back');

  // Wait for the login form to be visible (indicates settings were saved and we're back)
  await popup.waitForSelector('input[type="text"], input[type="password"]', { state: 'visible' });
}

/**
 * Helper to login to the extension.
 *
 * @param popup - The popup page
 * @param username - The username to login with
 * @param password - The password to login with
 * @param waitForSuccess - Whether to wait for the login to complete successfully
 */
export async function login(
  popup: Page,
  username: string,
  password: string,
  waitForSuccess: boolean = true
): Promise<void> {
  // Fill in credentials
  await popup.fill('input[type="text"]', username);
  await popup.fill('input[type="password"]', password);

  // Click login button
  await popup.click('button:has-text("Log in")');

  // Wait for login to complete if requested
  if (waitForSuccess) {
    await waitForLoggedIn(popup);
  }
}

/**
 * Helper to perform full login flow: configure API URL, then login.
 *
 * @param popup - The popup page
 * @param apiUrl - The API URL to use
 * @param username - The username to login with
 * @param password - The password to login with
 * @param waitForSuccess - Whether to wait for the login to complete successfully
 */
export async function fullLoginFlow(
  popup: Page,
  apiUrl: string,
  username: string,
  password: string,
  waitForSuccess: boolean = true
): Promise<void> {
  await configureApiUrl(popup, apiUrl);
  await login(popup, username, password, waitForSuccess);
}

/**
 * Creates a fresh browser context with the extension loaded.
 * This is useful for multi-client tests where you need independent browser instances.
 *
 * IMPORTANT: The caller is responsible for closing the context when done.
 *
 * @returns An object containing the context and extension ID
 */
export async function createFreshContext(): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext('', {
    headless: false, // Extensions require headed mode
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--disable-gpu',
    ],
  });

  // Wait for service worker and get extension ID
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker');
  }
  const extensionId = background.url().split('/')[2];

  return { context, extensionId };
}
