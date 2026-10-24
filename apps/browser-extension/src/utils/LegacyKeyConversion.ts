import { AppErrorCode, extractErrorCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { VaultKeyService } from '@aliasvault/client/auth/VaultKeyService';

import { setupPin } from '@/utils/PinUnlockService';

/*
 * Legacy conversion of a PIN that protects an unlock key to one that protects the Account Key.
 *
 * Before 0.31.0 the PIN protected the unlock key (the Argon2id output of the master password). Since then it protects
 * the Account Key. A PIN set up before the account had a key chain still opens the chain, as an unlock key; it is then
 * re-encrypted with the Account Key, once. The session's own stored key converts in core/client `convertLegacySessionKey`.
 *
 * TODO: remove once accounts without a key chain (pre-0.31.0) are no longer supported; `accountKeyFromPinKey` then
 * becomes `VaultKeyService.verifyAccountKey`.
 */

/**
 * The Account Key a PIN protects, checked against the cached key chain.
 * @param pin - the PIN the user just unlocked with
 * @param pinKey - the key the PIN protected: the Account Key, or an unlock key for a PIN set before the account had a key chain
 */
export async function accountKeyFromPinKey(pin: string, pinKey: string): Promise<string> {
  try {
    return await VaultKeyService.verifyAccountKey(pinKey);
  } catch (error) {
    if (!(error instanceof Error) || extractErrorCode(error.message) !== AppErrorCode.UNLOCK_KEY_REJECTED) {
      throw error;
    }
  }

  // LEGACY: the PIN protects an unlock key; the chain opens with it as such and the PIN is re-encrypted with the Account Key.
  const accountKey = await VaultKeyService.verifyUnlockKey(pinKey);
  await setupPin(pin, accountKey);
  return accountKey;
}
