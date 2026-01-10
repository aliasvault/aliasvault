/**
 * Smart waiting helpers for E2E tests.
 *
 * This module provides condition-based waiting functions that replace
 * fixed timeouts with intelligent waits for specific UI states.
 */
import type { Page, Locator } from '@playwright/test';

import { expect } from './fixtures';
import { FieldSelectors } from './selectors';

/**
 * Default timeout values for different wait scenarios.
 */
export const Timeouts = {
  SHORT: 5000,
  MEDIUM: 10000,
  LONG: 30000,
} as const;

/**
 * Generic wait helper that waits for a locator to be visible.
 * This is the building block for more specific wait functions.
 *
 * @param locator - The Playwright locator to wait for
 * @param timeout - Timeout in milliseconds
 */
export async function waitFor(locator: Locator, timeout: number = Timeouts.MEDIUM): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout });
}

/**
 * Wait for a locator to be hidden/detached.
 *
 * @param locator - The Playwright locator to wait for
 * @param timeout - Timeout in milliseconds
 */
export async function waitForHidden(locator: Locator, timeout: number = Timeouts.MEDIUM): Promise<void> {
  await locator.waitFor({ state: 'hidden', timeout });
}

/**
 * Wait for text to appear on the page.
 *
 * @param popup - The popup page
 * @param text - The text to wait for
 * @param timeout - Timeout in milliseconds
 */
export async function waitForText(popup: Page, text: string, timeout: number = Timeouts.MEDIUM): Promise<void> {
  await expect(popup.locator(`text=${text}`)).toBeVisible({ timeout });
}

/**
 * Wait for the vault UI to be ready (bottom navigation visible).
 * This indicates the app has finished loading/sync and is ready for interaction.
 *
 * @param popup - The popup page
 * @param timeout - Timeout in milliseconds
 */
export async function waitForVaultReady(popup: Page, timeout: number = Timeouts.MEDIUM): Promise<void> {
  await popup.locator('#nav-vault').waitFor({ state: 'visible', timeout });
}

/**
 * Wait for a sync operation to complete.
 * Detects sync by waiting for the vault content to update or sync indicator to disappear.
 *
 * @param popup - The popup page
 * @param timeout - Timeout in milliseconds
 */
export async function waitForSyncComplete(popup: Page, timeout: number = Timeouts.MEDIUM): Promise<void> {
  // Wait for any loading spinner to disappear (if present)
  const loadingOverlay = popup.locator('.z-50');
  await loadingOverlay.waitFor({ state: 'hidden', timeout }).catch(() => {
    // Loading overlay might not exist, which is fine
  });

  // Also wait for the vault button to be visible and enabled
  await waitForVaultReady(popup, timeout);
}

/**
 * Wait for a credential to be saved and appear in the vault.
 *
 * @param popup - The popup page
 * @param credentialName - The name of the credential to wait for
 * @param timeout - Timeout in milliseconds
 */
export async function waitForCredentialSaved(
  popup: Page,
  credentialName: string,
  timeout: number = Timeouts.LONG
): Promise<void> {
  await expect(popup.locator(`text=${credentialName}`)).toBeVisible({ timeout });
}

/**
 * Wait for the settings page to be visible.
 *
 * @param popup - The popup page
 * @param timeout - Timeout in milliseconds
 */
export async function waitForSettingsPage(popup: Page, timeout: number = Timeouts.SHORT): Promise<void> {
  await popup.locator('button[title="Lock"]').waitFor({ state: 'visible', timeout });
}

/**
 * Wait for the unlock page to be visible.
 *
 * @param popup - The popup page
 * @param timeout - Timeout in milliseconds
 */
export async function waitForUnlockPage(popup: Page, timeout: number = Timeouts.SHORT): Promise<void> {
  await popup.locator('input#password').waitFor({ state: 'visible', timeout });
}

/**
 * Wait for the credential edit form to be fully loaded.
 *
 * @param popup - The popup page
 * @param timeout - Timeout in milliseconds
 */
export async function waitForEditForm(popup: Page, timeout: number = Timeouts.MEDIUM): Promise<void> {
  await expect(popup.locator(FieldSelectors.LOGIN_USERNAME)).toBeVisible({ timeout });
}

/**
 * Wait for navigation to complete after a page change.
 *
 * @param popup - The popup page
 * @param timeout - Timeout in milliseconds
 */
export async function waitForNavigation(popup: Page, timeout: number = Timeouts.SHORT): Promise<void> {
  await popup.waitForLoadState('domcontentloaded', { timeout });
  await popup.locator('#root').waitFor({ state: 'visible', timeout });
}

/**
 * Wait for the offline indicator to appear on the page.
 *
 * @param popup - The popup page
 * @param timeout - Timeout in milliseconds
 */
export async function waitForOfflineIndicator(popup: Page, timeout: number = Timeouts.SHORT): Promise<void> {
  const offlineIndicator = popup.locator('div.bg-amber-100, div.bg-amber-900\\/30').filter({ hasText: 'Offline' });
  await expect(offlineIndicator).toBeVisible({ timeout });
}

/**
 * Wait for the login form to be visible.
 *
 * @param popup - The popup page
 * @param timeout - Timeout in milliseconds
 */
export async function waitForLoginForm(popup: Page, timeout: number = Timeouts.SHORT): Promise<void> {
  await popup.waitForSelector('input[type="text"], input[type="password"]', { state: 'visible', timeout });
}

/**
 * Check if the offline indicator is visible.
 *
 * @param popup - The popup page
 * @returns True if the offline indicator is visible
 */
export async function isOfflineIndicatorVisible(popup: Page): Promise<boolean> {
  const offlineIndicator = popup.locator('div.bg-amber-100, div.bg-amber-900\\/30').filter({ hasText: 'Offline' });
  return offlineIndicator.isVisible().catch(() => false);
}
