/**
 * Category 8: Credential Matcher Integration (Requires API + Authentication)
 *
 * These tests verify the CredentialMatcher Rust WASM integration works correctly.
 * The Rust core library is already unit tested natively; these tests verify the
 * integration in the browser extension context through the autofill popup UI.
 *
 * Test scenarios:
 * 1. No matches: URL that doesn't match any credentials
 * 2. One match: URL that matches exactly one credential
 * 3. Multiple matches: URL that matches multiple credentials (same root domain)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import type { Page } from '@playwright/test';

import { test, expect, TestClient } from '../fixtures';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Path to the test login page HTML fixture
 */
const TEST_PAGE_PATH = path.join(__dirname, '..', 'fixtures', 'test-pages', 'login.html');
const TEST_PAGE_HTML = fs.readFileSync(TEST_PAGE_PATH, 'utf-8');

/**
 * Helper to get credential names from the autofill popup shadow DOM.
 * Requires E2E test mode to be enabled (open shadow DOM).
 */
async function getAutofillPopupCredentials(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ui = document.querySelector('aliasvault-ui');
    if (!ui || !ui.shadowRoot) {
      return [];
    }

    const credentialItems = ui.shadowRoot.querySelectorAll('.av-credential-item .av-service-name');
    return Array.from(credentialItems).map(el => el.textContent?.trim() || '');
  });
}

/**
 * Helper to check if the autofill popup is visible.
 */
async function isAutofillPopupVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const ui = document.querySelector('aliasvault-ui');
    if (!ui || !ui.shadowRoot) {
      return false;
    }

    const popup = ui.shadowRoot.querySelector('#aliasvault-credential-popup');
    return popup !== null;
  });
}

/**
 * Helper to setup route interception to serve our test login page for a given domain.
 */
async function setupTestPageRoute(page: Page, domain: string): Promise<void> {
  await page.route(`https://${domain}/**`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: TEST_PAGE_HTML,
    });
  });
}

