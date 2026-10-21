import { apiErrorCodeOf } from '@aliasvault/client/api/errors/ApiRequestError';
import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { SharingOperationError } from '@/utils/SharingErrors';

import { useLogout } from '@/hooks/useLogout';

import NativeVaultManager from '@/specs/NativeVaultManager';

import type { SrpChallengeResponder } from '@aliasvault/client/sharing/SharingService';

/** Runs an action the server confirms with the master password; resolves false when the prompt was cancelled. */
export type RunWithPassword = (title: string, description: string, confirmText: string, perform: (answerChallenge: SrpChallengeResponder) => Promise<void>) => Promise<boolean>;

/**
 * Run actions the server confirms with the master password, behind the native password prompt whose unlock key answers the SRP challenge.
 */
export function usePasswordConfirmedAction(): RunWithPassword {
  const { t } = useTranslation();
  const { logoutForced } = useLogout();

  return useCallback(async (title, description, confirmText, perform) => {
    let unlockKey: string | null;
    try {
      unlockKey = await NativeVaultManager.showPasswordUnlockForKey(title, description, confirmText);
    } catch (err) {
      // Too many wrong passwords: the native layer cleared the vault, so log out.
      if (err && typeof err === 'object' && 'code' in err && err.code === 'MAX_ATTEMPTS_REACHED') {
        await logoutForced();
      }
      return false;
    }

    if (!unlockKey) {
      return false;
    }

    try {
      await perform(async challenge => {
        const passwordHash = await SrpAuthService.srpPasswordHash(unlockKey, challenge.encryptionType);
        return SrpAuthService.deriveClientProof(challenge.salt, challenge.srpIdentity, passwordHash, challenge.serverEphemeral);
      });
    } catch (actionError) {
      // The local unlock key can differ from the server's after a password change on another device.
      if (apiErrorCodeOf(actionError) === 'PASSWORD_MISMATCH') {
        throw new SharingOperationError(t('common.errors.wrongPassword'));
      }
      throw actionError;
    }
    return true;
  }, [logoutForced, t]);
}
