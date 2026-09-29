import { useEffect } from 'react';

import { useDb } from '@/context/DbContext';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { LANGUAGE_CODES } from '@/i18n/config';
import i18n, { changeLanguage } from '@/i18n/i18n';

/**
 * Vault setting that holds the UI language, so it follows the user across devices.
 */
const APP_LANGUAGE_SETTING = 'AppLanguage';

/**
 * Set the UI language to the vault's language, or the current language if the vault has none yet.
 * @param enabled - whether the vault is open
 */
export function useVaultLanguage(enabled: boolean): void {
  const { sqliteClient } = useDb();
  const { executeVaultMutationInBackground } = useVaultMutate();

  useEffect(() => {
    if (!enabled || !sqliteClient) {
      return;
    }

    const vaultLanguage = sqliteClient.settings.getSetting(APP_LANGUAGE_SETTING, '');
    if (LANGUAGE_CODES.includes(vaultLanguage)) {
      if (vaultLanguage !== i18n.language) {
        void changeLanguage(vaultLanguage);
      }
      return;
    }

    const currentLanguage = i18n.language;
    executeVaultMutationInBackground(async () => {
      sqliteClient.settings.updateSetting(APP_LANGUAGE_SETTING, currentLanguage);
    }).catch((error) => console.error('Failed to store the app language in the vault:', error));
  }, [enabled, sqliteClient, executeVaultMutationInBackground]);
}
