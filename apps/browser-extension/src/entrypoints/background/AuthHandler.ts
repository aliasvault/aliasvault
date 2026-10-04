import { ClientUpgradeRequiredError } from '@aliasvault/client/api/errors/ClientUpgradeRequiredError';
import { ServerUpdateRequiredError } from '@aliasvault/client/api/errors/ServerUpdateRequiredError';
import { VaultVersionIncompatibleError } from '@aliasvault/client/api/errors/VaultVersionIncompatibleError';
import { WebApiService } from '@aliasvault/client/api/WebApiService';
import { describeAuthError, type AuthErrorOptions } from '@aliasvault/client/auth/AuthErrorMessage';
import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
import { SrpLoginService } from '@aliasvault/client/auth/SrpLoginService';
import { VaultKeyService } from '@aliasvault/client/auth/VaultKeyService';
import { logoutReasonKey } from '@aliasvault/client/sync/VaultSync';

import { handleClearTwoFactorState, handleGetTwoFactorState, handleStoreTwoFactorState } from '@/entrypoints/background/TwoFactorStateHandler';
import { handleClearSession, handleFullVaultSync, handleGetUnlockKeyDerivationParams, handleStoreUnlockKey, handleStoreUnlockKeyDerivationParams } from '@/entrypoints/background/VaultMessageHandler';

import { StorageKeys } from '@/utils/constants/storageKeys';
import { logExpected, logFailure } from '@/utils/Diagnostics';
import { convertLegacyPinKey } from '@/utils/LegacyKeyConversion';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import { IncorrectPinError, InvalidPinFormatError, PinLockedError, resetFailedAttempts, unlockWithPin } from '@/utils/PinUnlockService';
import type { BackgroundAuthResult } from '@/utils/types/messaging/BackgroundAuthResult';

import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';

import { browser, storage } from '#imports';

/*
 * Login and unlock run start in the popup but are completed in the background so they still complete when the popup closes mid-flow.
 */
let pendingAuth: Promise<BackgroundAuthResult> | null = null;

/**
 * Run an auth flow unless one is already running, in which case its result is returned.
 */
function runExclusive(flow: () => Promise<BackgroundAuthResult>): Promise<BackgroundAuthResult> {
  if (pendingAuth) {
    return pendingAuth;
  }

  const run = flow().finally(() => {
    if (pendingAuth === run) {
      pendingAuth = null;
    }
  });
  pendingAuth = run;
  return run;
}

/**
 * The result of the auth flow that is running, or null when none is.
 */
export function handleAwaitPendingAuth(): Promise<BackgroundAuthResult | null> {
  return pendingAuth ?? Promise.resolve(null);
}

/**
 * Notify content scripts in all tabs that the vault was unlocked, so any conditional passkey request parked while
 * the vault was locked can re-query, and an autofill popup the user unlocked from can reopen.
 */
export async function broadcastVaultUnlocked(): Promise<void> {
  try {
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.map(async (tab) => {
      if (tab.id === undefined) {
        return;
      }
      try {
        await sendMessage('VAULT_UNLOCKED', undefined, tab.id);
      } catch {
        // No receiving content script in this tab, ignore.
      }
    }));
  } catch {
    // tabs.query can fail in rare contexts, best-effort, ignore.
  }
}

/**
 * Map a failed flow to its result.
 */
async function failureResult(context: string, err: unknown, options?: AuthErrorOptions): Promise<BackgroundAuthResult> {
  if (err instanceof VaultVersionIncompatibleError) {
    return { status: 'logout', message: err.message };
  }
  if (err instanceof ClientUpgradeRequiredError) {
    return { status: 'logout', reasonKey: 'common.errors.clientNotSupported' };
  }

  logFailure(context, err);
  return { status: 'error', error: await describeAuthError(err, options) };
}

/**
 * Check the server status before an unlock. Returns whether the server is reachable, or the logout this client needs.
 */
async function checkServerStatus(webApi: WebApiService): Promise<{ online: boolean } | { logout: BackgroundAuthResult }> {
  try {
    const status = await webApi.getStatus();
    if (status.serverVersion === '0.0.0') {
      return { online: false };
    }

    const statusError = webApi.validateStatusResponse(status);
    if (statusError !== null) {
      return { logout: { status: 'logout', reasonKey: logoutReasonKey(statusError) } };
    }
    return { online: true };
  } catch (err) {
    if (err instanceof ClientUpgradeRequiredError) {
      return { logout: { status: 'logout', reasonKey: 'common.errors.clientNotSupported' } };
    }

    // Any other error is an auth failure: the server is reachable but the session is gone.
    logExpected('[Auth] Status check failed during unlock', err);
    return { logout: { status: 'logout', reasonKey: 'common.errors.sessionExpired' } };
  }
}

