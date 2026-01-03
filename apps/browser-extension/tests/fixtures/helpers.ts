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
