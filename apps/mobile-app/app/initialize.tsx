import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { VaultUnlockHelper } from '@/utils/VaultUnlockHelper';

import { useVaultSync } from '@/hooks/useVaultSync';

import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedView } from '@/components/themed/ThemedView';
import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import { useNavigation } from '@/context/NavigationContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Initialize page that handles all boot logic.
 */
export default function Initialize() : React.ReactNode {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const hasInitialized = useRef(false);
  const { t } = useTranslation();
  const app = useApp();
  const navigation = useNavigation();
  const { syncVault } = useVaultSync();
  const dbContext = useDb();

  /**
   * Update status message.
   */
  const updateStatus = useCallback((message: string): void => {
    setStatus(message);
  }, []);

  useEffect(() => {
    // Ensure this only runs once.
    if (hasInitialized.current) {
      return;
    }

    hasInitialized.current = true;

    /**
     * Initialize the app.
     */
    const initializeApp = async () : Promise<void> => {
      /**
       * Initialize the app.
       */
      const initialize = async () : Promise<void> => {
        const { isLoggedIn, enabledAuthMethods } = await app.initializeAuth();

        if (!isLoggedIn) {
          router.replace('/login');
          return;
        }

        /**
         * If we already have an unlocked vault, we can skip the biometric unlock
         * but still need to perform vault sync to check for updates.
         */
        const isAlreadyUnlocked = await NativeVaultManager.isVaultUnlocked();

        if (!isAlreadyUnlocked) {
          // Check if we have an encrypted database and if FaceID is enabled
          try {
            const hasEncryptedDatabase = await NativeVaultManager.hasEncryptedDatabase();

            if (hasEncryptedDatabase) {
              // Attempt automatic unlock using centralized helper
              updateStatus(t('app.status.unlockingVault'));
              const unlockResult = await VaultUnlockHelper.attemptAutomaticUnlock({ enabledAuthMethods, unlockVault: dbContext.unlockVault });

              if (!unlockResult.success) {
                /*
                 * Unlock failed or cancelled, redirect to unlock screen.
                 * Only log non-cancellation errors to avoid noise.
                 */
                if (!unlockResult.error?.includes('cancelled')) {
                  console.error('Automatic unlock failed:', unlockResult.error);
                }
                router.replace('/unlock');
                return;
              }

              // Check if the vault needs migration before syncing
              if (await dbContext.hasPendingMigrations()) {
                router.replace('/upgrade');
                return;
              }
            }
          } catch (err) {
            console.error('Error during initial vault unlock:', err);
            router.replace('/unlock');
            return;
          }
        } else {
          /**
           * Vault already unlocked (e.g., from password unlock)
           * Check if migrations are needed.
           */
          if (await dbContext.hasPendingMigrations()) {
            router.replace('/upgrade');
            return;
          }
        }

        /*
         * Perform vault sync in background - don't block app access.
         * The ServerSyncIndicator will show sync progress/offline status.
         * This also handles uploading pending local changes (isDirty) from previous sessions.
         */
        dbContext.setIsSyncing(true);
        void (async (): Promise<void> => {
          try {
            await syncVault({
              /**
               * Handle successful vault sync.
               */
              onSuccess: async () => {
                // Sync completed - ServerSyncIndicator will update
                await dbContext.refreshSyncState();
              },
              /**
               * Handle offline state - just set offline mode and continue.
               * The ServerSyncIndicator will show offline status.
               */
              onOffline: async () => {
                await dbContext.setIsOffline(true);
                await dbContext.refreshSyncState();
              },
              /**
               * Handle error during vault sync.
               */
              onError: async (error: string) => {
                console.error('Vault sync error during initialize:', error);
                await dbContext.refreshSyncState();
              },
              /**
               * On upgrade required.
               */
              onUpgradeRequired: () : void => {
                router.replace('/upgrade');
              },
            });
          } finally {
            dbContext.setIsSyncing(false);
            await dbContext.refreshSyncState();
          }
        })();

        // Navigate immediately - don't wait for sync
        navigation.navigateAfterUnlock();
      };

      initialize();
    };

    initializeApp();
  }, [dbContext, syncVault, app, router, navigation, t, updateStatus]);

  const styles = StyleSheet.create({
    container: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'flex-start',
      paddingHorizontal: 20,
      paddingTop: '40%', // Position above center to avoid Face ID prompt obstruction
    },
  });

  return (
    <ThemedView style={styles.container} testID="initialize-screen">
      <View>
        <LoadingIndicator status={status || ''} />
      </View>
    </ThemedView>
  );
}