/**
 * Store the checked key (see VaultKeyService.SessionKeys.accountKey), which unlocks the vault, and tell content scripts about it.
 */
async function storeUnlockKey(unlockKey: string, offline: boolean, broadcast: boolean): Promise<void> {
  const stored = await handleStoreUnlockKey(unlockKey);
  if (!stored.success) {
    throw new Error(stored.error);
  }

  await storage.setItem(StorageKeys.IS_OFFLINE_MODE, offline);
  await LocalPreferencesService.setVaultLockedDismissUntil(0);
  if (broadcast) {
    void broadcastVaultUnlocked();
  }
}

/**
 * Unlock the vault with the master password, online against the server's key chain or offline against the cached one.
 */
export function handleUnlockWithPassword(data: { password: string }): Promise<BackgroundAuthResult> {
  return runExclusive(async () => {
    const webApi = new WebApiService();
    const status = await checkServerStatus(webApi);
    if ('logout' in status) {
      return status.logout;
    }

    try {
      let unlockKey: string;
      if (status.online) {
        const username = await storage.getItem<string>(StorageKeys.USERNAME);
        const loginResponse = await new SrpLoginService(webApi).initiateLogin(username!);
        const credentials = await SrpAuthService.prepareCredentials(data.password, loginResponse.salt, loginResponse.encryptionType, loginResponse.encryptionSettings);
        await handleStoreUnlockKeyDerivationParams({ salt: loginResponse.salt, encryptionType: loginResponse.encryptionType, encryptionSettings: loginResponse.encryptionSettings });

        // Throws an unlock-key-rejected (E-206) error on a wrong password.
        unlockKey = await VaultKeyService.refreshKeyChain(credentials.passwordHashBase64, webApi);
      } else {
        const storedParams = await handleGetUnlockKeyDerivationParams();
        if (!storedParams) {
          // Offline unlock needs the derivation params of an earlier online login.
          return { status: 'error', error: { key: 'common.errors.serverNotAvailable', wrongPassword: false } };
        }

        const credentials = await SrpAuthService.prepareCredentials(data.password, storedParams.salt, storedParams.encryptionType, storedParams.encryptionSettings);
        unlockKey = await VaultKeyService.verifyUnlockKey(credentials.passwordHashBase64);
      }

      await storeUnlockKey(unlockKey, !status.online, true);
      await resetFailedAttempts();
      await LocalPreferencesService.resetPasswordUnlockFailedAttempts();
      await LocalPreferencesService.setLastUsedUnlockMethod('password');
      return { status: 'success', offline: !status.online };
    } catch (err) {
      const message = await describeAuthError(err, { uncodedIsWrongPassword: true });
      if (message.wrongPassword) {
        const failedAttempts = await LocalPreferencesService.getPasswordUnlockFailedAttempts() + 1;
        await LocalPreferencesService.setPasswordUnlockFailedAttempts(failedAttempts);
        return { status: 'wrongPassword', failedAttempts };
      }
      return failureResult('Unlock error', err, { uncodedIsWrongPassword: true });
    }
  });
}

/**
 * Unlock the vault with the PIN, which decrypts the stored unlock key.
 */
export function handleUnlockWithPin(data: { pin: string }): Promise<BackgroundAuthResult> {
  return runExclusive(async () => {
    try {
      const pinKey = await unlockWithPin(data.pin);
      const unlockKey = await VaultKeyService.verifyUnlockKey(pinKey);
      await convertLegacyPinKey(data.pin, pinKey, unlockKey);

      const status = await checkServerStatus(new WebApiService());
      if ('logout' in status) {
        return status.logout;
      }

      await storeUnlockKey(unlockKey, !status.online, true);
      await LocalPreferencesService.setLastUsedUnlockMethod('pin');
      return { status: 'success', offline: !status.online };
    } catch (err) {
      if (err instanceof PinLockedError) {
        return { status: 'pinFailed', reason: 'locked' };
      }
      if (err instanceof IncorrectPinError) {
        return { status: 'pinFailed', reason: 'incorrect', attemptsRemaining: err.attemptsRemaining };
      }
      if (err instanceof InvalidPinFormatError) {
        return { status: 'pinFailed', reason: 'invalidFormat' };
      }

      const message = await describeAuthError(err, { fallback: 'common.errors.unknownErrorTryAgain' });
      if (message.wrongPassword) {
        // The key the PIN restored does not open the key chain, treat as an incorrect PIN.
        logExpected('[Unlock] The entered PIN did not decrypt the vault', err);
        return { status: 'pinFailed', reason: 'incorrect', attemptsRemaining: 3 };
      }
      return failureResult('PIN unlock failed', err, { fallback: 'common.errors.unknownErrorTryAgain' });
    }
  });
}

