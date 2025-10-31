import { Ionicons } from '@expo/vector-icons';
import { Href, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, Alert, TouchableOpacity } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultSync } from '@/hooks/useVaultSync';

import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Reinitialize screen which is triggered when the app was still open but the database in memory
 * was cleared because of a time-out. When this happens, we need to re-initialize and unlock the vault.
 */
export default function ReinitializeScreen() : React.ReactNode {
  const app = useApp();
  const dbContext = useDb();
  const { syncVault } = useVaultSync();
  const [status, setStatus] = useState('');
  const [showSkipButton, setShowSkipButton] = useState(false);
  const hasInitialized = useRef(false);
  const skipButtonTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastStatusRef = useRef<string>('');
  const canShowSkipButtonRef = useRef(false); // Only allow skip button after vault unlock
  const colors = useColors();
  const { t } = useTranslation();

  /**
   * Update status with smart skip button logic.
   * Normalizes status by removing animation dots and manages skip button visibility.
   */
  const updateStatus = useCallback((message: string): void => {
    setStatus(message);

    // Normalize status by removing animation dots for comparison
    const normalizedMessage = message.replace(/\.+$/, '');
    const normalizedLastStatus = lastStatusRef.current.replace(/\.+$/, '');

    // Clear any existing timeout
    if (skipButtonTimeoutRef.current) {
      clearTimeout(skipButtonTimeoutRef.current);
      skipButtonTimeoutRef.current = null;
    }

    // If status changed (excluding dots), hide skip button and reset timer
    if (normalizedMessage !== normalizedLastStatus) {
      setShowSkipButton(false);
      lastStatusRef.current = message;

      // Start new timer for the new status (only if skip button is allowed)
      if (message && canShowSkipButtonRef.current) {
        skipButtonTimeoutRef.current = setTimeout(() => {
          setShowSkipButton(true);
        }, 5000) as unknown as NodeJS.Timeout;
      }
    } else {
      // Same status (excluding dots) - update ref but keep timer running
      lastStatusRef.current = message;
    }
  }, []);

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
            updateStatus(t('app.status.openingVaultReadOnly'));
            const { enabledAuthMethods } = await app.initializeAuth();

            try {
              const hasEncryptedDatabase = await NativeVaultManager.hasEncryptedDatabase();

              // No encrypted database
              if (!hasEncryptedDatabase) {
                router.replace('/unlock');
                return;
              }

              // Set offline mode
              app.setOfflineMode(true);

              // FaceID not enabled
              const isFaceIDEnabled = enabledAuthMethods.includes('faceid');
              if (!isFaceIDEnabled) {
                router.replace('/unlock');
                return;
              }

              // Attempt to unlock vault
              updateStatus(t('app.status.unlockingVault'));
              const isUnlocked = await dbContext.unlockVault();

              // Vault couldn't be unlocked
              if (!isUnlocked) {
                router.replace('/unlock');
                return;
              }

              // Vault successfully unlocked - proceed with decryption
              await new Promise(resolve => setTimeout(resolve, 500));

              // Migrations pending
              if (await dbContext.hasPendingMigrations()) {
                router.replace('/upgrade');
                return;
              }

              // Handle navigation based on return URL
              if (!app.returnUrl?.path) {
                router.replace('/(tabs)/credentials');
                return;
              }

              // Navigate to return URL
              const path = app.returnUrl.path as string;
              const isDetailRoute = path.includes('credentials/');

              if (!isDetailRoute) {
                router.replace({
                  pathname: path as '/',
                  params: app.returnUrl.params as Record<string, string>
                });
                app.setReturnUrl(null);
                return;
              }

              // Handle detail routes
              const params = app.returnUrl.params as Record<string, string>;
              router.replace('/(tabs)/credentials');
              setTimeout(() => {
                if (params.serviceUrl) {
                  router.push(`${path}?serviceUrl=${params.serviceUrl}` as Href);
                } else if (params.id) {
                  router.push(`${path}?id=${params.id}` as Href);
                } else {
                  router.push(path as Href);
                }
              }, 0);
              app.setReturnUrl(null);
            } catch (err) {
              console.error('Error during offline vault unlock:', err);
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
            updateStatus(t('app.status.retryingConnection'));
            setShowSkipButton(false);

            // Clear any existing timeout
            if (skipButtonTimeoutRef.current) {
              clearTimeout(skipButtonTimeoutRef.current);
              skipButtonTimeoutRef.current = null;
            }

            // Reset status tracking
            lastStatusRef.current = '';

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
  }, [app, dbContext, t, updateStatus]);

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

      if (app.returnUrl?.path) {
        // Type assertion needed due to router type limitations
        const path = app.returnUrl.path as '/';
        const isDetailRoute = path.includes('credentials/');
        if (isDetailRoute) {
          // If there is a "serviceUrl" or "id" param from the return URL, use it.
          const params = app.returnUrl.params as Record<string, string>;

          if (params.serviceUrl) {
            simulateStackNavigation('/(tabs)/credentials', `${path}?serviceUrl=${params.serviceUrl}`);
          } else if (params.id) {
            simulateStackNavigation('/(tabs)/credentials', `${path}?id=${params.id}`);
          } else {
            simulateStackNavigation('/(tabs)/credentials', path as string);
          }
        } else {
          router.replace({
            pathname: path,
            params: app.returnUrl.params as Record<string, string>
          });
        }
        // Clear the return URL after using it
        app.setReturnUrl(null);
      } else {
        // If there is no return URL, navigate to the credentials tab as default entry page.
        router.replace('/(tabs)/credentials');
      }
    }

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
        // Check if we have an encrypted database and if FaceID is enabled
        try {
          const hasEncryptedDatabase = await NativeVaultManager.hasEncryptedDatabase();

          if (hasEncryptedDatabase) {
            const isFaceIDEnabled = enabledAuthMethods.includes('faceid');

            // Only attempt to unlock if FaceID is enabled
            if (isFaceIDEnabled) {
              // Unlock vault FIRST (before network sync) - this is not skippable
              updateStatus(t('app.status.unlockingVault'));
              const isUnlocked = await dbContext.unlockVault();

              if (!isUnlocked) {
                // Failed to unlock, redirect to unlock screen
                router.replace('/unlock');
                return;
              }

              // Add small delay for UX
              await new Promise(resolve => setTimeout(resolve, 500));
              updateStatus(t('app.status.decryptingVault'));
              await new Promise(resolve => setTimeout(resolve, 750));

              // Check if the vault needs migration before syncing
              if (await dbContext.hasPendingMigrations()) {
                router.replace('/upgrade');
                return;
              }

              // Vault unlocked successfully - now allow skip button for network operations
              canShowSkipButtonRef.current = true;
            } else {
              // No FaceID, redirect to unlock screen
              router.replace('/unlock');
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

        /**
         * Allow skip button for sync operations since vault is already unlocked.
         */
        canShowSkipButtonRef.current = true;
      }

      // Now perform vault sync (network operations - these are skippable)
      await syncVault({
        initialSync: true,
        /**
         * Handle the status update.
         */
        onStatus: (message) => {
          updateStatus(message);
        },
        /**
         * Handle successful vault sync.
         */
        onSuccess: async () => {
          // Vault already unlocked, just navigate to return URL
          redirectToReturnUrl();
        },
        /**
         * Handle error during vault sync.
         * Authentication errors are already handled in useVaultSync.
         */
        onError: (error: string) => {
          console.error('Vault sync error during reinitialize:', error);
          // Even if sync fails, vault is already unlocked, so navigate to return URL
          redirectToReturnUrl();
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
  }, [syncVault, app, dbContext, t, handleOfflineFlow, updateStatus]);

  /**
   * Handle skip button press by calling the offline handler.
   */
  const handleSkipPress = (): void => {
    // Clear any existing timeout
    if (skipButtonTimeoutRef.current) {
      clearTimeout(skipButtonTimeoutRef.current);
      skipButtonTimeoutRef.current = null;
    }

    setShowSkipButton(false);
    lastStatusRef.current = '';

    handleOfflineFlow();
  };

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
    skipButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentBackground,
      paddingVertical: 8,
      paddingHorizontal: 20,
      borderRadius: 8,
      width: 200,
      borderWidth: 1,
      borderColor: colors.accentBorder,
    },
    skipButtonText: {
      marginLeft: 8,
      fontSize: 16,
      color: colors.textMuted,
    },
  });

  return (
    <ThemedView style={styles.container}>
      <View style={styles.contentWrapper}>
        <View style={styles.messageContainer}>
          {status ? <LoadingIndicator status={status} /> : null}
          <ThemedText style={styles.message1}>{t('app.reinitialize.vaultAutoLockedMessage')}</ThemedText>
          <ThemedText style={styles.message2}>{t('app.reinitialize.attemptingToUnlockMessage')}</ThemedText>
          {showSkipButton && (
            <TouchableOpacity style={styles.skipButton} onPress={handleSkipPress}>
              <Ionicons name="play-forward-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ThemedView>
  );
}
