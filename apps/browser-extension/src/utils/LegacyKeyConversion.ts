import { setupPin } from '@/utils/PinUnlockService';

/*
 * Legacy conversion of a stored unlock key to the Account Key.
 *
 * Before 0.31.0 the PIN protected the unlock key (the Argon2id output of the master password). Since then it protects
 * the Account Key. A PIN set up before the account had a key chain still opens the chain; it is then re-encrypted
 * with the Account Key, once. The session key itself converts in core/client `convertLegacySessionKey`.
 *
 * TODO: remove once accounts without a key chain (pre-0.31.0) are no longer supported.
 */

/**
 * Re-encrypt the PIN with the Account Key when it still protected an unlock key.
 * @param pin - the PIN the user just unlocked with
 * @param pinKey - the key the PIN protected
 * @param accountKey - the Account Key the chain opened with it
 */
export async function convertLegacyPinKey(pin: string, pinKey: string, accountKey: string): Promise<void> {
  if (accountKey !== pinKey) {
    await setupPin(pin, accountKey);
  }
}
