import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/hooks/useColorScheme';
import { useHeaderInset } from '@/hooks/useHeaderInset';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { ScreenToolbar } from '@/components/ui/ScreenToolbar';

/** Seconds after which a success result returns to settings by itself; an error stays until closed. */
const SUCCESS_AUTO_CLOSE_SECONDS = 5;

/**
 * QR Code result screen - shows success or error after mobile unlock attempt.
 */
export default function MobileUnlockResultScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const headerInset = useHeaderInset();
  const insets = useSafeAreaInsets();
  const { success, reason } = useLocalSearchParams<{ success: string; reason?: string }>();

  const isSuccess = success === 'true';

  let message = isSuccess ? t('settings.qrScanner.mobileLogin.successDescription') : t('common.errors.unknownErrorTryAgain');
  if (!isSuccess && reason === 'codeMismatch') {
    message = t('settings.qrScanner.mobileLogin.codeMismatch');
  }

  // Set dynamic header title based on success/error state
  useEffect(() => {
    navigation.setOptions({
      title: isSuccess ? t('common.success') : t('common.error'),
    });
  }, [navigation, isSuccess, t]);

  // A success needs no reading, so it returns to settings by itself.
  useEffect(() => {
    if (!isSuccess) {
      return undefined;
    }
    const timer = setTimeout(() => router.replace('/(tabs)/settings'), SUCCESS_AUTO_CLOSE_SECONDS * 1000);
    return (): void => clearTimeout(timer);
  }, [isSuccess]);

  /**
   * Handle dismiss - navigate to settings tab.
   * Uses replace to handle cases where this page is reached via deep link navigation.
   */
  const handleDismiss = () : void => {
    router.replace('/(tabs)/settings');
  };

  const styles = StyleSheet.create({
    screen: {
      flex: 1,
      paddingBottom: Platform.OS === 'ios' ? insets.bottom + 16 : 16,
      paddingTop: Math.max(headerInset, insets.top),
    },
    container: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      padding: 20,
    },
    resultContainer: {
      alignItems: 'center',
      backgroundColor: (isSuccess ? colors.success : colors.destructive) + '10',
      borderColor: isSuccess ? colors.success : colors.destructive,
      borderRadius: 12,
      borderWidth: 2,
      marginBottom: 20,
      padding: 20,
      width: '100%',
    },
    icon: {
      marginBottom: 16,
    },
    title: {
      color: isSuccess ? colors.success : colors.destructive,
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 8,
      textAlign: 'center',
    },
    message: {
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
    buttonContainer: {
      paddingHorizontal: 20,
      width: '100%',
    },
    button: {
      width: '100%',
    },
  });

  return (
    <ThemedContainer>
      {/* On iOS the close button is a native header item, which the iPhone Duo moves into its rail. */}
      {Platform.OS === 'ios' && (
        <ScreenToolbar placement="right">
          <Stack.Toolbar.Button icon="xmark" onPress={handleDismiss}>{t('common.close')}</Stack.Toolbar.Button>
        </ScreenToolbar>
      )}
      <View style={styles.screen}>
        <View style={styles.container}>
          <View style={styles.resultContainer}>
            <Ionicons
              name={isSuccess ? 'checkmark-circle' : 'alert-circle'}
              size={64}
              color={isSuccess ? colors.success : colors.destructive}
              style={styles.icon}
            />
            <ThemedText style={styles.title}>
              {isSuccess
                ? t('common.success')
                : t('common.error')}
            </ThemedText>
            <ThemedText style={styles.message}>
              {message}
            </ThemedText>
          </View>
        </View>

        {Platform.OS === 'android' && (
          <View style={styles.buttonContainer}>
            <ThemedButton
              title={t('common.close')}
              onPress={handleDismiss}
              style={styles.button}
            />
          </View>
        )}
      </View>
    </ThemedContainer>
  );
}
