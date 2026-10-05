import { test as base, type BrowserContext } from '@playwright/test';

import { resolveApiUrl } from '../helpers/api-url';
import { createTestUser, generateTestUsername, TEST_DISABLE_PUBLIC_REGISTRATION_HEADER, TEST_PASSWORD, type TestUser } from '../helpers/test-api';

import { WebApp } from './WebApp';

/**
 * Credentials for a test account.
 */
export type TestCredentials = {
  username: string;
  password: string;
};

/**
 * Per-test fixtures.
 */
type TestFixtures = {
  apiUrl: string;
  publicRegistrationEnabled: boolean;
  app: WebApp;
  newApp: () => Promise<WebApp>;
  credentials: TestCredentials;
  testUser: TestUser;
};

/**
 * Test fixture with a fresh browser context per test, pointed at the test API.
 *
 * The app reads its API URL from appsettings.json at startup, so the fixture answers that request with the test
 * configuration; the same build then works against any API instance without rewriting files in dist/.
 */
export const test = base.extend<TestFixtures>({
  apiUrl: [resolveApiUrl(), { option: true }],

  /**
   * Set to false with `test.use` to run the test as if registration is closed, in both the web app and (for this test's
   * requests only) the API.
   */
  publicRegistrationEnabled: [true, { option: true }],

  /**
   * The default context, with appsettings.json answered by the test configuration.
   */
  context: async ({ context, apiUrl, publicRegistrationEnabled }, use) => {
    await prepareContext(context, apiUrl, publicRegistrationEnabled);
    await use(context);
  },

  /**
   * The page object for the test's page.
   */
  app: async ({ page }, use) => {
    await use(new WebApp(page));
  },

  /**
   * Open the web app in another browser context, as a second client next to `app`.
   */
  newApp: async ({ browser, baseURL, locale, apiUrl, publicRegistrationEnabled }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const context = await browser.newContext({ baseURL, locale });
      contexts.push(context);
      await prepareContext(context, apiUrl, publicRegistrationEnabled);
      return new WebApp(await context.newPage());
    });
    await Promise.all(contexts.map((context) => context.close()));
  },

  /**
   * Fresh credentials for an account the test registers through the UI.
   */
  // eslint-disable-next-line no-empty-pattern
  credentials: async ({}, use) => {
    await use({ username: generateTestUsername(), password: TEST_PASSWORD });
  },

  /**
   * An account registered via the API, for tests that only need to log in.
   */
  testUser: async ({ apiUrl }, use) => {
    await use(await createTestUser(apiUrl));
  },
});

export const expect = test.expect;

/**
 * Answer the app's appsettings.json request with the test configuration.
 */
async function prepareContext(context: BrowserContext, apiUrl: string, publicRegistrationEnabled: boolean): Promise<void> {
  await context.route(/\/appsettings(\.Development)?\.json(\?.*)?$/, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ApiUrl: apiUrl,
      PrivateEmailDomains: ['example.tld', 'example2.tld'],
      HiddenPrivateEmailDomains: [],
      SupportEmail: 'support@example.tld',
      PublicRegistrationEnabled: String(publicRegistrationEnabled),
      DeploymentMode: 'e2e',
      TermsUrl: 'https://example.tld/terms',
    }),
  }));
  if (!publicRegistrationEnabled) {
    await context.setExtraHTTPHeaders({ [TEST_DISABLE_PUBLIC_REGISTRATION_HEADER]: 'true' });
  }
}
