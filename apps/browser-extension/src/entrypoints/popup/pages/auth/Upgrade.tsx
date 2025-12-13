import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Button from '@/entrypoints/popup/components/Button';
import Modal from '@/entrypoints/popup/components/Dialogs/Modal';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';
import { useVaultSync } from '@/entrypoints/popup/hooks/useVaultSync';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import type { VaultVersion } from '@/utils/dist/core/vault';
import { VaultSqlGenerator } from '@/utils/dist/core/vault';

/**
 * Upgrade page for handling vault version upgrades.
 */
const Upgrade: React.FC = () => {
  const { t } = useTranslation();
  const { username, logout } = useApp();
  const dbContext = useDb();
  const { sqliteClient } = dbContext;
  const { setHeaderButtons } = useHeaderButtons();
  const [isLoading, setIsLoading] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<VaultVersion | null>(null);
  const [latestVersion, setLatestVersion] = useState<VaultVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSelfHostedWarning, setShowSelfHostedWarning] = useState(false);
  const [showVersionInfo, setShowVersionInfo] = useState(false);
  const { setIsInitialLoading } = useLoading();
  const webApi = useWebApi();
  const { executeVaultMutationAsync } = useVaultMutate();
  const { syncVault } = useVaultSync();
  const navigate = useNavigate();

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    const headerButtonsJSX = !PopoutUtility.isPopup() ? (
      <>
        <HeaderButton
          onClick={() => PopoutUtility.openInNewPopup()}
          title={t('common.openInNewWindow')}
          iconType={HeaderIconType.EXPAND}
        />
      </>
    ) : null;

    setHeaderButtons(headerButtonsJSX);

    return () => {
      setHeaderButtons(null);
    };
  }, [setHeaderButtons, t]);

  /**
   * Load version information from the database.
   */
  const loadVersionInfo = useCallback(async () => {
    try {
      if (sqliteClient) {
        const current = await sqliteClient.getDatabaseVersion();
        const latest = await sqliteClient.getLatestDatabaseVersion();
        setCurrentVersion(current);
        setLatestVersion(latest);
      }
    } catch (error) {
      console.error('Failed to load version information:', error);
      setError(t('upgrade.alerts.unableToGetVersionInfo'));
    } finally {
      setIsInitialLoading(false);
    }
  }, [sqliteClient, setIsInitialLoading, t]);

  useEffect(() => {
    loadVersionInfo();
  }, [loadVersionInfo]);

  /**
   * Handle the vault upgrade.
   */
  const handleUpgrade = async (): Promise<void> => {
    if (!sqliteClient || !currentVersion || !latestVersion) {
      setError(t('upgrade.alerts.unableToGetVersionInfo'));
      return;
    }

    // Check if this is a self-hosted instance and show warning if needed
    if (await webApi.isSelfHosted()) {
      setShowSelfHostedWarning(true);
      return;
    }

    await performUpgrade();
  };

  /**
   * Perform the actual vault upgrade.
   */
  const performUpgrade = async (): Promise<void> => {
    if (!sqliteClient || !currentVersion || !latestVersion) {
      setError(t('upgrade.alerts.unableToGetVersionInfo'));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get upgrade SQL commands from vault library
      const vaultSqlGenerator = new VaultSqlGenerator();
      const upgradeResult = vaultSqlGenerator.getUpgradeVaultSql(currentVersion.revision, latestVersion.revision);

      if (!upgradeResult.success) {
        throw new Error(upgradeResult.error ?? t('upgrade.alerts.upgradeFailed'));
      }

      if (upgradeResult.sqlCommands.length === 0) {
        // No upgrade needed, vault is already up to date
        await handleUpgradeSuccess();
        return;
      }

      // Use the useVaultMutate hook to handle the upgrade and vault upload
      await executeVaultMutationAsync(async () => {
        // Begin transaction
        sqliteClient.beginTransaction();

        // Execute each SQL command
        for (let i = 0; i < upgradeResult.sqlCommands.length; i++) {
          const sqlCommand = upgradeResult.sqlCommands[i];

          try {
            sqliteClient.executeRaw(sqlCommand);
          } catch (error) {
            console.error(`Error executing SQL command ${i + 1}:`, sqlCommand, error);
            sqliteClient.rollbackTransaction();
            throw new Error(t('upgrade.alerts.failedToApplyMigration', { current: i + 1, total: upgradeResult.sqlCommands.length }));
          }
        }

        // Commit transaction
        sqliteClient.commitTransaction();
      });

      await handleUpgradeSuccess();
    } catch (error) {
      console.error('Upgrade failed:', error);
      setError(error instanceof Error ? error.message : t('common.errors.unknownError'));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle successful upgrade completion.
   */
  const handleUpgradeSuccess = async (): Promise<void> => {
    try {
      // Sync vault to ensure we have the latest data
      await syncVault({
        /**
         * Handle successful sync completion.
         */
        onSuccess: () => {
          // Navigate to credentials page
          navigate('/credentials');
        },
        /**
         * Handle sync error.
         * @param error Error message
         */
        onError: (error: string) => {
          console.error('Sync error after upgrade:', error);
          // Still navigate to credentials even if sync fails
          navigate('/credentials');
        }
      });
    } catch (error) {
      console.error('Error during post-upgrade sync:', error);
      // Navigate to credentials even if sync fails
      navigate('/credentials');
    }
  };

  /**
   * Handle the logout.
   */
  const handleLogout = async (): Promise<void> => {
    logout();
  };

  /**
   * Show version description dialog.
   */
  const showVersionDialog = (): void => {
    setShowVersionInfo(true);
  };

  return (
    <div>
      {/* Full loading screen overlay */}
      {isLoading && (
        <div className="fixed inset-0 flex flex-col justify-center items-center bg-white dark:bg-gray-900 bg-opacity-90 dark:bg-opacity-90 z-50">
          <LoadingSpinner />
          <div className="text-sm text-gray-500 mt-2">
            {t('upgrade.upgrading')}
          </div>
        </div>
      )}

      {/* Self-hosted warning modal */}
      <Modal
        isOpen={showSelfHostedWarning}
        onClose={() => setShowSelfHostedWarning(false)}
        onConfirm={() => {
          setShowSelfHostedWarning(false);
          void performUpgrade();
        }}
        title={t('upgrade.alerts.selfHostedServer')}
        message={t('upgrade.alerts.selfHostedWarning')}
        confirmText={t('upgrade.alerts.continueUpgrade')}
        cancelText={t('common.cancel')}
      />

      {/* Version info modal */}
      <Modal
        isOpen={showVersionInfo}
        onClose={() => setShowVersionInfo(false)}
        onConfirm={() => setShowVersionInfo(false)}
        title={t('upgrade.whatsNew')}
        message={`${t('upgrade.whatsNewDescription')}\n\n${latestVersion?.description ?? t('upgrade.noDescriptionAvailable')}`}
      />

      <form className="w-full px-2 pt-2 pb-2 mb-4">
        {error && (
          <div className="mb-4 text-red-500 dark:text-red-400">
            {error}
          </div>
        )}

        {/* User display section like settings page */}
        <div className="flex items-center space-x-3 mb-4">
          <div className="flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
              <span className="text-primary-600 dark:text-primary-400 text-lg font-medium">
                {username?.[0]?.toUpperCase() || '?'}
              </span>
            </div>
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-white">
              {username}
            </p>
          </div>
        </div>

        <h2 className="text-xl font-bold dark:text-gray-200 mb-4">{t('upgrade.title')}</h2>

        <div className="mb-6">
          <p className="text-gray-700 dark:text-gray-200 mb-4">
            {t('upgrade.subtitle')}
          </p>
          <div className="bg-gray-50 dark:bg-gray-800 rounded p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-700 dark:text-gray-200">{t('upgrade.versionInformation')}</span>
              <button
                type="button"
                onClick={showVersionDialog}
                className="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold hover:bg-gray-300 dark:hover:bg-gray-500"
                title={t('upgrade.whatsNew')}
              >
                ?
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">{t('upgrade.yourVault')}</span>
                <span className="text-sm font-bold text-orange-600 dark:text-orange-400">
                  {currentVersion?.compatibleUpToVersion ?? '...'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">{t('upgrade.newVersion')}</span>
                <span className="text-sm font-bold text-green-600 dark:text-green-400">
                  {latestVersion?.releaseVersion ?? '...'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col w-full space-y-2">
          <Button
            type="button"
            id="upgrade-button"
            onClick={handleUpgrade}
          >
            {isLoading ? t('upgrade.upgrading') : t('upgrade.upgrade')}
          </Button>
          <button
            type="button"
            onClick={handleLogout}
            className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm font-medium py-2"
            disabled={isLoading}
          >
            {t('upgrade.logout')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default Upgrade;
