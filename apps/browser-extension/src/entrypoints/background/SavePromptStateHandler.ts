/**
 * Background script handler for save prompt state persistence.
 * Stores save prompt state in memory so it survives content script navigation.
 */

import type { SavePromptPersistedState } from '@/utils/loginDetector';

/** In-memory storage for save prompt state, keyed by tab ID */
const savePromptStateByTab: Map<number, SavePromptPersistedState> = new Map();

/** Timeout handles for auto-clearing state after expiry */
const stateExpiryTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();

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
