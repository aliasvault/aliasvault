import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';

/**
 * QR Code result screen - shows success or error after mobile unlock attempt.
 */
export default function MobileUnlockResultScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { success, message } = useLocalSearchParams<{ success: string; message?: string }>();

  const isSuccess = success === 'true';

  // Set dynamic header title based on success/error state
  useEffect(() => {
    navigation.setOptions({
      title: isSuccess ? t('common.success') : t('common.error'),
    });
  }, [navigation, isSuccess, t]);

  /**
   * Handle dismiss - navigate to settings tab.
   * Uses replace to handle cases where this page is reached via deep link navigation.
   */
  const handleDismiss = () : void => {
    router.replace('/(tabs)/settings');
  };

  const styles = StyleSheet.create({
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
      marginTop: 20,
      paddingBottom: insets.bottom + 80,
      paddingHorizontal: 20,
      width: '100%',
    },
    button: {
      width: '100%',
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView contentContainerStyle={{ flexGrow: 1 }}>
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
              {message || (isSuccess
                ? t('settings.qrScanner.mobileLogin.successDescription')
                : t('common.errors.unknownErrorTryAgain'))}
            </ThemedText>
          </View>
        </View>

        <View style={styles.buttonContainer}>
          <ThemedButton
            title={t('common.close')}
            onPress={handleDismiss}
            style={styles.button}
          />
        </View>
      </ThemedScrollView>
    </ThemedContainer>
  );
}