/**
 * Log in with username and master password. Returns `twoFactorRequired` when the account needs a 2FA code next.
 */
export function handleLoginWithPassword(data: { username: string; password: string; rememberMe: boolean }): Promise<BackgroundAuthResult> {
  return runExclusive(async () => {
    try {
      const username = SrpAuthService.normalizeUsername(data.username);
      const srp = new SrpLoginService(new WebApiService());
      const loginResponse = await srp.initiateLogin(username);
      const credentials = await SrpAuthService.prepareLoginCredentials(data.password, loginResponse, username);
      const validation = await srp.validateLogin(username, credentials, data.rememberMe, loginResponse);

      if (validation.requiresTwoFactor) {
        // Kept in memory for the 2FA step, which may come from a reopened popup.
        handleStoreTwoFactorState({ username, loginResponse, credentials, rememberMe: data.rememberMe });
        return { status: 'twoFactorRequired', username, rememberMe: data.rememberMe };
      }
      if (!validation.token) {
        return { status: 'error', error: { key: 'common.errors.unknownError', wrongPassword: false } };
      }

      return await completeLogin(username, validation.token.token, validation.token.refreshToken, credentials.passwordHashBase64, loginResponse);
    } catch (err) {
      return failureResult('Login error', err);
    }
  });
}

/**
 * Finish a login that needs a 2FA code, using the state the password step left behind.
 */
export function handleLoginWithTwoFactor(data: { code: string }): Promise<BackgroundAuthResult> {
  return runExclusive(async () => {
    const state = handleGetTwoFactorState();
    if (!state) {
      return { status: 'error', error: { key: 'common.errors.unknownError', wrongPassword: false } };
    }

    try {
      const srp = new SrpLoginService(new WebApiService());
      const validation = await srp.validateLogin2Fa(state.username, state.credentials, state.rememberMe, state.loginResponse, parseInt(data.code));
      if (!validation.token) {
        return { status: 'error', error: { key: 'common.errors.unknownError', wrongPassword: false } };
      }

      handleClearTwoFactorState();
      return await completeLogin(state.username, validation.token.token, validation.token.refreshToken, state.credentials.passwordHashBase64, state.loginResponse);
    } catch (err) {
      return failureResult('2FA error', err);
    }
  });
}

/**
 * Store the session of an accepted login and pull its vault.
 */
async function completeLogin(username: string, token: string, refreshToken: string, unlockKey: string, derivationParams: UnlockKeyDerivationParams): Promise<BackgroundAuthResult> {
  await storage.setItem(StorageKeys.USERNAME, username);
  await storage.setItem(StorageKeys.ACCESS_TOKEN, token);
  await storage.setItem(StorageKeys.REFRESH_TOKEN, refreshToken);

  // Fetch the key chain and check the unlock key opens it. Not recoverable when it fails, so log out again.
  const webApi = new WebApiService();
  let storedKey: string;
  try {
    storedKey = await VaultKeyService.refreshKeyChain(unlockKey, webApi);
  } catch (err) {
    await webApi.revokeTokens();
    await handleClearSession();
    throw err;
  }

  await handleStoreUnlockKeyDerivationParams({ salt: derivationParams.salt, encryptionType: derivationParams.encryptionType, encryptionSettings: derivationParams.encryptionSettings });

  // Content scripts are told once the vault is pulled: before that there is nothing to autofill from.
  await storeUnlockKey(storedKey, false, false);

  const sync = await handleFullVaultSync({ forcePull: true, reportErrorToPopup: false });
  if (sync.logoutReason === 'clientVersionNotSupported') {
    throw new ClientUpgradeRequiredError();
  }
  if (sync.logoutReason === 'serverVersionNotSupported') {
    return { status: 'error', error: await describeAuthError(new ServerUpdateRequiredError()) };
  }
  if (!sync.success) {
    return { status: 'vaultPullFailed', sync };
  }

  void broadcastVaultUnlocked();
  return { status: 'success', offline: false };
}
