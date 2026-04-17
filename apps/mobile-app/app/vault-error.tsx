import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, useCallback } from 'react';
import { StyleSheet, View, ScrollView, Dimensions, Text, Platform } from 'react-native';

import { copyToClipboard } from '@/utils/ClipboardUtility';

import { useColors } from '@/hooks/useColorScheme';
import { useLogout } from '@/hooks/useLogout';
import { useTranslation } from '@/hooks/useTranslation';

import Logo from '@/assets/images/logo.svg';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { RobustPressable } from '@/components/ui/RobustPressable';

/**
 * Vault error screen displayed when the app encounters an unrecoverable error
 * during vault initialization or bootstrap.
 */
export default function VaultErrorScreen() : React.ReactNode {
  const { errorMessage, errorStack, errorSource } = useLocalSearchParams<{
    errorMessage: string;
    errorStack: string;
    errorSource: string;
  }>();
  const colors = useColors();
  const { t } = useTranslation();
  const { logoutUserInitiated } = useLogout();
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  /**
   * Copy the full error details to clipboard for sharing with support.
   */
  const handleCopyError = useCallback(async (): Promise<void> => {
    const errorReport = [
      `Source: ${errorSource ?? 'unknown'}`,
      `Platform: ${Platform.OS} ${Platform.Version}`,
      `Error: ${errorMessage ?? 'Unknown error'}`,
      '',
      'Stack trace:',
      errorStack ?? 'No stack trace available',
    ].join('\n');

    await copyToClipboard(errorReport);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [errorMessage, errorStack, errorSource]);

  /**
   * Retry by navigating back to the initialize screen.
   */
  const handleRetry = useCallback((): void => {
    router.replace('/initialize');
  }, []);

  const styles = StyleSheet.create({
    appName: {
      color: colors.text,
      fontSize: 28,
      fontWeight: 'bold',
      textAlign: 'center',
    },
    button: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      justifyContent: 'center',
      marginBottom: 12,
      minHeight: 50,
      paddingVertical: 8,
      width: '100%',
    },
    buttonText: {
      color: colors.primarySurfaceText,
      fontSize: 16,
      fontWeight: '600',
      paddingHorizontal: 16,
      paddingVertical: 4,
      textAlign: 'center',
    },
    container: {
      flex: 1,
    },
    content: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      padding: 20,
      width: '100%',
    },
    copyButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 8,
      minHeight: 40,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    copyButtonText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
      marginLeft: 6,
    },
    detailsContainer: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginTop: 12,
      maxHeight: 250,
      padding: 12,
    },
    detailsText: {
      color: colors.textMuted,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
    },
    errorIcon: {
      alignItems: 'center',
      marginBottom: 12,
    },
    errorMessageText: {
      color: colors.errorText,
      fontSize: 14,
      textAlign: 'center',
    },
    gradientContainer: {
      height: Dimensions.get('window').height * 0.4,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    headerSection: {
      paddingBottom: 24,
      paddingHorizontal: 16,
      paddingTop: 24,
    },
    logoContainer: {
      alignItems: 'center',
      marginBottom: 8,
    },
    logoutButton: {
      alignSelf: 'center',
      justifyContent: 'center',
      marginTop: 8,
    },
    logoutButtonText: {
      color: colors.red,
      fontSize: 16,
    },
    mainContent: {
      flex: 1,
      justifyContent: 'center',
      paddingBottom: 40,
      paddingHorizontal: 20,
    },
    scrollContent: {
      flexGrow: 1,
    },
    showDetailsButton: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 12,
    },
    showDetailsText: {
      color: colors.primary,
      fontSize: 14,
      marginLeft: 4,
    },
    subtitle: {
      color: colors.text,
      fontSize: 14,
      marginBottom: 16,
      opacity: 0.7,
      textAlign: 'center',
    },
  });

  return (
    <ThemedView style={styles.container} testID="vault-error-screen">
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <LinearGradient
          colors={[colors.loginHeader, colors.background]}
          style={styles.gradientContainer}
        />
        <View style={styles.mainContent}>
          <View style={styles.headerSection}>
            <View style={styles.logoContainer}>
              <Logo width={80} height={80} />
              <Text style={styles.appName}>{t('app.vaultError.title')}</Text>
            </View>
          </View>
          <View style={styles.content}>
            <View style={styles.errorIcon}>
              <MaterialIcons name="error-outline" size={48} color={colors.red} />
            </View>

            <ThemedText style={styles.subtitle}>
              {t('app.vaultError.description')}
            </ThemedText>

            <ThemedText style={styles.errorMessageText}>
              {errorMessage ?? t('common.errors.unknownError')}
            </ThemedText>

            {/* Show/hide details toggle */}
            <RobustPressable
              style={styles.showDetailsButton}
              onPress={() => setShowDetails(!showDetails)}
            >
              <MaterialIcons
                name={showDetails ? 'expand-less' : 'expand-more'}
                size={20}
                color={colors.primary}
              />
              <ThemedText style={styles.showDetailsText}>
                {showDetails ? t('app.vaultError.hideDetails') : t('app.vaultError.showDetails')}
              </ThemedText>
            </RobustPressable>

            {/* Stack trace details */}
            {showDetails && (
              <View>
                <ScrollView style={styles.detailsContainer} nestedScrollEnabled>
                  <Text style={styles.detailsText} selectable>
                    {`Source: ${errorSource ?? 'unknown'}\nPlatform: ${Platform.OS} ${Platform.Version}\n\n${errorStack ?? 'No stack trace available'}`}
                  </Text>
                </ScrollView>
                <RobustPressable
                  style={styles.copyButton}
                  onPress={handleCopyError}
                >
                  <MaterialIcons
                    name={copied ? 'check' : 'content-copy'}
                    size={16}
                    color={colors.primary}
                  />
                  <ThemedText style={styles.copyButtonText}>
                    {copied ? t('common.copied') : t('app.vaultError.copyErrorDetails')}
                  </ThemedText>
                </RobustPressable>
              </View>
            )}

            {/* Action buttons */}
            <View style={{ marginTop: 20 }}>
              <RobustPressable
                style={styles.button}
                onPress={handleRetry}
                testID="retry-button"
              >
                <ThemedText style={styles.buttonText}>
                  {t('common.retry')}
                </ThemedText>
              </RobustPressable>
            </View>

            <RobustPressable
              style={styles.logoutButton}
              onPress={logoutUserInitiated}
              testID="logout-button"
            >
              <ThemedText style={styles.logoutButtonText}>
                {t('auth.logout')}
              </ThemedText>
            </RobustPressable>
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}
