/**
 * In-memory 2FA state handler for persisting login state during popup close/reopen.
 */

import type { LoginProof } from '@aliasvault/client/auth/SrpLoginService';
import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';

/**
 * The 2FA state that is kept in memory.
 */
export type TwoFactorState = {
  username: string;
  rememberMe: boolean;
  loginSessionId: string;
  proof: LoginProof;
  unlockKeyBase64: string;
  derivationParams: UnlockKeyDerivationParams;
};

/**
 * What the popup gets to restore the 2FA step: no key material.
 */
export type TwoFactorPrompt = Pick<TwoFactorState, 'username' | 'rememberMe'>;

/**
 * Timeout after which the state is cleared.
 */
const STATE_EXPIRY_MS = 5 * 60 * 1000;

/**
 * In-memory storage for 2FA state.
 * Intentionally NOT persisted to any storage - lives only in service worker memory.
 */
let twoFactorState: TwoFactorState | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Store 2FA state in memory until the 2FA step completes, it is cleared, or the timeout passes.
 */
export function handleStoreTwoFactorState(state: TwoFactorState): void {
  handleClearTwoFactorState();
  twoFactorState = state;
  expiryTimer = setTimeout(handleClearTwoFactorState, STATE_EXPIRY_MS);
}

/**
 * Retrieve the 2FA state for the background login flow, or null when there is none.
 */
export function handleGetTwoFactorState(): TwoFactorState | null {
  return twoFactorState;
}

/**
 * Whether a 2FA step is pending and for whom, for the popup to restore it.
 */
export function handleGetTwoFactorPrompt(): TwoFactorPrompt | null {
  return twoFactorState ? { username: twoFactorState.username, rememberMe: twoFactorState.rememberMe } : null;
}

/**
 * Clear 2FA state from memory.
 */
export function handleClearTwoFactorState(): void {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  twoFactorState = null;
}
