import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import GlobalNotificationDisplay from '@/components/alerts/GlobalNotificationDisplay';
import ClipboardCountdownBar from '@/components/layout/ClipboardCountdownBar';
import Footer from '@/components/layout/Footer';
import TopMenu from '@/components/layout/TopMenu';
import ConfirmModal from '@/components/shared/ConfirmModal';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { useVaultSync } from '@/hooks/useVaultSync';
import { setLocalPreference } from '@/utils/LocalPreferences';
import { LocalPreferenceKeys } from '@/utils/StorageKeys';
import { vaultStore } from '@/vault/VaultStore';

/**
 * Layout of the logged-in area: not logged in goes to the start page, a locked vault to the unlock page,
 * and a vault that is not loaded yet to the sync page which returns here.
 */
const MainLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isInitialized, isLoggedIn } = useAuth();
  const { t } = useTranslation();
  const { dbInitialized, dbAvailable, syncError, clearSyncError } = useDb();
  const { syncVault } = useVaultSync();
  const [isReady, setIsReady] = useState(false);
  const hasSynced = useRef(false);

  useEffect(() => {
    if (!isInitialized || !dbInitialized) {
      return;
    }

    /**
     * Decide where the user has to go before the page can render.
     */
    const gate = async (): Promise<void> => {
      const status = await vaultStore.checkAuthStatus();
      if (!status.isLoggedIn || !isLoggedIn) {
        navigate('/user/start', { replace: true });
        return;
      }
      if (status.isVaultLocked) {
        navigate('/unlock', { replace: true });
        return;
      }
      if (!dbAvailable) {
        setLocalPreference(LocalPreferenceKeys.RETURN_URL, location.pathname + location.search);
        navigate('/sync', { replace: true });
        return;
      }
      setIsReady(true);
    };
    void gate();
  }, [isInitialized, isLoggedIn, dbInitialized, dbAvailable, navigate, location.pathname, location.search]);

  /**
   * Once the vault is open, check the server for a newer vault in the background (once per page load).
   */
  useEffect(() => {
    if (!isReady || hasSynced.current) {
      return;
    }
    hasSynced.current = true;
    void syncVault({
      /**
       * A pending migration sends the user through the sync page.
       */
      onLegacySqliteBlobUpgradeRequired: () => navigate('/sync', { replace: true }),
      /**
       * A pending migration sends the user through the sync page.
       */
      onManifestMigrationRequired: () => navigate('/sync', { replace: true }),
      /**
       * A failed background sync is not fatal; the local vault stays usable and the sync error dialog shows why.
       */
      onError: (error) => console.error('Background vault sync error:', error),
    });
  }, [isReady, syncVault, navigate]);

  if (!isReady) {
    return null;
  }

  return (
    <>
      <ClipboardCountdownBar />
      <TopMenu />
      <div className="flex pt-16 mb-4 lg:mb-16 overflow-x-hidden bg-gray-100 dark:bg-gray-900 relative">
        <div id="main-content" className="relative w-full max-w-screen-2xl mx-auto h-full overflow-y-auto bg-gray-100 dark:bg-gray-900 min-h-[300px]">
          <main>
            <GlobalNotificationDisplay />
            <Outlet />
          </main>
        </div>
      </div>
      <Footer />
      {syncError && (
        <ConfirmModal title={t('sharedResources.Error')} message={syncError} confirmText={t('sharedResources.Close')} onClose={() => void clearSyncError()} />
      )}
    </>
  );
};

export default MainLayout;
