import type { AuthErrorMessage } from '@aliasvault/client/auth/AuthErrorMessage';
import type { FullVaultSyncResult } from '@aliasvault/client/sync/VaultSync';
import type { TranslationKey } from '@aliasvault/i18n';

/**
 * Outcome of a login or unlock flow the background ran for the popup.
 */
export type BackgroundAuthResult =
  | { status: 'success'; offline: boolean }
  | { status: 'twoFactorRequired'; username: string; rememberMe: boolean }
  | { status: 'wrongPassword'; failedAttempts: number }
  | { status: 'pinFailed'; reason: 'locked' | 'invalidFormat' | 'incorrect'; attemptsRemaining?: number }
  | { status: 'logout'; reasonKey?: TranslationKey; message?: string }
  | { status: 'vaultPullFailed'; sync: FullVaultSyncResult }
  | { status: 'error'; error: AuthErrorMessage };
