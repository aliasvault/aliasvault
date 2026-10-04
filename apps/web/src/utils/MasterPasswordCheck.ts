import { extractErrorCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { MasterPasswordService } from '@aliasvault/client/auth/MasterPasswordService';
import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
import { VaultKeyService } from '@aliasvault/client/auth/VaultKeyService';

/**
 * Check the master password offline against the cached key chain, the same way an offline unlock does.
 * @param password - the master password to check
 * @returns True when the password is correct, false when it is wrong.
 * @throws Error when the check itself cannot run (no stored derivation parameters or key chain).
 */
export async function verifyMasterPassword(password: string): Promise<boolean> {
  const params = await MasterPasswordService.getStoredDerivationParams();
  if (!params || !await VaultKeyService.hasLocalVaultKey()) {
    throw new Error('No local key chain to verify the master password against');
  }

  const unlockKey = await SrpAuthService.deriveUnlockKey(password, params.salt, params.encryptionSettings);
  try {
    await VaultKeyService.verifyUnlockKey(unlockKey);
    return true;
  } catch (error) {
    const code = error instanceof Error ? extractErrorCode(error.message) : null;
    if (await VaultKeyService.isWrongUnlockKey(code)) {
      return false;
    }
    throw error;
  }
}
