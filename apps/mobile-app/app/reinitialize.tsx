import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { VaultUnlockHelper } from '@/utils/VaultUnlockHelper';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultSync } from '@/hooks/useVaultSync';

import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import { useNavigation } from '@/context/NavigationContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Reinitialize screen which is triggered when the app was still open but the database in memory
 * was cleared because of a time-out. When this happens, we need to re-initialize and unlock the vault.
 */
export default function ReinitializeScreen() : React.ReactNode {
  const app = useApp();
  const dbContext = useDb();
  const navigation = useNavigation();
  const { syncVault } = useVaultSync();
  const [status, setStatus] = useState('');
  const hasInitialized = useRef(false);
  const colors = useColors();
  const { t } = useTranslation();

  /**
   * Update status message.
   */
  const updateStatus = useCallback((message: string): void => {
    setStatus(message);
  }, []);

  useEffect(() => {
    if (hasInitialized.current) {
      return;
    }

    hasInitialized.current = true;

    /**
     * Initialize the app.
     */
    const initialize = async () : Promise<void> => {
      const { isLoggedIn, enabledAuthMethods } = await app.initializeAuth();

      // If user is not logged in, navigate to login immediately
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
        // Check if we have an encrypted database
        try {
          const hasEncryptedDatabase = await NativeVaultManager.hasEncryptedDatabase();

          if (hasEncryptedDatabase) {
            // Attempt automatic unlock using centralized helper
            updateStatus(t('app.status.unlockingVault'));
            const unlockResult = await VaultUnlockHelper.attemptAutomaticUnlock({ enabledAuthMethods, unlockVault: dbContext.unlockVault });

            if (!unlockResult.success) {
              // Unlock failed, redirect to unlock screen
              console.error('Automatic unlock failed:', unlockResult.error);
              router.replace('/unlock');
              return;
            }

            // Add small delay for UX
            await new Promise(resolve => setTimeout(resolve, 300));
            updateStatus(t('app.status.decryptingVault'));
            await new Promise(resolve => setTimeout(resolve, 500));

            // Check if the vault needs migration before syncing
            if (await dbContext.hasPendingMigrations()) {
              router.replace('/upgrade');
              return;
            }
          } else {
            // No encrypted database, redirect to unlock screen
            router.replace('/unlock');
            return;
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
             * Handle error during vault sync.
             * Authentication errors are already handled in useVaultSync.
             */
            onError: async (error: string) => {
              console.error('Vault sync error during reinitialize:', error);
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
             * On upgrade required.
             */
            onUpgradeRequired: () : void => {
              router.replace('/upgrade');
            },
          });
        } finally {
          await dbContext.refreshSyncState();
        }
      })();

      // Navigate immediately
      navigation.navigateAfterUnlock();
    };

    initialize();
  }, [syncVault, app, dbContext, navigation, t, updateStatus]);

  const styles = StyleSheet.create({
    container: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'flex-start',
      paddingHorizontal: 20,
      paddingTop: '40%', // Position above center to avoid Face ID prompt obstruction
    },
    contentWrapper: {
      alignItems: 'center',
      width: '100%',
    },
    message1: {
      marginTop: 5,
      textAlign: 'center',
      color: colors.textMuted,
    },
    message2: {
      textAlign: 'center',
      marginBottom: 20,
      color: colors.textMuted,
    },
    messageContainer: {
      alignItems: 'center',
      width: '100%',
    },
  });

  return (
    <ThemedView style={styles.container} testID="reinitialize-screen">
      <View style={styles.contentWrapper}>
        <View style={styles.messageContainer}>
          {status ? <LoadingIndicator status={status} /> : null}
          <ThemedText style={styles.message1}>{t('app.reinitialize.vaultAutoLockedMessage')}</ThemedText>
          <ThemedText style={styles.message2}>{t('app.reinitialize.attemptingToUnlockMessage')}</ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}
