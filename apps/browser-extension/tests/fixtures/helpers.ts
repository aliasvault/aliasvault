/**
 * Shared test helpers for E2E tests.
 *
 * This module provides utility functions that can be used alongside TestClient
 * for operations that need direct page access.
 *
 * For most tests, prefer using the TestClient class which provides a fluent API.
 * These helpers are primarily for edge cases or when you need to work with
 * raw Page objects directly.
 */
import type { Page } from '@playwright/test';

import { FieldSelectors } from './selectors';
import { waitForVaultReady, Timeouts } from './waits';

// Re-export all waits
export {
  waitForVaultReady,
  waitForSyncComplete,
  waitForCredentialSaved,
  waitForSettingsPage,
  waitForUnlockPage,
  waitForEditForm,
  waitForNavigation,
  waitForOfflineIndicator,
  waitForLoginForm,
  waitForText,
  waitFor,
  waitForHidden,
  isOfflineIndicatorVisible,
  Timeouts,
} from './waits';

/**
 * Get the value of a field in the edit form.
 */
export async function getFieldValue(popup: Page, selector: string): Promise<string> {
  return popup.locator(selector).inputValue();
}

/**
 * Get the username field value.
 */
export async function getUsernameValue(popup: Page): Promise<string> {
  return getFieldValue(popup, FieldSelectors.LOGIN_USERNAME);
}

/**
 * Get the password field value.
 */
export async function getPasswordValue(popup: Page): Promise<string> {
  return getFieldValue(popup, FieldSelectors.LOGIN_PASSWORD);
}

/**
 * Get the notes field value.
 */
export async function getNotesValue(popup: Page): Promise<string> {
  return getFieldValue(popup, FieldSelectors.LOGIN_NOTES);
}

/**
 * Wait until the popup has opened the vault after a login or unlock, failing if it lands on the upgrade gate instead.
 *
 * Test accounts are created on the current storage format, so only the vault upgrade specs (90.x) may walk the gate.
 *
 * @param popup - The popup page
 * @param timeout - Timeout in milliseconds
 */
export async function waitForVaultOpen(popup: Page, timeout: number = Timeouts.LONG): Promise<void> {
  /*
   * The popup hops through `/reinitialize` before it routes on, and that route already renders the
   * bottom nav, so a visible `#nav-vault` on its own is no proof that the app has settled. The hash
   * route is: wait until it is either the gate, or anything past it showing the vault UI.
   */
  await popup.waitForFunction(
    () => window.location.hash.startsWith('#/upgrade') ||
      (!window.location.hash.startsWith('#/reinitialize') && document.querySelector('#nav-vault') !== null),
    undefined,
    { timeout }
  );

  const hash = await popup.evaluate(() => window.location.hash);
  if (hash.startsWith('#/upgrade')) {
    throw new Error('The popup landed on the vault upgrade gate, but test accounts are created on the current storage format. Only the vault upgrade specs (90.x) should reach it.');
  }

  await waitForVaultReady(popup, timeout);
}
