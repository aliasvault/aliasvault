import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Button from '@/entrypoints/popup/components/Button';
import { CountdownBar, type ICountdownBarHandle } from '@/entrypoints/popup/components/CountdownBar';
import LogoutConfirmModal from '@/entrypoints/popup/components/Dialogs/LogoutConfirmModal';
import Modal from '@/entrypoints/popup/components/Dialogs/Modal';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';
import { useVaultSync } from '@/entrypoints/popup/hooks/useVaultSync';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import { AppInfo } from '@/utils/AppInfo';
import type { VaultVersion } from '@/utils/dist/core/vault';
import { VaultSqlGenerator } from '@/utils/dist/core/vault';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import { VaultMigrationKind } from '@/utils/VaultManifestMigration';

/** How long the success confirmation stays up before the vault opens by itself. */
const SUCCESS_COUNTDOWN_SECONDS = 5;

/** What the page is currently showing. */
type Stage = 'classifying' | 'consent' | 'upgrading' | 'success';

/**
 * Which upgrade the page is serving. All three land the vault on the current storage model; they differ in what
 * they cost the user, which is what decides whether the page asks first.
 */
enum UpgradeKind {
  /**
   * The legacy sqlite-blob upgrade chain (VAULT_VERSIONS, frozen at 2.0.0), applied as SQL against the local
   * vault. Asks first, and shows which vault version it moves the user to.
   *
   * TODO: delete this branch together with requiresLegacySqliteBlobMigration once all users have migrated.
   */
  LegacySqliteBlob = 'legacy-sqlite-blob',

  /**
   * A rebuild of the local database onto the current schema. Purely local and invisible to the rest of the
   * account: every other client materializes the vault into its own schema and carries columns it does not know
   * about in the codec overflow table. Runs unattended.
   */
  SchemaRebuild = 'schema-rebuild',

  /**
   * The one-way move of the account itself onto the manifest storage format and the account key hierarchy. The
   * push that completes it makes the server refuse every v1 vault endpoint, which signs out every client that
   * predates the format. Asks first, and says so.
   */
  StorageFormat = 'storage-format',
}

/**
 * The vault upgrade gate.
 *
 * A single screen for every reason the local vault cannot be opened yet, in the order they apply: first the
 * legacy sqlite-blob chain that brings a pre-2.0.0 vault to 2.0.0, then the manifest migration that puts it on
 * the current storage model. When both are pending they run back to back here, so the user sees one upgrade.
 *
 * This is a hard gate: until it finishes, the local database is still on the old schema and every other page
 * would query columns that do not exist yet. `/upgrade` is therefore listed among the pages that hide the bottom
 * nav and block the header logo, leaving upgrade or sign out as the only two ways out.
 */
