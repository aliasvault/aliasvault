import { VaultVersionIncompatibleError } from '@aliasvault/client/api/errors/VaultVersionIncompatibleError';
import { syncErrorMessage } from '@aliasvault/client/sync/SyncErrorMessage';
import { VaultMigrationKind } from '@aliasvault/client/sync/VaultManifestMigration';
import { VaultSqlGenerator, type VaultVersion } from '@aliasvault/vault';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import BoldLoadingIndicator from '@/components/loading/BoldLoadingIndicator';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { waitForMinimumDuration } from '@/utils/Delay';
import { getLocalPreference, removeLocalPreference } from '@/utils/LocalPreferences';
import { LocalPreferenceKeys } from '@/utils/StorageKeys';
import { vaultStore } from '@/vault/VaultStore';

const MINIMUM_LOADING_TIME_MS = 800;
const DISALLOWED_RETURN_URLS = ['/sync', '/unlock', '/user/logout'];

/** Sync statuses this page displays. */
type SyncStatus = 'loading' | 'decryption-failed' | 'version-unrecognized' | 'pending-migrations';

/** Which type of pending migration is required. */
type UpgradeKind = 'legacy-sqlite-blob' | 'storage-format';

/**
 * Loads the vault after login or unlock: pulls it when none is stored, opens it, runs pending migrations and
 * returns to where the user wanted to go.
 */
