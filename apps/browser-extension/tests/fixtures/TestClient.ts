/**
 * TestClient - A fluent API wrapper for browser extension E2E testing.

 * Example usage:
 * ```typescript
 * const client = await TestClient.create();
 * await client
 *   .login(apiUrl, username, password)
 *   .createCredential('My Login', 'user@example.com', 'password123')
 *   .verifyCredentialExists('My Login');
 * ```
 */
import type { BrowserContext, Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

import { expect } from './fixtures';
import { FieldSelectors, ButtonSelectors } from './selectors';
import {
  waitForVaultReady,
  waitForSyncComplete,
  waitForCredentialSaved,
  waitForSettingsPage,
  waitForUnlockPage,
  waitForOfflineIndicator,
  waitForLoginForm,
  Timeouts,
} from './waits';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.join(__dirname, '..', '..', 'dist', 'chrome-mv3');

/**
 * TestClient provides a fluent API for E2E testing of the browser extension.
 */
export class TestClient {
  public context: BrowserContext;
  public extensionId: string;
  public popup: Page;

  private constructor(context: BrowserContext, extensionId: string, popup: Page) {
    this.context = context;
    this.extensionId = extensionId;
    this.popup = popup;
  }

  /**
   * Create a new TestClient with a fresh browser context.
   */
  static async create(): Promise<TestClient> {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
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

    // Open popup
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForSelector('input[type="text"], input[type="password"], button#settings', {
      state: 'visible',
      timeout: Timeouts.MEDIUM,
    });

    return new TestClient(context, extensionId, popup);
  }

  /**
   * Create a TestClient from an existing browser context (for shared fixture tests).
   */
  static async fromContext(context: BrowserContext, extensionId: string): Promise<TestClient> {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForSelector('input[type="text"], input[type="password"], button#settings', {
      state: 'visible',
      timeout: Timeouts.MEDIUM,
    });
    return new TestClient(context, extensionId, popup);
  }

  /**
   * Configure the API URL for the extension.
   * Verifies the URL is displayed on the login page after configuration.
   */
  async configureApiUrl(apiUrl: string): Promise<this> {
    const settingsButton = await this.popup.waitForSelector('button#settings');
    await settingsButton.click();
    await this.popup.selectOption('select', ['custom']);
    await this.popup.fill('input#custom-api-url', apiUrl);
    await this.popup.click('button#back');
    await waitForLoginForm(this.popup);

    // Sanity check: verify the configured URL is displayed on the login page
    // This catches cases where the URL wasn't saved (e.g., debounce issues)
    const displayedUrl = await this.popup.locator('text=' + new URL(apiUrl).host).isVisible({ timeout: 2000 })
      .catch(() => false);
    if (!displayedUrl) {
      throw new Error(`API URL configuration failed: expected "${apiUrl}" to be displayed on login page, but it wasn't. This may indicate the URL was not saved properly.`);
    }

    return this;
  }

  /**
   * Open the login settings page (before authentication).
   */
  async openLoginSettings(): Promise<this> {
    const settingsButton = this.popup.locator('button#settings');
    await settingsButton.click();
    await expect(this.popup.locator('select')).toBeVisible();
    return this;
  }

  /**
   * Go back from login settings to login page.
   */
  async backToLogin(): Promise<this> {
    await this.popup.click('button#back');
    await waitForLoginForm(this.popup);
    return this;
  }

  /**
   * Login with username and password.
   */
  async login(apiUrl: string, username: string, password: string): Promise<this> {
    await this.configureApiUrl(apiUrl);
    await this.popup.fill('input[type="text"]', username);
    await this.popup.fill('input[type="password"]', password);
    await this.popup.click('button:has-text("Log in")');
    await this.popup.getByRole('button', { name: 'Vault' }).waitFor({ state: 'visible', timeout: Timeouts.LONG });
    return this;
  }

  /**
   * Attempt login without expecting success (for testing invalid credentials).
   */
  async attemptLogin(username: string, password: string): Promise<this> {
    await this.popup.fill('input[type="text"]', username);
    await this.popup.fill('input[type="password"]', password);
    await this.popup.click('button:has-text("Log in")');
    return this;
  }

  /**
   * Clear the login form fields.
   */
  async clearLoginForm(): Promise<this> {
    await this.popup.fill('input[type="text"]', '');
    await this.popup.fill('input[type="password"]', '');
    return this;
  }

  /**
   * Submit login credentials (already filled in form).
   */
  async submitLogin(): Promise<this> {
    await this.popup.click('button:has-text("Log in")');
    await this.popup.getByRole('button', { name: 'Vault' }).waitFor({ state: 'visible', timeout: Timeouts.LONG });
    return this;
  }

  /**
   * Fill login form fields without submitting.
   */
  async fillLoginForm(username: string, password: string): Promise<this> {
    await this.popup.fill('input[type="text"]', username);
    await this.popup.fill('input[type="password"]', password);
    return this;
  }

  /**
   * Navigate to the vault tab.
   */
  async goToVault(): Promise<this> {
    await this.popup.locator('#nav-vault').click();
    // Wait for the vault list to be ready (items list or add button visible)
    await this.popup.locator(ButtonSelectors.ADD_NEW_ITEM).waitFor({ state: 'visible', timeout: Timeouts.MEDIUM });
    return this;
  }

  /**
   * Navigate to the settings tab.
   */
  async goToSettings(): Promise<this> {
    await this.popup.getByRole('button', { name: 'Settings' }).click();
    await waitForSettingsPage(this.popup);
    return this;
  }

  /**
   * Navigate to root to trigger a fresh sync.
   * Waits for the sync indicator to disappear before returning.
   */
  async triggerSync(): Promise<this> {
    await this.popup.evaluate(() => {
      window.location.href = '/popup.html';
    });
    await this.popup.waitForLoadState('domcontentloaded');
    await waitForSyncComplete(this.popup, Timeouts.LONG);
    return this;
  }

  /**
   * Open the add credential form.
   */
  async openAddCredentialForm(): Promise<this> {
    const addButton = this.popup.locator(ButtonSelectors.ADD_NEW_ITEM);
    await expect(addButton).toBeVisible();
    await addButton.click();
    await expect(this.popup.locator(FieldSelectors.ITEM_NAME)).toBeVisible();
    return this;
  }

  /**
   * Create a new login credential.
   * The new ItemAddEdit page shows all fields directly without an intermediate step.
   */
  async createCredential(name: string, username: string, password: string): Promise<this> {
    await this.openAddCredentialForm();
    // All fields are now visible on the same page (no "Next" step)
    await expect(this.popup.locator(FieldSelectors.LOGIN_USERNAME)).toBeVisible({ timeout: Timeouts.MEDIUM });
    await this.popup.fill(FieldSelectors.ITEM_NAME, name);
    await this.popup.fill(FieldSelectors.LOGIN_USERNAME, username);
    await this.popup.fill(FieldSelectors.LOGIN_PASSWORD, password);
    await this.popup.click(ButtonSelectors.SAVE);
    await waitForCredentialSaved(this.popup, name);
    return this;
  }

  /**
   * Create a new login credential with a URL.
   * This is used for testing credential matching based on URLs.
   */
  async createCredentialWithUrl(name: string, username: string, password: string, url: string): Promise<this> {
    await this.openAddCredentialForm();
    // All fields are now visible on the same page (no "Next" step)
    await expect(this.popup.locator(FieldSelectors.LOGIN_USERNAME)).toBeVisible({ timeout: Timeouts.MEDIUM });
    await this.popup.fill(FieldSelectors.ITEM_NAME, name);
    await this.popup.fill(FieldSelectors.LOGIN_USERNAME, username);
    await this.popup.fill(FieldSelectors.LOGIN_PASSWORD, password);
    await this.popup.fill(FieldSelectors.LOGIN_URL, url);
    await this.popup.click(ButtonSelectors.SAVE);
    await waitForCredentialSaved(this.popup, name);
    return this;
  }

  /**
   * Click on a credential in the vault list.
   */
  async clickCredential(name: string): Promise<this> {
    await this.popup.locator(`text=${name}`).click();
    await this.popup.locator(ButtonSelectors.EDIT_ITEM).waitFor({ state: 'visible', timeout: Timeouts.SHORT });
    return this;
  }

  /**
   * Open the edit form for the currently viewed credential.
   */
  async openEditForm(): Promise<this> {
    const editButton = this.popup.locator(ButtonSelectors.EDIT_ITEM);
    await expect(editButton).toBeVisible({ timeout: Timeouts.SHORT });
    await editButton.click();
    await expect(this.popup.locator(FieldSelectors.LOGIN_USERNAME)).toBeVisible({ timeout: Timeouts.MEDIUM });
    return this;
  }

  /**
   * Fill a field in the credential form.
   */
  async fillField(selector: string, value: string): Promise<this> {
    await this.popup.fill(selector, value);
    return this;
  }

  /**
   * Fill the username field.
   */
  async fillUsername(username: string): Promise<this> {
    return this.fillField(FieldSelectors.LOGIN_USERNAME, username);
  }

  /**
   * Fill the password field.
   */
  async fillPassword(password: string): Promise<this> {
    return this.fillField(FieldSelectors.LOGIN_PASSWORD, password);
  }

  /**
   * Fill the notes field.
   * If the notes section is not visible, opens the add field menu and adds it first.
   */
  async fillNotes(notes: string): Promise<this> {
    // Check if notes field is visible, if not add it via the add field menu
    const notesField = this.popup.locator(FieldSelectors.LOGIN_NOTES);
    const isVisible = await notesField.isVisible().catch(() => false);

    if (!isVisible) {
      // Click the add field menu button (dashed border button)
      const addFieldButton = this.popup.locator(ButtonSelectors.ADD_FIELD_MENU);
      await expect(addFieldButton).toBeVisible({ timeout: Timeouts.SHORT });
      await addFieldButton.click();

      // Wait for menu to appear and click the Notes option
      const notesOption = this.popup.locator('button:has-text("Notes")');
      await expect(notesOption).toBeVisible({ timeout: Timeouts.SHORT });
      await notesOption.click();

      // Wait for notes field to appear
      await expect(this.popup.locator(FieldSelectors.LOGIN_NOTES)).toBeVisible({ timeout: Timeouts.MEDIUM });
    }

    return this.fillField(FieldSelectors.LOGIN_NOTES, notes);
  }

  /**
   * Save the current credential form.
   */
  async saveCredential(): Promise<this> {
    await this.popup.click(ButtonSelectors.SAVE);
    await this.popup.waitForLoadState('domcontentloaded');
    return this;
  }

  /**
   * Get the value of a field in the edit form.
   */
  async getFieldValue(selector: string): Promise<string> {
    return this.popup.locator(selector).inputValue();
  }

  /**
   * Wait for a field to have a specific value.
   * Useful for waiting for sync/merge operations to complete.
   */
  async waitForFieldValue(selector: string, expectedValue: string, timeout: number = Timeouts.LONG): Promise<this> {
    await this.popup.waitForFunction(
      ({ sel, expected }) => {
        const input = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
        return input?.value === expected;
      },
      { timeout },
      { sel: selector, expected: expectedValue }
    );
    return this;
  }

  /**
   * Verify a credential exists in the vault list.
   */
  async verifyCredentialExists(name: string, timeout: number = Timeouts.MEDIUM): Promise<this> {
    await expect(this.popup.locator(`text=${name}`)).toBeVisible({ timeout });
    return this;
  }

  /**
   * Verify the vault shows a specific item count.
   */
  async verifyVaultItemCount(count: number): Promise<this> {
    const itemsList = this.popup.locator('ul#items-list > li');
    await expect(itemsList).toHaveCount(count, { timeout: Timeouts.SHORT });
    return this;
  }

  /**
   * Enable E2E test mode which sets the shadow DOM to 'open' mode for testability.
   * This must be called before navigating to pages where you want to inspect the autofill popup.
   */
  async enableE2ETestMode(): Promise<this> {
    await this.popup.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ e2eTestMode: true }, () => {
          resolve();
        });
      });
    });
    return this;
  }

  /**
   * Disable E2E test mode.
   */
  async disableE2ETestMode(): Promise<this> {
    await this.popup.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.remove('e2eTestMode', () => {
          resolve();
        });
      });
    });
    return this;
  }

  /**
   * Enable offline mode by setting an invalid API URL.
   */
  async enableOfflineMode(): Promise<this> {
    await this.popup.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ apiUrl: 'http://offline.invalid.localhost:9999' }, () => {
          resolve();
        });
      });
    });
    return this;
  }

  /**
   * Disable offline mode by restoring a valid API URL.
   */
  async disableOfflineMode(apiUrl: string): Promise<this> {
    await this.popup.evaluate((url) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ apiUrl: url }, () => {
          resolve();
        });
      });
    }, apiUrl);
    return this;
  }

  /**
   * Wait for offline indicator to appear.
   */
  async waitForOffline(timeout: number = Timeouts.MEDIUM): Promise<this> {
    await waitForOfflineIndicator(this.popup, timeout);
    return this;
  }

  /**
   * Lock the vault.
   */
  async lockVault(): Promise<this> {
    await this.goToSettings();
    const lockButton = this.popup.locator('button[title="Lock"]');
    await lockButton.click();
    await waitForUnlockPage(this.popup);
    return this;
  }

  /**
   * Unlock the vault with password.
   */
  async unlockVault(password: string): Promise<this> {
    await this.popup.fill('input#password', password);
    await this.popup.click('button:has-text("Unlock")');
    await waitForVaultReady(this.popup, Timeouts.LONG);
    return this;
  }

  /**
   * Take a screenshot.
   */
  async screenshot(filename: string): Promise<this> {
    await this.popup.screenshot({ path: `tests/screenshots/${filename}` });
    return this;
  }

  /**
   * Wait for vault to be ready.
   */
  async waitForVaultReady(timeout: number = Timeouts.MEDIUM): Promise<this> {
    await waitForVaultReady(this.popup, timeout);
    return this;
  }

  /**
   * Clean up resources (close popup and context).
   */
  async cleanup(): Promise<void> {
    await this.popup?.close();
    await this.context?.close();
  }

  /**
   * Static helper to clean up multiple clients.
   */
  static async cleanupAll(...clients: (TestClient | null | undefined)[]): Promise<void> {
    for (const client of clients) {
      if (client) {
        await client.cleanup();
      }
    }
  }
}