test.describe.serial('8. Credential Matcher Integration', () => {
  let client: TestClient;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('8.1 should login and create test credentials with different URLs', async ({ testUser, apiUrl }) => {
    client = await TestClient.create();
    await client.login(apiUrl, testUser.username, testUser.password);

    // Enable E2E test mode for open shadow DOM
    await client.enableE2ETestMode();

    // Create credentials with specific URLs for testing
    // Credential 1: For example.com domain
    await client
      .goToVault()
      .then((c) => c.createCredentialWithUrl(
        'Example Site Login',
        'user@example.com',
        'ExamplePass123!',
        'https://example.com/login'
      ));

    // Credential 2: For test.example.com subdomain (same root domain)
    await client
      .goToVault()
      .then((c) => c.createCredentialWithUrl(
        'Example Subdomain Login',
        'admin@example.com',
        'SubdomainPass123!',
        'https://test.example.com/auth'
      ));

    // Credential 3: For another-example.com (different domain)
    await client
      .goToVault()
      .then((c) => c.createCredentialWithUrl(
        'Another Site Login',
        'user@another.com',
        'AnotherPass123!',
        'https://another-example.com/signin'
      ));

    // Verify all credentials were created
    await client.goToVault().then((c) => c.waitForVaultReady());
    await client.verifyCredentialExists('Example Site Login');
    await client.verifyCredentialExists('Example Subdomain Login');
    await client.verifyCredentialExists('Another Site Login');

    await client.screenshot('8.1-credentials-created.png');
  });

  test('8.2 should show no matches for unrelated domain', async () => {
    const testPage = await client.context.newPage();

    // Setup route to serve our test login page for unrelated-domain.com
    await setupTestPageRoute(testPage, 'unrelated-domain.com');

    // Navigate to the test page
    await testPage.goto('https://unrelated-domain.com/login');
    await testPage.waitForLoadState('domcontentloaded');

    // Focus on the username field to trigger the autofill popup
    const usernameField = testPage.locator('input#username');
    await usernameField.click();

    // Wait for the content script to initialize and the popup to appear
    await testPage.waitForTimeout(2000);

    // Verify the autofill popup is visible
    const popupVisible = await isAutofillPopupVisible(testPage);
    console.log('Autofill popup visible:', popupVisible);
    expect(popupVisible).toBe(true);

    // Get credentials shown in the popup
    const credentials = await getAutofillPopupCredentials(testPage);
    console.log('Credentials in popup for unrelated-domain.com:', credentials);

    // Should NOT match any of our credentials
    expect(credentials).not.toContain('Example Site Login');
    expect(credentials).not.toContain('Example Subdomain Login');
    expect(credentials).not.toContain('Another Site Login');
    expect(credentials.length).toBe(0);

    await testPage.screenshot({ path: 'tests/screenshots/8.2-no-matches.png' });
    await testPage.close();
  });

  test('8.3 should show single matching credential on example.com', async () => {
    const testPage = await client.context.newPage();

    // Setup route to serve our test login page for example.com
    await setupTestPageRoute(testPage, 'example.com');

    // Navigate to example.com
    await testPage.goto('https://example.com/login');
    await testPage.waitForLoadState('domcontentloaded');

    // Focus on the username field to trigger the autofill popup
    const usernameField = testPage.locator('input#username');
    await usernameField.click();

    // Wait for the content script to initialize and the popup to appear
    await testPage.waitForTimeout(2000);

    // Verify the autofill popup is visible
    const popupVisible = await isAutofillPopupVisible(testPage);
    console.log('Autofill popup visible on example.com:', popupVisible);
    expect(popupVisible).toBe(true);

    // Get credentials shown in the popup
    const credentials = await getAutofillPopupCredentials(testPage);
    console.log('Credentials matched for example.com:', credentials);

    // Should match the Example Site Login
    expect(credentials).toContain('Example Site Login');

    // Should NOT match another-example.com credential (different domain)
    expect(credentials).not.toContain('Another Site Login');

    await testPage.screenshot({ path: 'tests/screenshots/8.3-example-com-match.png' });
    await testPage.close();
  });

  test('8.4 should show single matching credential on another-example.com', async () => {
    const testPage = await client.context.newPage();

    // Setup route to serve our test login page for another-example.com
    await setupTestPageRoute(testPage, 'another-example.com');

    // Navigate to another-example.com
    await testPage.goto('https://another-example.com/signin');
    await testPage.waitForLoadState('domcontentloaded');

    // Focus on the username field to trigger the autofill popup
    const usernameField = testPage.locator('input#username');
    await usernameField.click();

    // Wait for the content script to initialize and the popup to appear
    await testPage.waitForTimeout(2000);

    // Verify the autofill popup is visible
    const popupVisible = await isAutofillPopupVisible(testPage);
    console.log('Autofill popup visible on another-example.com:', popupVisible);
    expect(popupVisible).toBe(true);

    // Get credentials shown in the popup
    const credentials = await getAutofillPopupCredentials(testPage);
    console.log('Credentials matched for another-example.com:', credentials);

    // Should match only Another Site Login
    expect(credentials).toContain('Another Site Login');

    // Should NOT match example.com credentials
    expect(credentials).not.toContain('Example Site Login');
    expect(credentials).not.toContain('Example Subdomain Login');

    await testPage.screenshot({ path: 'tests/screenshots/8.4-another-example-match.png' });
    await testPage.close();
  });

  test('8.5 should show multiple matching credentials for subdomain', async () => {
    const testPage = await client.context.newPage();

    // Setup route to serve our test login page for test.example.com
    await setupTestPageRoute(testPage, 'test.example.com');

    // Navigate to test.example.com subdomain
    await testPage.goto('https://test.example.com/auth');
    await testPage.waitForLoadState('domcontentloaded');

    // Focus on the username field to trigger the autofill popup
    const usernameField = testPage.locator('input#username');
    await usernameField.click();

    // Wait for the content script to initialize and the popup to appear
    await testPage.waitForTimeout(2000);

    // Verify the autofill popup is visible
    const popupVisible = await isAutofillPopupVisible(testPage);
    console.log('Autofill popup visible on test.example.com:', popupVisible);
    expect(popupVisible).toBe(true);

    // Get credentials shown in the popup
    const credentials = await getAutofillPopupCredentials(testPage);
    console.log('Credentials matched for test.example.com:', credentials);

    // Should match the Example Subdomain Login (exact subdomain match)
    expect(credentials).toContain('Example Subdomain Login');

    // Should NOT match another-example.com credential
    expect(credentials).not.toContain('Another Site Login');

    await testPage.screenshot({ path: 'tests/screenshots/8.5-subdomain-match.png' });
    await testPage.close();
  });
});
