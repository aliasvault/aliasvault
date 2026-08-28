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
 * Selectors for the vault upgrade gate (the `/upgrade` route).
 */
const UpgradeSelectors = {
  UPGRADE_BUTTON: 'button#upgrade-button',
  CONTINUE_BUTTON: 'button#upgrade-continue-button',
} as const;

/**
 * Walk the vault upgrade gate, if the popup landed on it.
 *
 * Test accounts are seeded with a legacy sqlite-blob vault. TODO: update tests to work with native manifest-v1 newly created account.
 *
 * @param popup - The popup page
 * @param timeout - Timeout in milliseconds for each step of the flow
 */
export async function completeVaultUpgrade(popup: Page, timeout: number = Timeouts.LONG): Promise<void> {
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
  if (!hash.startsWith('#/upgrade')) {
    return;
  }

  /*
   * The gate classifies the pending upgrade on mount: a storage format move asks for consent, while
   * a local-only schema rebuild runs unattended and opens the vault by itself.
   */
  const upgradeButton = popup.locator(UpgradeSelectors.UPGRADE_BUTTON);
  await popup.locator(`${UpgradeSelectors.UPGRADE_BUTTON}, #nav-vault`).first().waitFor({ state: 'visible', timeout });

  if (await upgradeButton.isVisible()) {
    await upgradeButton.click();

    // The storage format upgrade ends on a success screen that auto-continues after a countdown.
    const continueButton = popup.locator(UpgradeSelectors.CONTINUE_BUTTON);
    await popup.locator(`${UpgradeSelectors.CONTINUE_BUTTON}, #nav-vault`).first().waitFor({ state: 'visible', timeout });
    if (await continueButton.isVisible()) {
      await continueButton.click();
    }
  }

  await waitForVaultReady(popup, timeout);
}