const Upgrade: React.FC = () => {
  const { t } = useTranslation();
  const { username } = useApp();
  const auth = useAuth();
  const navigate = useNavigate();
  const webApi = useWebApi();
  const { sqliteClient, requiresLegacySqliteBlobMigration, loadStoredDatabase, refreshSyncState } = useDb();
  const { setHeaderButtons } = useHeaderButtons();
  const { setIsInitialLoading } = useLoading();
  const { executeVaultMutationAsync } = useVaultMutate();
  const { syncVault } = useVaultSync();

  const [stage, setStage] = useState<Stage>('classifying');
  const [kind, setKind] = useState<UpgradeKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<VaultVersion | null>(null);
  const [latestVersion, setLatestVersion] = useState<VaultVersion | null>(null);
  const [showSelfHostedWarning, setShowSelfHostedWarning] = useState(false);
  const [showVersionInfo, setShowVersionInfo] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const hasStarted = useRef(false);
  const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownBarRef = useRef<ICountdownBarHandle>(null);

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    const headerButtonsJSX = !PopoutUtility.isPopup() ? (
      <HeaderButton
        onClick={() => PopoutUtility.openInNewPopup()}
        title={t('common.openInNewWindow')}
        iconType={HeaderIconType.EXPAND}
      />
    ) : null;

    setHeaderButtons(headerButtonsJSX);

    return () => {
      setHeaderButtons(null);
    };
  }, [setHeaderButtons, t]);

  // Clear the auto-continue timer if the page goes away before it fires.
  useEffect((): (() => void) => {
    return () => {
      if (countdownTimerRef.current) {
        clearTimeout(countdownTimerRef.current);
      }
    };
  }, []);

  /**
   * Run the countdown once the confirmation is on screen; the bar only mounts with that stage.
   */
  useEffect(() => {
    if (stage !== 'success') {
      return;
    }
    countdownBarRef.current?.startAnimation(SUCCESS_COUNTDOWN_SECONDS);
    countdownTimerRef.current = setTimeout(() => navigate('/items', { replace: true }), SUCCESS_COUNTDOWN_SECONDS * 1000);
  }, [stage, navigate]);

  /**
   * Load version information from the database, which the legacy chain shows the user before it runs.
   */
  const loadVersionInfo = useCallback(async (): Promise<void> => {
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
    }
  }, [sqliteClient, t]);

  /**
   * Hand the manifest migration to the background, then continue into the vault.
   * @param migrationKind - what the pending migration does, which decides what is shown afterwards
   */
  const runManifestMigration = useCallback(async (migrationKind: UpgradeKind): Promise<void> => {
    setError(null);
    setKind(migrationKind);
    setStage('upgrading');

    const result = await sendMessage('MIGRATE_VAULT_MANIFEST');

    if (!result.success) {
      // Back to the consent screen, where the same button retries and the error says why it has to.
      setError(result.error ?? t('common.errors.unknownError'));
      setStage('consent');
      setIsInitialLoading(false);
      return;
    }

    /*
     * The background stored a new vault blob, so the popup's in-memory copy is stale. Reload before navigating,
     * otherwise the items list would run its queries against the pre-migration database.
     */
    await loadStoredDatabase();
    await refreshSyncState();

    if (!result.pushed) {
      // Local vault is migrated and usable; the upload stays pending and the next sync picks it up.
      console.warn('Vault manifest migration completed locally but has not reached the server yet.');
    }

    setIsInitialLoading(false);

    /*
     * Only the storage format move leaves the user with something to do: their other devices need updating.
     * A schema rebuild changed nothing they can see, so it opens the vault without comment.
     */
    if (migrationKind === UpgradeKind.StorageFormat) {
      setStage('success');
      return;
    }

    navigate('/items', { replace: true });
  }, [loadStoredDatabase, refreshSyncState, navigate, setIsInitialLoading, t]);

  /**
   * Ask the background what the manifest migration would do, and either put it to the user or run it.
   */
  const startManifestUpgrade = useCallback(async (): Promise<void> => {
    const plan = await sendMessage('GET_VAULT_MIGRATION_STATUS');

    if (plan.kind === VaultMigrationKind.StorageFormatUpgrade) {
      setKind(UpgradeKind.StorageFormat);
      setStage('consent');
      setIsInitialLoading(false);
      return;
    }

    // A local schema rebuild, or nothing left to do at all: both are safe to run unattended.
    await runManifestMigration(UpgradeKind.SchemaRebuild);
  }, [runManifestMigration, setIsInitialLoading]);

  /**
   * Continue into the vault once the whole upgrade has landed.
   */
  const finish = useCallback((): void => {
    navigate('/items', { replace: true });
  }, [navigate]);

  /**
   * Pick up whatever is left after the legacy chain has run. The sqlite-blob upgrade brings the vault to 2.0.0,
   * which is the point at which the manifest migration becomes applicable, so it is classified only now.
   */
  const handleLegacyUpgradeSuccess = useCallback(async (): Promise<void> => {
    try {
      // Sync vault to ensure we have the latest data
      await syncVault({
        /**
         * Handle successful sync completion.
         */
        onSuccess: finish,
        /**
         * Continue into the manifest migration, which the sync reports as still pending.
         */
        onManifestMigrationRequired: () => {
          void startManifestUpgrade();
        },
        /**
         * Handle sync error.
         * @param error Error message
         */
        onError: (error: string) => {
          console.error('Sync error after upgrade:', error);
          // Still navigate to items even if sync fails
          finish();
        }
      });
    } catch (error) {
      console.error('Error during post-upgrade sync:', error);
      // Navigate to items even if sync fails
      finish();
    }
  }, [syncVault, finish, startManifestUpgrade]);

  /**
   * Walk the legacy sqlite-blob upgrade chain against the local vault.
   */
  const performLegacyUpgrade = useCallback(async (): Promise<void> => {
    if (!sqliteClient || !currentVersion || !latestVersion) {
      setError(t('upgrade.alerts.unableToGetVersionInfo'));
      return;
    }

    setError(null);
    setStage('upgrading');

    try {
      // Get upgrade SQL commands from vault library
      const vaultSqlGenerator = new VaultSqlGenerator();
      const upgradeResult = vaultSqlGenerator.getUpgradeVaultSql(currentVersion.revision, latestVersion.revision);

      if (!upgradeResult.success) {
        throw new Error(upgradeResult.error ?? t('upgrade.alerts.upgradeFailed'));
      }

      if (upgradeResult.sqlCommands.length === 0) {
        // No upgrade needed, vault is already up to date
        await handleLegacyUpgradeSuccess();
        return;
      }

      /**
       * Use the useVaultMutate hook to handle the upgrade and vault upload.
       * IMPORTANT: Do NOT wrap migration SQL in beginTransaction/commitTransaction!
       * The migration SQL contains PRAGMA foreign_keys statements that MUST be executed
       * outside of any transaction to take effect. The SQL handles its own transactions.
       */
      await executeVaultMutationAsync(async () => {
        // Execute each SQL command (each migration script handles its own transactions)
        for (let i = 0; i < upgradeResult.sqlCommands.length; i++) {
          const sqlCommand = upgradeResult.sqlCommands[i];

          try {
            sqliteClient.executeRaw(sqlCommand);
          } catch (error) {
            console.error(`Error executing SQL command ${i + 1}:`, sqlCommand, error);
            throw new Error(t('upgrade.alerts.failedToApplyMigration', { current: i + 1, total: upgradeResult.sqlCommands.length }));
          }
        }
      });

      await handleLegacyUpgradeSuccess();
    } catch (error) {
      console.error('Upgrade failed:', error);
      setError(error instanceof Error ? error.message : t('common.errors.unknownError'));
      setStage('consent');
      setIsInitialLoading(false);
    }
  }, [sqliteClient, currentVersion, latestVersion, executeVaultMutationAsync, handleLegacyUpgradeSuccess, setIsInitialLoading, t]);

  /**
   * Work out what this vault needs and route to the matching stage. Order matters: a pre-2.0.0 vault has to walk
   * the sqlite-blob chain before the manifest migration can be classified at all.
   */
  useEffect(() => {
    if (!sqliteClient || hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    /**
     * Classify the pending upgrade and show or run it.
     */
    const classify = async (): Promise<void> => {
      try {
        if (await requiresLegacySqliteBlobMigration()) {
          setKind(UpgradeKind.LegacySqliteBlob);
          await loadVersionInfo();
          setStage('consent');
          setIsInitialLoading(false);
          return;
        }

        await startManifestUpgrade();
      } catch (error) {
        console.error('Failed to determine the pending vault upgrade:', error);
        setError(error instanceof Error ? error.message : t('common.errors.unknownError'));
        setStage('consent');
        setIsInitialLoading(false);
      }
    };

    classify();
  }, [sqliteClient, requiresLegacySqliteBlobMigration, loadVersionInfo, startManifestUpgrade, setIsInitialLoading, t]);

  /**
   * Handle the upgrade button, which runs whichever upgrade this vault is waiting on.
   */
  const handleUpgrade = async (): Promise<void> => {
    if (kind !== UpgradeKind.LegacySqliteBlob) {
      await runManifestMigration(kind ?? UpgradeKind.StorageFormat);
      return;
    }

    // Check if this is a self-hosted instance and show warning if needed
    if (await webApi.isSelfHosted()) {
      setShowSelfHostedWarning(true);
      return;
    }

    await performLegacyUpgrade();
  };

  /**
   * Handle the logout (after confirmation).
   * Uses clearAuthUserInitiated to fully clear vault data since user explicitly chose to logout.
   */
  const handleLogout = async (): Promise<void> => {
    setShowLogoutConfirm(false);
    try {
      await webApi.revokeTokens();
      await auth.clearAuthUserInitiated();
    } catch (error) {
      console.error('Error during logout:', error);
    }
  };

  if (stage === 'classifying' || stage === 'upgrading') {
    return (
      <div className="flex flex-col justify-center items-center py-12">
        <LoadingSpinner />
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-4 px-6 text-center">
          {t('upgrade.upgrading')}
        </div>
      </div>
    );
  }

  if (stage === 'success') {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center">
        <CountdownBar ref={countdownBarRef} isVisible={true} colorClass="bg-primary-500" />

        <div className="mb-4 text-green-600 dark:text-green-400">
          <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">{t('upgrade.successTitle')}</h2>
        <p className="mb-6 text-gray-600 dark:text-gray-400">{t('upgrade.successOtherDevices')}</p>

        <Button type="button" id="upgrade-continue-button" onClick={finish}>
          {t('auth.browseVault')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Self-hosted warning modal */}
      <Modal
        isOpen={showSelfHostedWarning}
        onClose={() => setShowSelfHostedWarning(false)}
        onConfirm={() => {
          setShowSelfHostedWarning(false);
          void performLegacyUpgrade();
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
          <div className="mb-4 text-red-500 dark:text-red-400 break-words">
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

          {kind === UpgradeKind.LegacySqliteBlob && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-gray-700 dark:text-gray-200">{t('upgrade.versionInformation')}</span>
                <button
                  type="button"
                  onClick={() => setShowVersionInfo(true)}
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
          )}

          {kind === UpgradeKind.StorageFormat && (
            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-900 rounded p-4 text-sm text-orange-800 dark:text-orange-300">
              {t('upgrade.otherDevicesWarning', { version: AppInfo.API_VERSION })}
            </div>
          )}
        </div>

        <div className="flex flex-col w-full space-y-2">
          <Button type="button" id="upgrade-button" onClick={handleUpgrade}>
            {t('upgrade.upgrade')}
          </Button>
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm font-medium py-2"
          >
            {t('common.logout')}
          </button>
        </div>
      </form>

      {/* Logout Confirmation Modal */}
      <LogoutConfirmModal
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
      />
    </div>
  );
};

export default Upgrade;