const Sync: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const dbContext = useDb();
  const { executeVaultMutationAsync } = useVaultMutate();
  usePageTitle(t('pages.main.sync.sync.PageTitle'));

  const [status, setStatus] = useState<SyncStatus>('loading');
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [upgradeKind, setUpgradeKind] = useState<UpgradeKind | null>(null);
  const [upgradeError, setUpgradeError] = useState('');
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [showVersionDescription, setShowVersionDescription] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<VaultVersion | null>(null);
  const [latestVersion, setLatestVersion] = useState<VaultVersion | null>(null);
  const hasStarted = useRef(false);
  const startedAt = useRef(Date.now());

  /**
   * Go to the page the user wanted, else the default entry page.
   */
  const navigateToHome = useCallback(async (): Promise<void> => {
    await waitForMinimumDuration(startedAt.current, MINIMUM_LOADING_TIME_MS);

    const returnUrl = getLocalPreference(LocalPreferenceKeys.RETURN_URL)?.trim();
    removeLocalPreference(LocalPreferenceKeys.RETURN_URL);
    if (returnUrl && !DISALLOWED_RETURN_URLS.some(url => returnUrl.startsWith(url))) {
      navigate(returnUrl, { replace: true });
    } else {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  /**
   * Open the stored vault and decide whether it needs an upgrade before it can be used.
   */
  const openVault = useCallback(async (): Promise<void> => {
    let client;
    try {
      client = await dbContext.loadStoredDatabase();
    } catch (error) {
      if (error instanceof VaultVersionIncompatibleError) {
        setStatus('version-unrecognized');
        return;
      }
      setErrorDetails(error instanceof Error ? error.message : String(error));
      setStatus('decryption-failed');
      return;
    }
    if (!client) {
      setStatus('decryption-failed');
      return;
    }

    if (await client.requiresLegacySqliteBlobMigration()) {
      setCurrentVersion(await client.getDatabaseVersion());
      setLatestVersion(await client.getLatestDatabaseVersion());
      setUpgradeKind('legacy-sqlite-blob');
      setStatus('pending-migrations');
      return;
    }

    if (await vaultStore.requiresManifestMigration()) {
      const kind = await vaultStore.getVaultMigrationStatus();
      if (kind === VaultMigrationKind.StorageFormatUpgrade) {
        setUpgradeKind('storage-format');
        setStatus('pending-migrations');
        return;
      }
      // A local schema rebuild is invisible to the user and runs unattended.
      const result = await vaultStore.migrateVaultManifest();
      if (!result.success) {
        setErrorDetails(syncErrorMessage(result, t) ?? null);
        setStatus('decryption-failed');
        return;
      }
      await dbContext.loadStoredDatabase();
    }

    await navigateToHome();
  }, [dbContext, navigateToHome, t]);

  /**
   * Pull the vault when none is stored yet (right after login), then open it.
   */
  useEffect(() => {
    if (!auth.isInitialized || hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    /**
     * The whole sequence.
     */
    const run = async (): Promise<void> => {
      const authStatus = await vaultStore.checkAuthStatus();
      if (!authStatus.isLoggedIn) {
        navigate('/user/login', { replace: true });
        return;
      }
      if (authStatus.isVaultLocked) {
        navigate('/unlock', { replace: true });
        return;
      }

      if (!authStatus.hasStoredVault) {
        const result = await vaultStore.fullVaultSync({ forcePull: true, reportErrorToPopup: false });
        if (result.requiresLogout || result.errorKey) {
          await auth.logout({ errorMessage: syncErrorMessage(result, t) });
          navigate('/user/login', { replace: true });
          return;
        }
        if (!result.success) {
          setErrorDetails(syncErrorMessage(result, t) ?? null);
          setStatus('decryption-failed');
          return;
        }
      }

      await openVault();
    };
    void run();
  }, [auth, navigate, openVault, t]);

  /**
   * Run the pending upgrade after the user confirmed.
   */
  const migrateDatabase = async (): Promise<void> => {
    setIsUpgrading(true);
    setUpgradeError('');
    try {
      if (upgradeKind === 'legacy-sqlite-blob') {
        const client = dbContext.sqliteClient;
        if (!client || !currentVersion || !latestVersion) {
          throw new Error(t('pages.main.sync.statusMessages.pendingMigrations.UpgradeFailedError'));
        }
        const upgrade = new VaultSqlGenerator().getUpgradeVaultSql(currentVersion.revision, latestVersion.revision);
        if (!upgrade.success) {
          throw new Error(upgrade.error ?? t('pages.main.sync.statusMessages.pendingMigrations.UpgradeFailedError'));
        }
        /*
         * The migration SQL contains PRAGMA statements that only take effect outside a transaction, so every
         * command runs as-is; each script handles its own transactions.
         */
        await executeVaultMutationAsync(async () => {
          for (const sqlCommand of upgrade.sqlCommands) {
            client.executeRaw(sqlCommand);
          }
        });
      } else {
        const result = await vaultStore.migrateVaultManifest();
        if (!result.success) {
          throw new Error(syncErrorMessage(result, t) ?? t('pages.main.sync.statusMessages.pendingMigrations.UpgradeFailedError'));
        }
      }

      // Re-open the migrated vault and continue (the manifest migration may still be pending after the legacy chain).
      hasStarted.current = false;
      setStatus('loading');
      await openVault();
    } catch (error) {
      console.error('Vault upgrade failed:', error);
      setUpgradeError(error instanceof Error ? error.message : t('pages.main.sync.statusMessages.pendingMigrations.UpgradeFailedError'));
    } finally {
      setIsUpgrading(false);
    }
  };

  /**
   * The card for the current status.
   */
  const renderStatus = (): React.ReactNode => {
    switch (status) {
      case 'decryption-failed':
        return (
          <div className="relative p-6 sm:p-8 bg-white dark:bg-gray-700 rounded-lg sm:shadow-xl max-w-md w-full mx-auto">
            <div className="text-center">
              <h2 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">{t('pages.main.sync.statusMessages.errorVaultDecrypt.ErrorTitle')}</h2>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('pages.main.sync.statusMessages.errorVaultDecrypt.ErrorDescription')}</p>
            </div>
            {errorDetails && (
              <pre id="vault-error-report" className="mt-4 max-h-48 overflow-auto rounded bg-gray-100 dark:bg-gray-800 p-3 text-left text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all select-all">{errorDetails}</pre>
            )}
          </div>
        );
      case 'version-unrecognized':
        return (
          <div className="relative p-6 sm:p-8 bg-white dark:bg-gray-700 rounded-lg sm:shadow-xl max-w-md w-full mx-auto">
            <div className="text-center">
              <h2 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">Vault version not supported</h2>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                The version of this vault is not compatible with your client. <br />
                Please update to the latest version of AliasVault, refresh this page, and try again. <br />
              </p>
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                If the issue persists, contact our support team for help.
              </p>
            </div>
          </div>
        );
      case 'pending-migrations':
        return (
          <div className="relative p-6 sm:p-8 bg-white dark:bg-gray-700 rounded-lg sm:shadow-xl max-w-md w-full mx-auto">
            <div className="text-center">
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{t('pages.main.sync.statusMessages.pendingMigrations.UpgradeVaultTitle')}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('pages.main.sync.statusMessages.pendingMigrations.UpgradeDescription')}
                </p>
                {upgradeKind === 'legacy-sqlite-blob' && (
                  <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg shadow-sm">
                    <div className="flex items-center justify-center mb-3">
                      <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300">{t('pages.main.sync.statusMessages.pendingMigrations.VersionInformationTitle')}</h3>
                      <button onClick={() => setShowVersionDescription(!showVersionDescription)} className="ml-2 w-6 h-6 bg-gray-200 dark:bg-gray-600 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors">
                        <span className="text-sm font-bold">?</span>
                      </button>
                    </div>
                    {showVersionDescription && (
                      <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-700 rounded-lg">
                        <p className="text-sm text-orange-800 dark:text-orange-200">
                          {t('pages.main.sync.statusMessages.pendingMigrations.UpgradeRequiredDescription', { 0: latestVersion?.description ?? t('pages.main.sync.statusMessages.pendingMigrations.NoDescriptionAvailable') })}
                        </p>
                      </div>
                    )}
                    <div className="space-y-2">
                      <p className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('pages.main.sync.statusMessages.pendingMigrations.YourVaultLabel')}</span>
                        <span className="text-base font-bold text-blue-600 dark:text-blue-400">{currentVersion?.compatibleUpToVersion ?? '...'}</span>
                      </p>
                      <p className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('pages.main.sync.statusMessages.pendingMigrations.NewVersionLabel')}</span>
                        <span className="text-base font-bold text-green-600 dark:text-green-400">{latestVersion?.releaseVersion ?? '...'}</span>
                      </p>
                    </div>
                  </div>
                )}
                <div>
                  {upgradeError && <AlertMessageError message={upgradeError} />}
                  {isUpgrading ? (
                    <BoldLoadingIndicator />
                  ) : (
                    <button onClick={migrateDatabase} type="button" className="px-4 mt-4 py-2 text-white bg-primary-600 rounded-lg hover:bg-primary-700 focus:ring-4 focus:ring-primary-300 dark:bg-primary-500 dark:hover:bg-primary-600 dark:focus:ring-primary-800">
                      {t('pages.main.sync.statusMessages.pendingMigrations.StartUpgradeButton')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return (
          <div className="relative p-6 sm:p-8 bg-white dark:bg-gray-700 rounded-lg sm:shadow-xl max-w-md w-full mx-auto">
            <div className="text-center">
              <BoldLoadingIndicator />
              <h2 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">{t('pages.main.sync.statusMessages.vaultDecryptionProgress.Title')}</h2>
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{t('pages.main.sync.statusMessages.vaultDecryptionProgress.Description')}</p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center px-6 pt-8 pb-8 h-full w-full">
      {renderStatus()}

      <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-6">
        {t('pages.main.sync.sync.SwitchAccountsText')} <Link to="/user/logout" className="text-primary-700 hover:underline dark:text-primary-500">{t('pages.main.sync.sync.LogoutLink')}</Link>
      </div>
    </div>
  );
};

export default Sync;
