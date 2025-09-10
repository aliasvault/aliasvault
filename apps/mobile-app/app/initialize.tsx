import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet } from 'react-native';

import { useVaultSync } from '@/hooks/useVaultSync';

import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedView } from '@/components/themed/ThemedView';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Initialize page that handles all boot logic.
 */
export default function Initialize() : React.ReactNode {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const hasInitialized = useRef(false);
  const { t } = useTranslation();
  const { initializeAuth } = useAuth();
  const { syncVault } = useVaultSync();
  const dbContext = useDb();
  const webApi = useWebApi();

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
       * Handle vault unlocking process.
       */
      async function handleVaultUnlock() : Promise<void> {
        const { enabledAuthMethods } = await initializeAuth();

        try {
          const hasEncryptedDatabase = await NativeVaultManager.hasEncryptedDatabase();
          if (hasEncryptedDatabase) {
            const isFaceIDEnabled = enabledAuthMethods.includes('faceid');
            if (!isFaceIDEnabled) {
              router.replace('/unlock');
              return;
            }

            setStatus(t('app.status.unlockingVault'));
            const isUnlocked = await dbContext.unlockVault();
            if (isUnlocked) {
              await new Promise(resolve => setTimeout(resolve, 750));
              setStatus(t('app.status.decryptingVault'));
              await new Promise(resolve => setTimeout(resolve, 750));

              // Check if the vault is up to date, if not, redirect to the upgrade page.
              if (await dbContext.hasPendingMigrations()) {
                router.replace('/upgrade');
                return;
              }

              router.replace('/(tabs)/credentials');
              return;
            }

            router.replace('/unlock');
            return;
          } else {
            router.replace('/unlock');
            return;
          }
        } catch {
          router.replace('/unlock');
          return;
        }
      }

      /**
       * Initialize the app.
       */
      const initialize = async () : Promise<void> => {
        const { isLoggedIn } = await initializeAuth();

        if (!isLoggedIn) {
          router.replace('/login');
          return;
        }

        // First perform vault sync
        await syncVault({
          initialSync: true,
          /**
           * Handle the status update.
           */
          onStatus: (message) => {
            setStatus(message);
          },
          /**
           * Handle successful vault sync and continue with vault unlock flow.
           */
          onSuccess: async () => {
          // Continue with the rest of the flow after successful sync
            handleVaultUnlock();
          },
          /**
           * Handle offline state and prompt user for action.
           */
          onOffline: async () => {
            Alert.alert(
              t('app.alerts.syncIssue'),
              t('app.alerts.syncIssueMessage'),
              [
                {
                  text: t('app.alerts.openLocalVault'),
                  /**
                   * Handle opening vault in read-only mode.
                   */
                  onPress: async () : Promise<void> => {
                    setStatus(t('app.status.openingVaultReadOnly'));
                    await handleVaultUnlock();
                  }
                },
                {
                  text: t('app.alerts.retrySync'),
                  /**
                   * Handle retrying the connection.
                   */
                  onPress: () : void => {
                    setStatus(t('app.status.retryingConnection'));
                    initialize();
                  }
                }
              ]
            );
          },
          /**
           * Handle error during vault sync.
           */
          onError: async (error: string) => {
          // Show modal with error message
            Alert.alert(t('common.error'), error);

            // The logout user and navigate to the login screen.
            await webApi.logout(error);
            router.replace('/login');
          },
          /**
           * On upgrade required.
           */
          onUpgradeRequired: () : void => {
            router.replace('/upgrade');
          },
        });
      };

      initialize();
    };

    initializeApp();
  }, [dbContext, syncVault, initializeAuth, webApi, router, t]);

  const styles = StyleSheet.create({
    container: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
    },
  });

  return (
    <ThemedView style={styles.container}>
      {status ? <LoadingIndicator status={status} /> : null}
    </ThemedView>
  );
}