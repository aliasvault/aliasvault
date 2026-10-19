import { extractErrorCode } from '../api/errors/AppErrorCodes';

import { MissingDerivationParamsError, UnlockService } from './UnlockService';
import { VaultKeyService } from './VaultKeyService';

/**
 * Check the master password offline against the cached key chain, the same way an offline unlock does.
 * @param password - the master password to check
 * @returns True when the password is correct, false when it is wrong.
 * @throws Error when the check itself cannot run (no stored derivation parameters or key chain).
 */
export async function verifyMasterPassword(password: string): Promise<boolean> {
  if (!await VaultKeyService.hasLocalVaultKey()) {
    throw new Error('No local key chain to verify the master password against');
  }

  try {
    await UnlockService.verifyPasswordOffline(password);
    return true;
  } catch (error) {
    if (error instanceof MissingDerivationParamsError) {
      throw new Error('No local key chain to verify the master password against');
    }
    const code = error instanceof Error ? extractErrorCode(error.message) : null;
    if (await VaultKeyService.isWrongUnlockKey(code)) {
      return false;
    }
    throw error;
  }
}
