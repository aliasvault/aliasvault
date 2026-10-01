/**
 * In-memory 2FA state handler for persisting login state during popup close/reopen.
 *
 * This handler stores 2FA login state ONLY in memory, and the state automatically
 * expires after a short timeout.
 *
 * The background login flow (AuthHandler) stores it after the password step and reads it back for the 2FA step,
 * so users can close the popup to switch to their authenticator app and continue without re-entering credentials.
 */

import type { LoginResponse } from '@aliasvault/models/webapi';

/**
 * The 2FA state that is persisted in memory.
 */
export type TwoFactorState = {
  username: string;
  loginResponse: LoginResponse;
  passwordHashString: string;
  passwordHashBase64: string;
  rememberMe: boolean;
  timestamp: number;
};

/**
 * Timeout for automatic state expiration.
 */
const STATE_EXPIRY_MS = 5 * 60 * 1000;

/**
 * In-memory storage for 2FA state.
 * Intentionally NOT persisted to any storage - lives only in service worker memory.
 */
let twoFactorState: TwoFactorState | null = null;

/**
 * Store 2FA state in memory with current timestamp.
 */
export function handleStoreTwoFactorState(state: Omit<TwoFactorState, 'timestamp'>): void {
  twoFactorState = {
    ...state,
    timestamp: Date.now(),
  };
}

/**
 * Retrieve 2FA state from memory.
 * Returns null if no state exists or if the state has expired.
 */
export function handleGetTwoFactorState(): TwoFactorState | null {
  if (!twoFactorState) {
    return null;
  }

  // Check if state has expired
  if (Date.now() - twoFactorState.timestamp > STATE_EXPIRY_MS) {
    twoFactorState = null;
    return null;
  }

  return twoFactorState;
}

/**
 * Clear 2FA state from memory.
 */
export function handleClearTwoFactorState(): void {
  twoFactorState = null;
}
