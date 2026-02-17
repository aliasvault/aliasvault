/**
 * Category 9: Save Login Prompt (Requires API + Authentication)
 *
 * These tests verify the save login prompt functionality that appears when
 * users submit login forms on arbitrary websites.
 *
 * Test scenarios:
 * 1. Prompt appears after submitting login form
 * 2. Clicking "Save" adds the credential to the vault
 * 3. Clicking dismiss (X) does not add the credential
 * 4. Clicking "Never for this site" blocks future prompts for that domain
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

/**
 * Helper to check if the save prompt is visible in the shadow DOM.
 */
async function isSavePromptVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // Check both possible shadow root containers
    const savePromptUI = document.querySelector('aliasvault-save-prompt');
    if (savePromptUI && savePromptUI.shadowRoot) {
      const prompt = savePromptUI.shadowRoot.querySelector('.av-save-prompt--visible');
      if (prompt) {
        return true;
      }
    }

    const mainUI = document.querySelector('aliasvault-ui');
    if (mainUI && mainUI.shadowRoot) {
      const prompt = mainUI.shadowRoot.querySelector('.av-save-prompt--visible');
      if (prompt) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Helper to wait for save prompt to appear.
 */
async function waitForSavePrompt(page: Page, timeout: number = 10000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await isSavePromptVisible(page)) {
      // Give it a moment to fully render
      await page.waitForTimeout(100);
      return;
    }
    await page.waitForTimeout(200);
  }

  throw new Error(`Save prompt did not appear within ${timeout}ms`);
}

/**
 * Helper to click a button in the save prompt.
 */
async function clickSavePromptButton(page: Page, buttonClass: string): Promise<void> {
  await page.evaluate((btnClass) => {
    // Check both possible shadow root containers
    const containers = [
      document.querySelector('aliasvault-save-prompt'),
      document.querySelector('aliasvault-ui'),
    ];

    for (const container of containers) {
      if (container && container.shadowRoot) {
        const button = container.shadowRoot.querySelector(btnClass) as HTMLButtonElement;
        if (button) {
          button.click();
          return;
        }
      }
    }
    throw new Error(`Button ${btnClass} not found in save prompt`);
  }, buttonClass);
}

/**
 * Helper to fill the service name input in the save prompt.
 */
