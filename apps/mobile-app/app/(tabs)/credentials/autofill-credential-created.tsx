import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, AppState } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedSafeAreaView } from '@/components/themed/ThemedSafeAreaView';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { RobustPressable } from '@/components/ui/RobustPressable';

/**
 * Autofill credential created screen.
 */
export default function AutofillCredentialCreatedScreen() : React.ReactNode {
  const router = useRouter();
  const colors = useColors();
  const navigation = useNavigation();
  const { t } = useTranslation();

  /**
   * Handle the stay in app button press.
   */
  const handleStayInApp = useCallback(() => {
    router.back();
  }, [router]);

  // Handle app state changes to auto-dismiss when app goes to background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background') {
        router.back();
      }
    });

    return (): void => {
      subscription.remove();
    };
  }, [router]);

  const styles = StyleSheet.create({
    boldMessage: {
      fontWeight: 'bold',
      marginTop: 20,
    },
    container: {
      flex: 1,
    },
    content: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      padding: 20,
    },
    headerRightButton: {
      padding: 10,
      paddingRight: 0,
    },
    iconContainer: {
      marginBottom: 30,
    },
    message: {
      fontSize: 16,
      lineHeight: 24,
      marginBottom: 30,
      textAlign: 'center',
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      marginBottom: 20,
      textAlign: 'center',
    },
  });

  // Set header buttons
  useEffect(() => {
    navigation.setOptions({
      /**
       * Header right button.
       */
      headerRight: () =>
        <RobustPressable
          onPress={handleStayInApp}
          style={styles.headerRightButton}
          pressRetentionOffset={100}
          hitSlop={100}
        >
          <ThemedText style={{ color: colors.primary }}>{t('common.close')}</ThemedText>
        </RobustPressable>
    });
  }, [navigation, colors.primary, styles.headerRightButton, handleStayInApp, t]);

  return (
    <ThemedSafeAreaView style={styles.container}>
      <ThemedView style={styles.content}>
        <View style={styles.iconContainer}>
          <MaterialIcons
            name="task-alt"
            size={80}
            color={colors.primary}
          />
        </View>

        <ThemedText style={styles.title}>{t('credentials.credentialCreated')}</ThemedText>

        <ThemedText style={styles.message}>
          {t('credentials.credentialCreatedMessage')}
        </ThemedText>
        <ThemedText style={[styles.message, styles.boldMessage]}>
          {t('credentials.switchBackToBrowser')}
        </ThemedText>
      </ThemedView>
    </ThemedSafeAreaView>
  );
}