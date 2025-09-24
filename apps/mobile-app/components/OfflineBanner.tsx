import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Toast from 'react-native-toast-message';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useVaultSync } from '@/hooks/useVaultSync';

import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useAuth } from '@/context/AuthContext';

/**
 * A banner component that displays when the app is in offline mode.
 * @returns {React.ReactNode} The offline banner component or null if online
 */
export function OfflineBanner(): React.ReactNode {
  const { isOffline } = useAuth();
  const colors = useColors();
  const { t } = useTranslation();
  const { syncVault } = useVaultSync();
  const [isRetrying, setIsRetrying] = useState(false);

  if (!isOffline) {
    return null;
  }

  /**
   * Handle retry connection attempt.
   * @returns {Promise<void>}
   */
  const handleRetry = async (): Promise<void> => {
    // Prevent multiple simultaneous retry attempts
    if (isRetrying) {
      return;
    }

    setIsRetrying(true);

    try {
      await syncVault({
        /**
         * Handle status updates during sync.
         * @param {string} _message - The status message
         */
        onStatus: (_message: string) => {
          // Status updates will be shown in the toast
        },
        /**
         * Handle successful sync.
         */
        onSuccess: () => {
          Toast.show({
            type: 'success',
            text1: t('app.offline.backOnline'),
            position: 'bottom'
          });
          setIsRetrying(false);
        },
        /**
         * Handle offline.
         */
        onOffline: () => {
          Toast.show({
            type: 'error',
            text1: t('app.offline.stillOffline'),
            position: 'bottom'
          });
          setIsRetrying(false);
        },
        /**
         * Handle sync errors.
         * @param {string} error - The error message
         */
        onError: (error: string) => {
          Toast.show({
            type: 'error',
            text1: t('app.offline.stillOffline'),
            text2: error,
            position: 'bottom'
          });
          setIsRetrying(false);
        }
      });
    } catch {
      // In case of unexpected errors, ensure loading state is cleared
      setIsRetrying(false);
    }
  };

  const styles = StyleSheet.create({
    container: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      marginBottom: 12,
      padding: 8,
    },
    content: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
    },
    retryButton: {
      marginLeft: 8,
      padding: 4,
      minWidth: 28,
      minHeight: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: {
      color: colors.primarySurfaceText,
      flex: 1,
      fontSize: 14,
      textAlign: 'center',
    },
  });

  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        <ThemedText style={styles.text}>
          {t('app.offline.banner')}
        </ThemedText>
        <RobustPressable
          style={styles.retryButton}
          onPress={handleRetry}
          disabled={isRetrying}
        >
          {isRetrying ? (
            <ActivityIndicator size="small" color={colors.primarySurfaceText} />
          ) : (
            <Ionicons name="refresh" size={20} color={colors.primarySurfaceText} />
          )}
        </RobustPressable>
      </View>
    </ThemedView>
  );
}
