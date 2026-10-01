import { VaultVersionIncompatibleError } from '@aliasvault/client/api/errors/VaultVersionIncompatibleError';
import { describeAuthError, formatErrorMessage } from '@aliasvault/client/auth/AuthErrorMessage';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';

import { logFailure } from '@/utils/Diagnostics';

/**
 * Finish a login or unlock the background completed: load the vault it unlocked and continue.
 */
export function useFinishBackgroundAuth(): (offline: boolean) => Promise<string | null> {
  const { t } = useTranslation();
  const app = useApp();
  const dbContext = useDb();
  const navigate = useNavigate();

  return useCallback(async (offline: boolean): Promise<string | null> => {
    try {
      await app.initializeAuth();
      await dbContext.setIsOffline(offline);

      const sqliteClient = await dbContext.loadStoredDatabase();
      if (sqliteClient && await sqliteClient.requiresLegacySqliteBlobMigration()) {
        navigate('/upgrade', { replace: true });
        return null;
      }

      // Reinitialize syncs with the server and routes to the page to show.
      navigate('/reinitialize', { replace: true });
      return null;
    } catch (err) {
      if (err instanceof VaultVersionIncompatibleError) {
        await app.logout(err.message);
        return null;
      }
      logFailure('Loading the unlocked vault failed', err);
      return formatErrorMessage(await describeAuthError(err, { fallback: 'common.errors.unknownErrorTryAgain' }), t);
    }
  }, [app, dbContext, navigate, t]);
}
