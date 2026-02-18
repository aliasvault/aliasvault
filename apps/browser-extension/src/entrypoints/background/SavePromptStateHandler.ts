/**
 * Background script handler for save prompt state persistence.
 * Stores save prompt state in memory so it survives content script navigation.
 * Also tracks the last autofilled credential per tab for the "Add URL" feature.
 */

import type { SavePromptPersistedState, LastAutofilledCredential } from '@/utils/loginDetector';

/** In-memory storage for save prompt state, keyed by tab ID */
const savePromptStateByTab: Map<number, SavePromptPersistedState> = new Map();

/** Timeout handles for auto-clearing state after expiry */
const stateExpiryTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();

/** In-memory storage for last autofilled credential, keyed by tab ID */
const lastAutofilledByTab: Map<number, LastAutofilledCredential> = new Map();

/** Timeout handles for auto-clearing autofill state after expiry */
const autofillExpiryTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();

/** How long to remember the last autofilled credential (5 minutes, to allow for extended prompt focus) */
const AUTOFILL_STATE_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Store save prompt state for a tab.
 * @param data - The state data and tab ID.
 * @returns Success response.
 */
export function handleStoreSavePromptState(
  data: { tabId: number; state: SavePromptPersistedState }
): { success: boolean } {
  const { tabId, state } = data;

  // Clear any existing expiry timer for this tab
  const existingTimer = stateExpiryTimers.get(tabId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Store the state
  savePromptStateByTab.set(tabId, state);

  // Set up auto-expiry based on remaining time
  if (state.remainingTimeMs > 0) {
    const timer = setTimeout(() => {
      savePromptStateByTab.delete(tabId);
      stateExpiryTimers.delete(tabId);
    }, state.remainingTimeMs + 1000); // Add 1s buffer

    stateExpiryTimers.set(tabId, timer);
  }

  return { success: true };
}

/**
 * Get save prompt state for a tab.
 * @param data - The tab ID.
 * @returns The stored state or null.
 */
export function handleGetSavePromptState(
  data: { tabId: number }
): { success: boolean; state: SavePromptPersistedState | null } {
  const { tabId } = data;
  const state = savePromptStateByTab.get(tabId) || null;

  if (state) {
    // Calculate adjusted remaining time
    const elapsedSinceSave = Date.now() - state.savedAt;
    const adjustedRemainingTime = state.remainingTimeMs - elapsedSinceSave;

    if (adjustedRemainingTime <= 0) {
      // Timer expired, clean up
      savePromptStateByTab.delete(tabId);
      const timer = stateExpiryTimers.get(tabId);
      if (timer) {
        clearTimeout(timer);
        stateExpiryTimers.delete(tabId);
      }
      return { success: true, state: null };
    }

    // Return state with adjusted remaining time
    return {
      success: true,
      state: {
        ...state,
        remainingTimeMs: adjustedRemainingTime,
      },
    };
  }

  return { success: true, state: null };
}

/**
 * Clear save prompt state for a tab.
 * @param data - The tab ID.
 * @returns Success response.
 */
export function handleClearSavePromptState(
  data: { tabId: number }
): { success: boolean } {
  const { tabId } = data;

  savePromptStateByTab.delete(tabId);

  const timer = stateExpiryTimers.get(tabId);
  if (timer) {
    clearTimeout(timer);
    stateExpiryTimers.delete(tabId);
  }

  return { success: true };
}

/**
 * Store last autofilled credential for a tab.
 * This tracks which credential was used for autofill so we can offer
 * "Add URL to existing credential" instead of "Save new credential".
 * @param data - The tab ID and credential info.
 * @returns Success response.
 */
export function handleStoreLastAutofilled(
  data: { tabId: number; credential: LastAutofilledCredential }
): { success: boolean } {
  const { tabId, credential } = data;

  // Clear any existing expiry timer for this tab
  const existingTimer = autofillExpiryTimers.get(tabId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Store the credential
  lastAutofilledByTab.set(tabId, credential);

  // Set up auto-expiry
  const timer = setTimeout(() => {
    lastAutofilledByTab.delete(tabId);
    autofillExpiryTimers.delete(tabId);
  }, AUTOFILL_STATE_EXPIRY_MS);

  autofillExpiryTimers.set(tabId, timer);

  return { success: true };
}

/**
 * Get last autofilled credential for a tab.
 * @param data - The tab ID and optional domain to match.
 * @returns The stored credential or null.
 */
export function handleGetLastAutofilled(
  data: { tabId: number; domain?: string; username?: string }
): { success: boolean; credential: LastAutofilledCredential | null } {
  const { tabId, domain, username } = data;
  const credential = lastAutofilledByTab.get(tabId) || null;

  if (credential) {
    // Sanity check: Check if the credential has expired, if so, clear it immediately.
    if (Date.now() - credential.timestamp > AUTOFILL_STATE_EXPIRY_MS) {
      lastAutofilledByTab.delete(tabId);
      const timer = autofillExpiryTimers.get(tabId);
      if (timer) {
        clearTimeout(timer);
        autofillExpiryTimers.delete(tabId);
      }
      return { success: true, credential: null };
    }

    // If domain is provided, check for exact match (both values come from window.location.hostname)
    if (domain && credential.domain.toLowerCase() !== domain.toLowerCase()) {
      return { success: true, credential: null };
    }

    // If username is provided, check if it matches
    if (username && credential.username.toLowerCase() !== username.toLowerCase()) {
      return { success: true, credential: null };
    }

    return { success: true, credential };
  }

  return { success: true, credential: null };
}

/**
 * Clear last autofilled credential for a tab.
 * @param data - The tab ID.
 * @returns Success response.
 */
export function handleClearLastAutofilled(
  data: { tabId: number }
): { success: boolean } {
  const { tabId } = data;

  lastAutofilledByTab.delete(tabId);

  const timer = autofillExpiryTimers.get(tabId);
  if (timer) {
    clearTimeout(timer);
    autofillExpiryTimers.delete(tabId);
  }

  return { success: true };
}

