/**
 * Test fixtures index.
 *
 * This module exports all Playwright test fixtures and helpers.
 *
 * Structure:
 * - fixtures.ts: Core Playwright fixtures (test, expect, context management)
 * - TestClient.ts: Fluent API class for writing cleaner tests (PRIMARY API)
 * - waits.ts: Smart waiting helpers (condition-based waits)
 * - helpers.ts: Utility functions for direct page access
 * - selectors.ts: CSS selectors and field constants
 */

// Core fixtures
export { test, expect, closeCachedContext } from './fixtures';

// TestClient - the primary API for writing tests
export { TestClient } from './TestClient';

// Smart waiting helpers
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

// Utility helpers for direct page access
export {
  getFieldValue,
  getUsernameValue,
  getPasswordValue,
  getNotesValue,
} from './helpers';

// Field selectors and constants
export { FieldKey, FieldSelectors, ButtonSelectors } from './selectors';