async function fillServiceName(page: Page, serviceName: string): Promise<void> {
  await page.evaluate((name) => {
    const containers = [
      document.querySelector('aliasvault-save-prompt'),
      document.querySelector('aliasvault-ui'),
    ];

    for (const container of containers) {
      if (container && container.shadowRoot) {
        const input = container.shadowRoot.querySelector('.av-save-prompt__service-input') as HTMLInputElement;
        if (input) {
          // Clear and set value, then dispatch events to ensure React/JS picks up the change
          input.focus();
          input.value = name;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
    }
    throw new Error('Service name input not found in save prompt');
  }, serviceName);
}

/**
 * Helper to submit the login form on the test page.
 * Waits for the content script to initialize before filling and submitting.
 */
async function submitLoginForm(page: Page, username: string, password: string): Promise<void> {
  // Wait for the content script to initialize (it has a 750ms delay + some buffer)
  await page.waitForTimeout(1000);

  await page.fill('input#username', username);
  await page.fill('input#password', password);

  // Click outside the form fields to dismiss any autofill popup that might be blocking the submit button
  // We click on the form title which is safely above the input fields
  await page.click('h1');
  await page.waitForTimeout(200);

  // Click the submit button - this triggers the LoginDetector's button click handler
  await page.click('button[type="submit"]');

  // Wait a bit for the login detector's debounce (100ms) and processing
  await page.waitForTimeout(300);
}

/**
 * Helper to enable the login save feature.
 */
async function enableLoginSaveFeature(client: TestClient): Promise<void> {
  await client.popup.evaluate(() => {
    return new Promise<void>((resolve) => {
      chrome.storage.local.set({ loginSaveEnabled: true }, () => {
        resolve();
      });
    });
  });
}

/**
 * Helper to clear blocked domains list.
 */
async function clearBlockedDomains(client: TestClient): Promise<void> {
  await client.popup.evaluate(() => {
    return new Promise<void>((resolve) => {
      chrome.storage.local.remove('loginSaveBlockedDomains', () => {
        resolve();
      });
    });
  });
}

/**
 * Helper to get the blocked domains list.
 */
async function getBlockedDomains(client: TestClient): Promise<string[]> {
  return client.popup.evaluate(() => {
    return new Promise<string[]>((resolve) => {
      chrome.storage.local.get('loginSaveBlockedDomains', (result) => {
        resolve(result.loginSaveBlockedDomains || []);
      });
    });
  });
}

test.describe.serial('9. Save Login Prompt', () => {
  let client: TestClient;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('9.1 should login, enable save feature, and verify prompt appears on form submit', async ({ testUser, apiUrl }) => {
    client = await TestClient.create();
    await client.login(apiUrl, testUser.username, testUser.password);

    // Enable E2E test mode for open shadow DOM
    await client.enableE2ETestMode();

    // Enable the login save feature
    await enableLoginSaveFeature(client);

    // Clear any blocked domains from previous test runs
    await clearBlockedDomains(client);

    // Create a test page on a domain
    const testPage = await client.context.newPage();
    await setupTestPageRoute(testPage, 'save-test-domain.com');
    await testPage.goto('https://save-test-domain.com/login');
    await testPage.waitForLoadState('networkidle');

    // Submit the login form
    await submitLoginForm(testPage, 'testuser@example.com', 'TestPassword123!');

    // Wait for the save prompt to appear
    await waitForSavePrompt(testPage);

    // Verify the prompt is visible
    const promptVisible = await isSavePromptVisible(testPage);
    expect(promptVisible).toBe(true);

    await testPage.screenshot({ path: 'tests/screenshots/9.1-save-prompt-visible.png' });

    // Dismiss the prompt for now (we'll test save functionality in next test)
    await clickSavePromptButton(testPage, '.av-save-prompt__btn--dismiss');

    await testPage.close();
  });

  test('9.2 should save credential to vault when clicking Save', async () => {
    // Create a test page on a new domain
    const testPage = await client.context.newPage();
    await setupTestPageRoute(testPage, 'save-credential-test.com');
    await testPage.goto('https://save-credential-test.com/login');
    await testPage.waitForLoadState('networkidle');

    // Submit the login form
    const testUsername = 'savetest@example.com';
    const testPassword = 'SaveTestPass123!';
    await submitLoginForm(testPage, testUsername, testPassword);

    // Wait for the save prompt to appear
    await waitForSavePrompt(testPage);

    // Verify prompt is actually visible before proceeding
    const promptVisibleBeforeSave = await isSavePromptVisible(testPage);
    expect(promptVisibleBeforeSave).toBe(true);

    await testPage.screenshot({ path: 'tests/screenshots/9.2-prompt-visible.png' });

    // Fill in a custom service name
    const serviceName = 'Save Credential Test Site';
    await fillServiceName(testPage, serviceName);

    await testPage.screenshot({ path: 'tests/screenshots/9.2-before-save.png' });

    // Click the Save button
    await clickSavePromptButton(testPage, '.av-save-prompt__btn--save');

    // Wait for the credential to be saved and synced
    await testPage.waitForTimeout(2000);

    await testPage.screenshot({ path: 'tests/screenshots/9.2-after-save.png' });

    // Trigger a sync to ensure the vault is up to date
    await client.triggerSync();

    // Verify the credential was added to the vault
    await client.goToVault().then(c => c.waitForVaultReady());
    await client.verifyCredentialExists(serviceName);

    await client.screenshot('9.2-credential-saved-in-vault.png');

    await testPage.close();
  });

  test('9.3 should NOT save credential when clicking Dismiss', async () => {
    // Get the current vault item count
    await client.goToVault().then(c => c.waitForVaultReady());
    const initialItemCount = await client.popup.locator('ul#items-list > li').count();

    // Create a test page on a new domain
    const testPage = await client.context.newPage();
    await setupTestPageRoute(testPage, 'dismiss-test-domain.com');
    await testPage.goto('https://dismiss-test-domain.com/login');
    await testPage.waitForLoadState('networkidle');

    // Submit the login form
    await submitLoginForm(testPage, 'dismisstest@example.com', 'DismissTestPass123!');

    // Wait for the save prompt to appear
    await waitForSavePrompt(testPage);

    await testPage.screenshot({ path: 'tests/screenshots/9.3-prompt-before-dismiss.png' });

    // Click the Dismiss button (X icon)
    await clickSavePromptButton(testPage, '.av-save-prompt__btn--dismiss');

    // Wait to ensure the dismiss action completes
    await testPage.waitForTimeout(500);

    // Verify the prompt is no longer visible
    const promptStillVisible = await isSavePromptVisible(testPage);
    expect(promptStillVisible).toBe(false);

    // Verify no new credential was added to the vault
    await client.goToVault().then(c => c.waitForVaultReady());
    const finalItemCount = await client.popup.locator('ul#items-list > li').count();
    expect(finalItemCount).toBe(initialItemCount);

    await client.screenshot('9.3-vault-unchanged-after-dismiss.png');

    await testPage.close();
  });

  test('9.4 should block future prompts when clicking Never for this site', async () => {
    // Create a test page on a specific domain
    const blockedDomain = 'never-save-domain.com';
    const testPage = await client.context.newPage();
    await setupTestPageRoute(testPage, blockedDomain);
    await testPage.goto(`https://${blockedDomain}/login`);
    await testPage.waitForLoadState('networkidle');

    // Submit the login form
    await submitLoginForm(testPage, 'neveruser@example.com', 'NeverSavePass123!');

    // Wait for the save prompt to appear
    await waitForSavePrompt(testPage);

    await testPage.screenshot({ path: 'tests/screenshots/9.4-prompt-before-never.png' });

    // Click the "Never for this site" button
    await clickSavePromptButton(testPage, '.av-save-prompt__btn--never');

    // Wait to ensure the action completes
    await testPage.waitForTimeout(500);

    // Verify the prompt is no longer visible
    const promptStillVisible = await isSavePromptVisible(testPage);
    expect(promptStillVisible).toBe(false);

    // Verify the domain was added to the blocked list
    const blockedDomains = await getBlockedDomains(client);
    expect(blockedDomains).toContain(blockedDomain);

    await testPage.screenshot({ path: 'tests/screenshots/9.4-prompt-dismissed.png' });

    // Now try submitting the form again on the same domain
    // First, refresh the page to get a clean state
    await testPage.goto(`https://${blockedDomain}/login`);
    await testPage.waitForLoadState('networkidle');

    // Submit the form again with different credentials
    await submitLoginForm(testPage, 'anotheruser@example.com', 'AnotherPass123!');

    // Wait a bit to see if the prompt would appear
    await testPage.waitForTimeout(3000);

    // Verify the prompt does NOT appear this time
    const promptAppearedAgain = await isSavePromptVisible(testPage);
    expect(promptAppearedAgain).toBe(false);

    await testPage.screenshot({ path: 'tests/screenshots/9.4-no-prompt-on-blocked-domain.png' });

    await testPage.close();
  });

  test('9.5 should show prompt on new domain even after blocking another', async () => {
    // Verify that blocking one domain doesn't affect other domains
    const newDomain = 'new-unblocked-domain.com';
    const testPage = await client.context.newPage();
    await setupTestPageRoute(testPage, newDomain);
    await testPage.goto(`https://${newDomain}/login`);
    await testPage.waitForLoadState('networkidle');

    // Submit the login form
    await submitLoginForm(testPage, 'newuser@example.com', 'NewDomainPass123!');

    // Wait for the save prompt to appear
    await waitForSavePrompt(testPage);

    // Verify the prompt is visible (this domain is not blocked)
    const promptVisible = await isSavePromptVisible(testPage);
    expect(promptVisible).toBe(true);

    await testPage.screenshot({ path: 'tests/screenshots/9.5-prompt-on-unblocked-domain.png' });

    // Clean up - dismiss the prompt
    await clickSavePromptButton(testPage, '.av-save-prompt__btn--dismiss');

    await testPage.close();
  });
});
