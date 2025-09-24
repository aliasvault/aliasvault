import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, useCallback } from 'react';
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
  const [showOfflineButton, setShowOfflineButton] = useState(false);
  const hasInitialized = useRef(false);
  const offlineButtonTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { t } = useTranslation();
  const { initializeAuth, setOfflineMode } = useAuth();
  const { syncVault } = useVaultSync();
  const dbContext = useDb();
  const webApi = useWebApi();

  /**
   * Handle offline scenario - show alert with options to open local vault or retry sync.
   */
  const handleOfflineFlow = useCallback((): void => {
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
            const { enabledAuthMethods } = await initializeAuth();

            try {
              const hasEncryptedDatabase = await NativeVaultManager.hasEncryptedDatabase();

              // No encrypted database
              if (!hasEncryptedDatabase) {
                router.replace('/unlock');
                return;
              }

              // FaceID not enabled
              const isFaceIDEnabled = enabledAuthMethods.includes('faceid');
              if (!isFaceIDEnabled) {
                router.replace('/unlock');
                return;
              }

              // Attempt to unlock vault
              setStatus(t('app.status.unlockingVault'));
              const isUnlocked = await dbContext.unlockVault();

              // Vault couldn't be unlocked
              if (!isUnlocked) {
                router.replace('/unlock');
                return;
              }

              // Vault successfully unlocked - proceed with decryption
              await new Promise(resolve => setTimeout(resolve, 750));
              setStatus(t('app.status.decryptingVault'));
              await new Promise(resolve => setTimeout(resolve, 750));

              // Migrations pending
              if (await dbContext.hasPendingMigrations()) {
                router.replace('/upgrade');
                return;
              }

              // Set offline mode
              setOfflineMode(true);

              // Success - navigate to credentials
              router.replace('/(tabs)/credentials');
            } catch {
              router.replace('/unlock');
            }
          }
        },
        {
          text: t('app.alerts.retrySync'),
          /**
           * Handle retrying the connection.
           */
          onPress: () : void => {
            setStatus(t('app.status.retryingConnection'));
            setShowOfflineButton(false);

            // Clear any existing timeout
            if (offlineButtonTimeoutRef.current) {
              clearTimeout(offlineButtonTimeoutRef.current);
              offlineButtonTimeoutRef.current = null;
            }

            /**
             * Reset the hasInitialized flag and navigate to the same route
             * to force a re-render and trigger the useEffect again
             */
            hasInitialized.current = false;
            router.replace('/initialize');
          }
        }
      ]
    );
  }, [dbContext, router, initializeAuth, t, setOfflineMode]);

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

            // Clear any existing timeout
            if (offlineButtonTimeoutRef.current) {
              clearTimeout(offlineButtonTimeoutRef.current);
            }

            // Show offline button after 2 seconds if we're checking vault updates
            if (message === t('vault.checkingVaultUpdates')) {
              offlineButtonTimeoutRef.current = setTimeout(() => {
                setShowOfflineButton(true);
              }, 2000) as unknown as NodeJS.Timeout;
            } else {
              setShowOfflineButton(false);
            }
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
          onOffline: () => {
            handleOfflineFlow();
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

    // Cleanup timeout on unmount
    return (): void => {
      if (offlineButtonTimeoutRef.current) {
        clearTimeout(offlineButtonTimeoutRef.current);
      }
    };
  }, [dbContext, syncVault, initializeAuth, webApi, router, t, handleOfflineFlow]);

  /**
   * Handle offline button press by calling the stored offline handler.
   */
  const handleOfflinePress = (): void => {
    // Clear any existing timeout
    if (offlineButtonTimeoutRef.current) {
      clearTimeout(offlineButtonTimeoutRef.current);
    }

    setShowOfflineButton(false);

    handleOfflineFlow();
  };

  const styles = StyleSheet.create({
    container: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
    },
  });

  return (
    <ThemedView style={styles.container}>
      {status ? (
        <LoadingIndicator
          status={status}
          showOfflineButton={showOfflineButton}
          onOfflinePress={handleOfflinePress}
        />
      ) : null}
    </ThemedView>
  );
}