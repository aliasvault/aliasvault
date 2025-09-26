import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import CredentialCard from '@/entrypoints/popup/components/CredentialCard';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import ReloadButton from '@/entrypoints/popup/components/ReloadButton';
import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useVaultSync } from '@/entrypoints/popup/hooks/useVaultSync';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import type { Credential } from '@/utils/dist/shared/models/vault';

import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';

/**
 * Credentials list page.
 */
const CredentialsList: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const authContext = useAuth();
  const navigate = useNavigate();
  const { syncVault } = useVaultSync();
  const { setHeaderButtons } = useHeaderButtons();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const { setIsInitialLoading } = useLoading();

  /**
   * Loading state with minimum duration for more fluid UX.
   */
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 100);

  /**
   * Handle add new credential.
   */
  const handleAddCredential = useCallback(() : void => {
    navigate('/credentials/add');
  }, [navigate]);

  /**
   * Retrieve latest vault and refresh the credentials list.
   */
  const onRefresh = useCallback(async () : Promise<void> => {
    if (!dbContext?.sqliteClient) {
      return;
    }

    try {
      // Sync vault and load credentials
      await syncVault({
        /**
         * On success.
         */
        onSuccess: async (_hasNewVault) => {
          // Credentials list is refreshed automatically when the (new) sqlite client is available via useEffect hook below.
        },
        /**
         * On offline.
         */
        _onOffline: () => {
          // Not implemented for browser extension yet.
        },
        /**
         * On error.
         */
        onError: async (error) => {
          console.error('Error syncing vault:', error);
          await authContext.logout('Error while syncing vault, please re-authenticate.');
        },
      });
    } catch (err) {
      console.error('Error refreshing credentials:', err);
      await authContext.logout('Error while syncing vault, please re-authenticate.');
    }
  }, [dbContext, authContext, syncVault]);

  /**
   * Get latest vault from server and refresh the credentials list.
   */
  const syncVaultAndRefresh = useCallback(async () : Promise<void> => {
    setIsLoading(true);
    await onRefresh();
    setIsLoading(false);
  }, [onRefresh, setIsLoading]);

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    const headerButtonsJSX = (
      <div className="flex items-center gap-2">
        {!PopoutUtility.isPopup() && (
          <HeaderButton
            onClick={() => PopoutUtility.openInNewPopup()}
            title="Open in new window"
            iconType={HeaderIconType.EXPAND}
          />
        )}
        <HeaderButton
          onClick={handleAddCredential}
          title="Add new credential"
          iconType={HeaderIconType.PLUS}
        />
      </div>
    );

    setHeaderButtons(headerButtonsJSX);
    return () => setHeaderButtons(null);
  }, [setHeaderButtons, handleAddCredential]);

  /**
   * Load credentials list on mount and on sqlite client change.
   */
  useEffect(() => {
    /**
     * Refresh credentials list when a (new) sqlite client is available.
     */
    const refreshCredentials = async () : Promise<void> => {
      if (dbContext?.sqliteClient) {
        setIsLoading(true);
        const results = dbContext.sqliteClient?.getAllCredentials() ?? [];
        setCredentials(results);
        setIsLoading(false);
        setIsInitialLoading(false);
      }
    };

    refreshCredentials();
  }, [dbContext?.sqliteClient, setIsLoading, setIsInitialLoading]);

  const filteredCredentials = credentials.filter(credential => {
    const searchLower = searchTerm.toLowerCase();

    /**
     * We filter credentials by searching in the following fields:
     * - Service name
     * - Username
     * - Alias email
     * - Service URL
     * - Notes
     */
    const searchableFields = [
      credential.ServiceName?.toLowerCase(),
      credential.Username?.toLowerCase(),
      credential.Alias?.Email?.toLowerCase(),
      credential.ServiceUrl?.toLowerCase(),
      credential.Notes?.toLowerCase(),
    ];
    return searchableFields.some(field => field?.includes(searchLower));
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-gray-900 dark:text-white text-xl">{t('credentials.title')}</h2>
        <ReloadButton onClick={syncVaultAndRefresh} />
      </div>

      {credentials.length > 0 ? (
        <div className="mb-4">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`${t('content.searchVault')}`}
            autoFocus
            className="w-full p-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      ) : (
        <></>
      )}

      {credentials.length === 0 ? (
        <div className="text-gray-500 dark:text-gray-400 space-y-2 mb-10">
          <p>
            {t('credentials.welcomeTitle')}
          </p>
          <p>
            {t('credentials.welcomeDescription')}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filteredCredentials.map(cred => (
            <CredentialCard key={cred.Id} credential={cred} />
          ))}
        </ul>
      )}
    </div>
  );
};

export default CredentialsList;