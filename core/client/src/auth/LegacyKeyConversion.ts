import { StorageKeys } from '../constants/StorageKeys';
import { getPlatform } from '../platform/ClientPlatform';

/*
 * Legacy conversion of a stored unlock key to the Account Key.
 *
 * Before 0.31.0 the session stored the unlock key (the Argon2id output of the master password). Since then it stores
 * the Account Key. A key stored before the account had a key chain (an account upgraded on another device) still
 * opens the chain; the session then stores the Account Key in its place, once.
 *
 * TODO: remove once accounts without a key chain (pre-0.31.0) are no longer supported.
 */

/**
 * Store the Account Key in the session when the session still held an unlock key.
 * @param sessionKey - the key the session held
 * @param accountKey - the Account Key the chain opened with it
 */
export async function convertLegacySessionKey(sessionKey: string, accountKey: string): Promise<void> {
  if (accountKey !== sessionKey) {
    await getPlatform().storage.set(StorageKeys.UNLOCK_KEY, accountKey);
  }
}
