import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Button from '@/entrypoints/popup/components/Button';
import LogoutConfirmModal from '@/entrypoints/popup/components/Dialogs/LogoutConfirmModal';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

/**
 * Manifest migration page.
 *
 * Rebuilds the local vault onto the current storage schema — the delivery path for all post-2.0.0 schema
 * changes, including the initial legacy `sqlite-blob` to manifest-v1 transition. Migration is automatic by design.
 */
const ManifestMigration: React.FC = () => {
  const { t } = useTranslation();
  const auth = useAuth();
  const webApi = useWebApi();
  const navigate = useNavigate();
  const { setHeaderButtons } = useHeaderButtons();
  const { setIsInitialLoading } = useLoading();
  const { loadStoredDatabase, refreshSyncState } = useDb();

  const [error, setError] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const hasStarted = useRef(false);

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

  /**
   * Run the migration and continue into the app as soon as the local vault is on the current schema.
   */
  const runMigration = useCallback(async (): Promise<void> => {
    setError(null);

    const result = await sendMessage('MIGRATE_VAULT_MANIFEST');

    if (!result.success) {
      setError(result.error ?? t('common.errors.unknownError'));
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

    navigate('/items', { replace: true });
  }, [loadStoredDatabase, refreshSyncState, navigate, setIsInitialLoading, t]);

  // Start automatically on mount; the ref keeps a re-render from launching a second migration.
  useEffect(() => {
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;
    runMigration();
  }, [runMigration]);

  /**
   * Retry after a failed migration.
   */
  const handleRetry = useCallback((): void => {
    setIsInitialLoading(true);
    runMigration();
  }, [runMigration, setIsInitialLoading]);

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

  if (!error) {
    return (
      <div className="flex flex-col justify-center items-center py-12">
        <LoadingSpinner />
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-4 px-6 text-center">
          {t('manifestMigration.migrating')}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-2 pt-2 pb-2 mb-4">
      <LogoutConfirmModal
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
      />

      <h2 className="text-xl font-bold dark:text-gray-200 mb-4">{t('manifestMigration.failedTitle')}</h2>

      <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
        {t('manifestMigration.failedDescription')}
      </p>

      <div className="mb-6 bg-gray-50 dark:bg-gray-800 rounded p-4 text-sm text-red-500 dark:text-red-400 break-words">
        {error}
      </div>

      <div className="flex flex-col w-full space-y-2">
        <Button type="button" id="manifest-migration-retry-button" onClick={handleRetry}>
          {t('common.retry')}
        </Button>
        <button
          type="button"
          onClick={() => setShowLogoutConfirm(true)}
          className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm font-medium py-2"
        >
          {t('common.logout')}
        </button>
      </div>
    </div>
  );
};

export default ManifestMigration;
