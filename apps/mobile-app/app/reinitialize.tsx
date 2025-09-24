import { Href, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, Alert } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultSync } from '@/hooks/useVaultSync';

import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Reinitialize screen which is triggered when the app was still open but the database in memory
 * was cleared because of a time-out. When this happens, we need to re-initialize and unlock the vault.
 */
export default function ReinitializeScreen() : React.ReactNode {
  const authContext = useAuth();
  const dbContext = useDb();
  const { syncVault } = useVaultSync();
  const [status, setStatus] = useState('');
  const [showOfflineButton, setShowOfflineButton] = useState(false);
  const hasInitialized = useRef(false);
  const offlineButtonTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const colors = useColors();
  const { t } = useTranslation();

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
            const { enabledAuthMethods } = await authContext.initializeAuth();

            try {
              const hasEncryptedDatabase = await NativeVaultManager.hasEncryptedDatabase();

              // No encrypted database
              if (!hasEncryptedDatabase) {
                router.replace('/unlock');
                return;
              }

              // Set offline mode
              authContext.setOfflineMode(true);

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
              await new Promise(resolve => setTimeout(resolve, 1000));
              setStatus(t('app.status.decryptingVault'));
              await new Promise(resolve => setTimeout(resolve, 1000));

              // Migrations pending
              if (await dbContext.hasPendingMigrations()) {
                router.replace('/upgrade');
                return;
              }

              // Handle navigation based on return URL
              if (!authContext.returnUrl?.path) {
                router.replace('/(tabs)/credentials');
                return;
              }

              // Navigate to return URL
              const path = authContext.returnUrl.path as string;
              const isDetailRoute = path.includes('credentials/');

              if (!isDetailRoute) {
                router.replace({
                  pathname: path as '/',
                  params: authContext.returnUrl.params as Record<string, string>
                });
                authContext.setReturnUrl(null);
                return;
              }

              // Handle detail routes
              const params = authContext.returnUrl.params as Record<string, string>;
              router.replace('/(tabs)/credentials');
              setTimeout(() => {
                if (params.serviceUrl) {
                  router.push(path + '?serviceUrl=' + params.serviceUrl);
                } else if (params.id) {
                  router.push(path + '?id=' + params.id);
                } else {
                  router.push(path);
                }
              }, 0);
              authContext.setReturnUrl(null);
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
             * Reset the hasInitialized flag and navigate to reinitialize route
             * to force a re-render and trigger the useEffect again
             */
            hasInitialized.current = false;
            router.replace('/reinitialize');
          }
        }
      ]
    );
  }, [authContext, dbContext, t]);

  useEffect(() => {
    if (hasInitialized.current) {
      return;
    }

    hasInitialized.current = true;

    /**
     * Redirect to the return URL.
     */
    function redirectToReturnUrl() : void {
      /**
       * Simulate stack navigation.
       */
      function simulateStackNavigation(from: string, to: string) : void {
        router.replace(from as Href);
        setTimeout(() => {
          router.push(to as Href);
        }, 0);
      }

      if (authContext.returnUrl?.path) {
        // Type assertion needed due to router type limitations
        const path = authContext.returnUrl.path as '/';
        const isDetailRoute = path.includes('credentials/');
        if (isDetailRoute) {
          // If there is a "serviceUrl" or "id" param from the return URL, use it.
          const params = authContext.returnUrl.params as Record<string, string>;

          if (params.serviceUrl) {
            simulateStackNavigation('/(tabs)/credentials', path + '?serviceUrl=' + params.serviceUrl);
          } else if (params.id) {
            simulateStackNavigation('/(tabs)/credentials', path + '?id=' + params.id);
          } else {
            simulateStackNavigation('/(tabs)/credentials', path);
          }
        } else {
          router.replace({
            pathname: path,
            params: authContext.returnUrl.params as Record<string, string>
          });
        }
        // Clear the return URL after using it
        authContext.setReturnUrl(null);
      } else {
        // If there is no return URL, navigate to the credentials tab as default entry page.
        router.replace('/(tabs)/credentials');
      }
    }

    /**
     * Handle vault unlocking process.
     */
    async function handleVaultUnlock() : Promise<void> {
      const { enabledAuthMethods } = await authContext.initializeAuth();

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
            await new Promise(resolve => setTimeout(resolve, 1000));
            setStatus(t('app.status.decryptingVault'));
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Check if the vault is up to date, if not, redirect to the upgrade page.
            if (await dbContext.hasPendingMigrations()) {
              router.replace('/upgrade');
              return;
            }

            redirectToReturnUrl();
            return;
          }
        }

        router.replace('/unlock');
      } catch {
        router.replace('/unlock');
      }
    }

    /**
     * Initialize the app.
     */
    const initialize = async () : Promise<void> => {
      const { isLoggedIn } = await authContext.initializeAuth();

      // If user is not logged in, navigate to login immediately
      if (!isLoggedIn) {
        router.replace('/login');
        return;
      }

      // If we already have an unlocked vault, we can skip the sync and go straight to the credentials screen
      if (await NativeVaultManager.isVaultUnlocked()) {
        router.replace('/(tabs)/credentials');
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
          await handleVaultUnlock();
        },
        /**
         * Handle offline state and prompt user for action.
         */
        onOffline: () => {
          handleOfflineFlow();
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

    // Cleanup timeout on unmount
    return (): void => {
      if (offlineButtonTimeoutRef.current) {
        clearTimeout(offlineButtonTimeoutRef.current);
      }
    };
  }, [syncVault, authContext, dbContext, t, handleOfflineFlow]);

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
    message1: {
      marginTop: 5,
      textAlign: 'center',
    },
    message2: {
      textAlign: 'center',
    },
    messageContainer: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      padding: 20,
    },
  });

  return (
    <ThemedView style={styles.container}>
      <View style={styles.messageContainer}>
        <ThemedText style={styles.message1}>{t('app.reinitialize.vaultAutoLockedMessage')}</ThemedText>
        <ThemedText style={styles.message2}>{t('app.reinitialize.attemptingToUnlockMessage')}</ThemedText>
        {status ? (
          <LoadingIndicator
            status={status}
            showOfflineButton={showOfflineButton}
            onOfflinePress={handleOfflinePress}
          />
        ) : null}
      </View>
    </ThemedView>
  );
}
