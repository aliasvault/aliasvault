import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import CredentialCard from '@/entrypoints/popup/components/Credentials/CredentialCard';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import ReloadButton from '@/entrypoints/popup/components/ReloadButton';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useVaultSync } from '@/entrypoints/popup/hooks/useVaultSync';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import type { Credential } from '@/utils/dist/shared/models/vault';

import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';

type FilterType = 'all' | 'passkeys' | 'aliases' | 'userpass';

const FILTER_STORAGE_KEY = 'credentials-filter';
const FILTER_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get stored filter from localStorage if not expired
 */
const getStoredFilter = (): FilterType => {
  try {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!stored) {
      return 'all';
    }

    const { filter, timestamp } = JSON.parse(stored);
    const now = Date.now();

    // Check if expired (5 minutes)
    if (now - timestamp > FILTER_EXPIRY_MS) {
      localStorage.removeItem(FILTER_STORAGE_KEY);
      return 'all';
    }

    return filter as FilterType;
  } catch {
    return 'all';
  }
};

/**
 * Store filter in localStorage with timestamp
 */
const storeFilter = (filter: FilterType): void => {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
      filter,
      timestamp: Date.now()
    }));
  } catch {
    // Ignore storage errors
  }
};

/**
 * Credentials list page.
 */
const CredentialsList: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const app = useApp();
  const navigate = useNavigate();
  const { syncVault } = useVaultSync();
  const { setHeaderButtons } = useHeaderButtons();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<FilterType>(getStoredFilter());
  const [showFilterMenu, setShowFilterMenu] = useState(false);
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
        },
      });
    } catch (err) {
      console.error('Error refreshing credentials:', err);
      await app.logout('Error while syncing vault, please re-authenticate.');
    }
  }, [dbContext, app, syncVault]);

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

  /**
   * Get the title based on the active filter
   */
  const getFilterTitle = () : string => {
    switch (filterType) {
      case 'passkeys':
        return t('credentials.filters.passkeys');
      case 'aliases':
        return t('credentials.filters.aliases');
      case 'userpass':
        return t('credentials.filters.userpass');
      default:
        return t('credentials.title');
    }
  };

  const filteredCredentials = credentials.filter((credential: Credential) => {
    // First apply type filter
    let passesTypeFilter = true;

    if (filterType === 'passkeys') {
      passesTypeFilter = credential.HasPasskey === true;
    } else if (filterType === 'aliases') {
      // Check for non-empty alias fields (excluding email which is used everywhere)
      passesTypeFilter = !!(
        (credential.Alias?.FirstName && credential.Alias.FirstName.trim()) ||
        (credential.Alias?.LastName && credential.Alias.LastName.trim()) ||
        (credential.Alias?.NickName && credential.Alias.NickName.trim()) ||
        (credential.Alias?.Gender && credential.Alias.Gender.trim()) ||
        (credential.Alias?.BirthDate && credential.Alias.BirthDate.trim() && credential.Alias.BirthDate.trim().startsWith('0001-01-01') !== true)
      );
    } else if (filterType === 'userpass') {
      // Show only credentials that have username/password AND do NOT have alias fields AND do NOT have passkey
      const hasAliasFields = !!(
        (credential.Alias?.FirstName && credential.Alias.FirstName.trim()) ||
        (credential.Alias?.LastName && credential.Alias.LastName.trim()) ||
        (credential.Alias?.NickName && credential.Alias.NickName.trim()) ||
        (credential.Alias?.Gender && credential.Alias.Gender.trim()) ||
        (credential.Alias?.BirthDate && credential.Alias.BirthDate.trim() && credential.Alias.BirthDate.trim().startsWith('0001-01-01') !== true)
      );
      const hasUsernameOrPassword = !!(
        (credential.Username && credential.Username.trim()) ||
        (credential.Password && credential.Password.trim())
      );
      passesTypeFilter = hasUsernameOrPassword && !credential.HasPasskey && !hasAliasFields;
    }

    if (!passesTypeFilter) {
      return false;
    }

    // Then apply search filter
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
        <div className="relative">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className="flex items-center gap-1 text-gray-900 dark:text-white text-xl hover:text-gray-700 dark:hover:text-gray-300 focus:outline-none"
          >
            <h2 className="flex items-baseline gap-1.5">
              {getFilterTitle()}
              <span className="text-sm text-gray-500 dark:text-gray-400">({filteredCredentials.length})</span>
            </h2>
            <svg
              className="w-4 h-4 mt-1"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {showFilterMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowFilterMenu(false)}
              />
              <div className="absolute left-0 mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20">
                <div className="py-1">
                  <button
                    onClick={() => {
                      const newFilter = 'all';
                      setFilterType(newFilter);
                      storeFilter(newFilter);
                      setShowFilterMenu(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      filterType === 'all' ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {t('credentials.filters.all')}
                  </button>
                  <button
                    onClick={() => {
                      const newFilter = 'passkeys';
                      setFilterType(newFilter);
                      storeFilter(newFilter);
                      setShowFilterMenu(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      filterType === 'passkeys' ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {t('credentials.filters.passkeys')}
                  </button>
                  <button
                    onClick={() => {
                      const newFilter = 'aliases';
                      setFilterType(newFilter);
                      storeFilter(newFilter);
                      setShowFilterMenu(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      filterType === 'aliases' ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {t('credentials.filters.aliases')}
                  </button>
                  <button
                    onClick={() => {
                      const newFilter = 'userpass';
                      setFilterType(newFilter);
                      storeFilter(newFilter);
                      setShowFilterMenu(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      filterType === 'userpass' ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {t('credentials.filters.userpass')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
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
      ) : filteredCredentials.length === 0 ? (
        <div className="text-gray-500 dark:text-gray-400 space-y-2 mb-10">
          <p>
            {filterType === 'passkeys'
              ? t('credentials.noPasskeysFound')
              : t('credentials.noMatchingCredentials')
            }
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